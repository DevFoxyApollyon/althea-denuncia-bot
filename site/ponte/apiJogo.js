// API que o script Lua (PC da staff) usa para puxar e aplicar a fila de punições.
// Montada em /ponte/api ANTES da checagem de Origin (o Lua não manda Origin) e
// sem sessão do site: a identidade vem só do token. O guildId sai sempre do
// token, nunca do que o cliente envia.
const express = require('express');
const mongoose = require('mongoose');
const PonteInstalacao = require('../../models/PonteInstalacao');
const PonteServidor = require('../../models/PonteServidor');
const PontePunicao = require('../../models/PontePunicao');
const PonteUso = require('../../models/PonteUso');
const { sha256 } = require('../../services/ponteSamp/seguranca');
const { ponteLigada } = require('../../services/ponteSamp/gestao');
const { validarAlvos, previaComandos, templatesEfetivos, classificarMotivo } = require('../../services/ponteSamp/validacao');
// A tabela de motivos é editada no Discord (/ponte motivos) ou no site (/admin). O jogo lê e só ACRESCENTA
// motivo novo (POST /motivos); alterar ou apagar um existente fica no site/Discord, com cargo de staff.
const { obterTabela, salvarTabela } = require('../../services/ponteSamp/motivos');
const { SUFIXO_MOTIVO, CMDS_PUNICAO, VERSAO_MOD_ATUAL } = require('../../services/ponteSamp/constantes');
const { montarRelatorio } = require('../../services/ponteSamp/relatorio');
const { atualizarMensagensDiscord, limparAguardando, reclassificarFila } = require('../../services/ponteSamp/aceite');
const { avisarAplicadas, avisarNicksNaoEncontrados, avisarJaBanidos, avisarSemResposta } = require('../../services/ponteSamp/avisoOrganizacao');

// Tentativas em que o servidor do jogo não respondeu antes de o automático parar e avisar a staff.
const LIMITE_SEM_RESPOSTA = 3;
const semResposta = (r) => /^servidor nao respondeu/.test(String(r?.erro || ''));
const { criarLimitador } = require('../rotas/comum');
const { ipDoCliente } = require('../protecao');
const { getConfig } = require('../../utils/configCache');

const EXECUCAO_PRESA_MS = 10 * 60 * 1000;
const RE_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const RE_HWID = /^[a-f0-9]{32,64}$/;
const RE_VERSAO_SCRIPT = /[^0-9A-Za-z._-]/g;

// "12/10 15:40" no horário de Brasília (o jogo mostra como veio).
const quandoBr = (data) => (data ? new Date(data).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
}).replace(',', '') : '');

class ErroPonte extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function auditar(req, acao, extra = {}) {
  return PonteUso.create({
    guildId: req.ponte?.guildId || extra.guildId || '',
    instalacaoId: req.ponte?.instalacao?._id || extra.instalacaoId || null,
    acao,
    ip: ipDoCliente(req),
    ...extra
  }).catch(() => {});
}

// Execuções que travaram (PC caiu no meio) voltam para a fila. As da gamemode ficam de
// fora: os pedidos podem já estar com ela, e só a resposta ou um responsável liberam.
function liberarExecucoesPresas(guildId, agora = Date.now()) {
  return PontePunicao.updateMany(
    { guildId, status: 'executando', executor: { $ne: 'gamemode' }, executandoDesde: { $lt: new Date(agora - EXECUCAO_PRESA_MS) } },
    { $set: { status: 'aceita', executandoPor: null, executandoDesde: null }, $inc: { versao: 1 } }
  );
}

// Banimentos ainda valendo, aplicados pelo painel em outras denúncias, para as contas da fila.
// Uma denúncia nova da mesma conta soma o tempo: o jogo desbane e bane de novo com o total.
async function bansAnteriores(guildId, lista) {
  const contas = [...new Set(lista.flatMap(p => (p.alvos || []).filter(a => !a.removido).map(a => a.contaId)))];
  if (contas.length === 0) return new Map();
  const ids = lista.map(p => p._id);
  const aplicadas = await PontePunicao.find({
    guildId, _id: { $nin: ids }, 'resultado.ok': true, 'alvos.contaId': { $in: contas }
  }).sort({ aplicadaEm: -1, criadoEm: -1 }).limit(300).lean();

  const agora = Date.now();
  const mapa = new Map();
  for (const p of aplicadas) {
    for (const r of p.resultado || []) {
      if (!r.ok || r.erro || r.retiradaEm) continue;
      const alvo = (p.alvos || []).find(a => String(a._id) === String(r.alvoId));
      if (!alvo || alvo.cmd !== 'ban' || !contas.includes(alvo.contaId) || mapa.has(alvo.contaId)) continue;
      const em = new Date(r.em || p.aplicadaEm || p.criadoEm).getTime();
      // tempo total aplicado: o comando guarda o tempo de fato enviado (pode já ser uma soma)
      const tempoEnviado = Number((String(r.comando).match(/^\/\S+\s+\d+\s+(\d+)/) || [])[1] ?? alvo.tempo);
      const valendo = tempoEnviado === 0 || em + tempoEnviado * 24 * 60 * 60 * 1000 > agora;
      if (!valendo) continue;
      mapa.set(alvo.contaId, {
        punicaoId: String(p._id), alvoId: String(r.alvoId), tempo: tempoEnviado,
        motivo: String(r.comando).replace(/^\/\S+\s+\d+\s+\d+\s*/, '').replace(/\s*\[DC\]\s*$/i, ''),
        em: r.em || p.aplicadaEm
      });
    }
  }
  return mapa;
}

// Anotação interna da punição como o jogo mostra (null quando não há).
function notaParaJogo(nota) {
  if (!nota?.texto) return null;
  return { texto: nota.texto, por: nota.por || '', quando: quandoBr(nota.em) };
}

function formatarPunicao(p, templates, tabela, anteriores = new Map()) {
  // Alvo com comando que não existe mais (ex.: "jail" da versão provisória): reclassifica pelo motivo.
  const tpl = templatesEfetivos(templates);
  const alvos = (p.alvos || []).map(a => {
    if (CMDS_PUNICAO.includes(a.cmd) && tpl[a.cmd]) return a;
    const { cmd, tempo, avisos, regra } = classificarMotivo(a.motivo, tabela);
    return { ...a, cmd, tempo, avisos, regra };
  });
  p = { ...p, alvos };
  return {
    id: String(p._id),
    status: p.status,
    versao: p.versao,
    origem: p.origem,
    aceitoPor: p.aceitoPor?.nome || '',
    aceitoEm: p.aceitoEm,
    msgDiscord: p.msgDiscord,
    nota: notaParaJogo(p.nota),
    alvos: (p.alvos || []).map(a => ({
      ...a,
      _id: String(a._id),
      anterior: a.cmd === 'ban' ? anteriores.get(a.contaId) || null : null
    })),
    previa: previaComandos(p.alvos || [], templates).map(item => ({ alvoId: String(item.alvoId), comando: item.comando }))
  };
}

async function alertarHwid(client, servidor, instalacao, log) {
  try {
    const config = await getConfig(servidor.guildId).catch(() => null);
    const canalId = servidor.canalAlertasId || config?.channels?.log;
    const canal = canalId && client ? await client.channels.fetch(canalId).catch(() => null) : null;
    await canal?.send({
      content: `🚨 **Ponte do jogo:** o PC **${instalacao.nome}** (token …${instalacao.ultimos4}) foi usado em outro computador e foi **bloqueado**. Se foi troca de PC, use \`/instalacao renovar id:${instalacao._id}\`.`
    });
  } catch (error) {
    log?.warn?.(`Falha ao alertar HWID diferente: ${error.message}`);
  }
}

function criarApiJogo({ client = null, log = null, limites = {} } = {}) {
  const router = express.Router();
  const porIp = criarLimitador(limites.ip || 120, 60 * 1000);
  const porToken = criarLimitador(limites.token || 60, 60 * 1000);
  const falhasPorIp = criarLimitador(limites.falhas || 10, 60 * 1000);
  // Só conta falhas: o limitador acima registra cada chamada, então guardamos à parte.
  const bloqueioFalhas = new Map();

  router.use(express.json({ limit: '32kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Autenticação: token → instalação ativa → guild ativa → HWID.
  router.use(async (req, res, next) => {
    try {
      const ip = ipDoCliente(req);
      if (!porIp(ip)) throw new ErroPonte(429, 'Muitas requisições. Aguarde.');
      if ((bloqueioFalhas.get(ip) || 0) > Date.now()) throw new ErroPonte(429, 'Muitas falhas de autenticação. Aguarde um minuto.');

      const falhar = async (status, mensagem, acao, extra = {}) => {
        if (!falhasPorIp(ip)) bloqueioFalhas.set(ip, Date.now() + 60 * 1000);
        await auditar(req, acao, extra);
        throw new ErroPonte(status, mensagem);
      };

      if (!ponteLigada()) throw new ErroPonte(403, 'Ponte desligada.');
      const token = String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!RE_TOKEN.test(token)) await falhar(401, 'Token inválido.', 'auth_falhou');

      const instalacao = await PonteInstalacao.findOne({ tokenHash: sha256(token) });
      if (!instalacao || instalacao.status !== 'ativa') {
        await falhar(401, 'Token inválido ou revogado.', 'auth_falhou', {
          guildId: instalacao?.guildId || '', instalacaoId: instalacao?._id || null, detalhes: instalacao ? { status: instalacao.status } : null
        });
      }

      const servidor = await PonteServidor.findOne({ guildId: instalacao.guildId, ativo: true }).lean();
      if (!servidor) await falhar(403, 'Ponte não ativa neste servidor.', 'guild_inativa', { guildId: instalacao.guildId, instalacaoId: instalacao._id });

      req.ponte = { guildId: instalacao.guildId, instalacao, servidor };

      const hwid = String(req.get('X-HWID') || '').trim().toLowerCase();
      if (!RE_HWID.test(hwid)) throw new ErroPonte(400, 'Cabeçalho X-HWID ausente ou inválido.');
      if (!instalacao.hwidHash) {
        // Primeiro uso: grava o HWID. A condição evita dois PCs gravarem ao mesmo tempo.
        const gravado = await PonteInstalacao.findOneAndUpdate(
          { _id: instalacao._id, hwidHash: null }, { $set: { hwidHash: hwid } }, { new: true }
        );
        instalacao.hwidHash = gravado?.hwidHash || (await PonteInstalacao.findById(instalacao._id).lean())?.hwidHash;
      }
      if (instalacao.hwidHash !== hwid) {
        await PonteInstalacao.updateOne({ _id: instalacao._id }, { $set: { status: 'bloqueada' } });
        await auditar(req, 'hwid_diferente', { detalhes: { esperado: instalacao.hwidHash.slice(0, 8), recebido: hwid.slice(0, 8) } });
        alertarHwid(client, servidor, instalacao, log);
        throw new ErroPonte(403, 'Este token pertence a outro PC. Instalação bloqueada.');
      }

      if (!porToken(String(instalacao._id))) throw new ErroPonte(429, 'Muitas requisições deste PC. Aguarde.');
      PonteInstalacao.updateOne({ _id: instalacao._id }, { $set: { ultimoUsoEm: new Date(), ultimoIp: ip } }).catch(() => {});
      next();
    } catch (erro) {
      next(erro);
    }
  });

  const rota = (fn) => (req, res, next) => fn(req, res).catch(next);
  const idValido = (id) => {
    if (!mongoose.isValidObjectId(id)) throw new ErroPonte(400, 'ID inválido.');
    return id;
  };
  const versaoDoCorpo = (req) => {
    const versao = Number(req.body?.versao);
    if (!Number.isInteger(versao) || versao < 0) throw new ErroPonte(400, 'Versão inválida.');
    return versao;
  };

  router.post('/ping', rota(async (req, res) => {
    const { instalacao, guildId } = req.ponte;
    await PonteInstalacao.updateOne({ _id: instalacao._id }, {
      $set: { ultimoPingEm: new Date(), versaoScript: String(req.body?.versao || '').replace(RE_VERSAO_SCRIPT, '').slice(0, 20), ultimoIp: ipDoCliente(req) }
    });
    const pendentes = await PontePunicao.countDocuments({ guildId, status: 'aceita' });
    // versaoMod/urlMod: o mod compara com a versão dele e avisa a staff quando existe uma mais nova.
    res.json({ ok: true, pendentes, pc: instalacao.nome, versaoMod: VERSAO_MOD_ATUAL, urlMod: String(process.env.PONTE_MOD_URL || '') });
  }));

  router.get('/fila', rota(async (req, res) => {
    const { guildId, servidor } = req.ponte;
    await liberarExecucoesPresas(guildId);
    const lista = await PontePunicao.find({ guildId, status: 'aceita' }).sort({ criadoEm: 1 }).limit(50).lean();
    const { tabela, propria } = await obterTabela();
    await reclassificarFila({ client, lista, tabela });
    const anteriores = await bansAnteriores(guildId, lista);
    res.json({
      ok: true,
      templates: templatesEfetivos(servidor.templates),
      tabela,
      tabelaPropria: propria,
      sufixo: SUFIXO_MOTIVO,
      punicoes: lista.map(p => formatarPunicao(p, servidor.templates, tabela, anteriores))
    });
  }));

  // Motivo novo pelo painel do jogo: entra na tabela global (a mesma do Discord e do site) e fica salvo.
  // Só acrescenta; nome repetido é recusado pela validação da tabela.
  router.post('/motivos', rota(async (req, res) => {
    const { instalacao } = req.ponte;
    const novo = {
      nome: String(req.body?.nome ?? ''),
      sinonimos: Array.isArray(req.body?.sinonimos) ? req.body.sinonimos.map(String) : [],
      cmd: String(req.body?.cmd ?? ''),
      tempo: Number(req.body?.tempo),
      avisos: Number(req.body?.avisos ?? 0)
    };
    const { tabela } = await obterTabela();
    const atual = tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.filter(s => s !== t.nome), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos }));
    const salvo = await salvarTabela([...atual, novo], `painel do jogo (${instalacao?.nome || 'PC'})`);
    if (salvo.erro) throw new ErroPonte(400, salvo.erro);
    reclassificarFila({ client, tabela: salvo.tabela }).catch(() => {});
    await auditar(req, 'regras', { detalhes: { motivo: novo.nome, via: 'jogo', motivos: salvo.tabela.length } });
    res.json({ ok: true, total: salvo.tabela.length });
  }));

  // Anotação interna da punição (na fila ou já aplicada). Texto vazio apaga.
  router.post('/punicoes/:id/nota', rota(async (req, res) => {
    const { guildId, instalacao } = req.ponte;
    const id = idValido(req.params.id);
    // eslint-disable-next-line no-control-regex
    const texto = String(req.body?.texto ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const nota = texto ? { texto, por: instalacao.nome, em: new Date() } : { texto: '', por: '', em: null };
    const punicao = await PontePunicao.findOneAndUpdate({ _id: id, guildId }, { $set: { nota } }, { new: true }).lean();
    if (!punicao) throw new ErroPonte(404, 'Punição não encontrada.');
    await auditar(req, 'nota', { punicaoId: punicao._id, detalhes: { tamanho: texto.length } });
    res.json({ ok: true, nota: notaParaJogo(punicao.nota) });
  }));

  // Resumo dos últimos N dias (1 a 90): aceitas, aplicados, falhas, espera média e quem fez o quê.
  router.get('/relatorio', rota(async (req, res) => {
    const { guildId } = req.ponte;
    const dias = Math.min(90, Math.max(1, Math.floor(Number(req.query?.dias) || 7)));
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const lista = await PontePunicao.find({
      guildId,
      $or: [{ aceitoEm: { $gte: desde } }, { aplicadaEm: { $gte: desde } }, { status: { $in: ['aceita', 'executando'] } }]
    }).select('aceitoPor aceitoEm aplicadaEm aplicadaPor status resultado criadoEm').limit(2000).lean();
    await auditar(req, 'relatorio', { detalhes: { dias } });
    res.json({ ok: true, ...montarRelatorio(lista, dias) });
  }));

  router.patch('/fila/:id', rota(async (req, res) => {
    const { guildId, servidor } = req.ponte;
    const id = idValido(req.params.id);
    const versao = versaoDoCorpo(req);
    const { erro, alvos } = validarAlvos(req.body?.alvos, servidor.templates);
    if (erro) throw new ErroPonte(400, erro);

    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: id, guildId, status: 'aceita', versao },
      { $set: { alvos }, $inc: { versao: 1 } },
      { new: true, runValidators: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'A punição mudou ou já foi aplicada. Recarregue.');
    await auditar(req, 'editar', { punicaoId: punicao._id, detalhes: { alvos: alvos.length } });
    res.json({ ok: true, punicao: formatarPunicao(punicao, servidor.templates, (await obterTabela()).tabela) });
  }));

  router.post('/fila/:id/executar', rota(async (req, res) => {
    const { guildId, instalacao, servidor } = req.ponte;
    const id = idValido(req.params.id);
    const versao = versaoDoCorpo(req);
    if (servidor.executor === 'gamemode') throw new ErroPonte(409, 'Este servidor aplica pela gamemode.');
    await liberarExecucoesPresas(guildId);
    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: id, guildId, status: 'aceita', versao },
      { $set: { status: 'executando', executor: 'pc', executandoPor: instalacao._id, executandoDesde: new Date() } },
      { new: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'Outro PC já está aplicando ou a punição mudou. Recarregue.');
    await auditar(req, 'executar', { punicaoId: punicao._id });
    res.json({ ok: true, punicao: formatarPunicao(punicao, servidor.templates, (await obterTabela()).tabela) });
  }));

  // Tira a punição da fila sem aplicar (fica no banco como cancelada).
  router.post('/fila/:id/remover', rota(async (req, res) => {
    const { guildId } = req.ponte;
    const id = idValido(req.params.id);
    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: id, guildId, status: 'aceita' },
      { $set: { status: 'cancelada' }, $inc: { versao: 1 } },
      { new: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'A punição não está mais na fila.');
    await auditar(req, 'remover', { punicaoId: punicao._id });
    limparAguardando(client, punicao).catch(() => {});
    res.json({ ok: true });
  }));

  // Tira da fila, de uma vez, as punições que o painel estava mostrando. Só os ids
  // enviados: o que chegou depois de o painel carregar continua na fila.
  router.post('/fila/limpar', rota(async (req, res) => {
    const { guildId } = req.ponte;
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
    if (ids.length === 0 || ids.length > 50) throw new ErroPonte(400, 'Envie de 1 a 50 punições.');
    ids.forEach(idValido);
    const naFila = await PontePunicao.find({ _id: { $in: ids }, guildId, status: 'aceita' }, { mensagens: 1 }).lean();
    const { modifiedCount } = await PontePunicao.updateMany(
      { _id: { $in: ids }, guildId, status: 'aceita' },
      { $set: { status: 'cancelada' }, $inc: { versao: 1 } }
    );
    await auditar(req, 'limpar', { detalhes: { pedidas: ids.length, removidas: modifiedCount } });
    for (const p of naFila) limparAguardando(client, p).catch(() => {});
    res.json({ ok: true, removidas: modifiedCount });
  }));

  router.post('/fila/:id/cancelar', rota(async (req, res) => {
    const { guildId, instalacao } = req.ponte;
    const id = idValido(req.params.id);
    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: id, guildId, status: 'executando', executandoPor: instalacao._id },
      { $set: { status: 'aceita', executandoPor: null, executandoDesde: null }, $inc: { versao: 1 } },
      { new: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'Esta punição não está em execução por este PC.');
    await auditar(req, 'cancelar', { punicaoId: punicao._id });
    res.json({ ok: true });
  }));

  // Corpo: { resultado: [{ alvoId, comando, ok, erro }], manterPendentes }.
  // Com pendentes (alvo offline) e manterPendentes, volta para a fila só com eles.
  router.post('/fila/:id/aplicada', rota(async (req, res) => {
    const { guildId, instalacao } = req.ponte;
    const id = idValido(req.params.id);
    const bruto = Array.isArray(req.body?.resultado) ? req.body.resultado.slice(0, 30) : null;
    if (!bruto) throw new ErroPonte(400, 'Resultado inválido.');
    const resultado = bruto
      .filter(r => r && mongoose.isValidObjectId(r.alvoId))
      .map(r => ({
        alvoId: new mongoose.Types.ObjectId(String(r.alvoId)),
        comando: String(r.comando || '').slice(0, 128),
        ok: r.ok === true,
        confirmado: r.confirmado !== false,
        erro: String(r.erro || '').slice(0, 100),
        nome: String(r.nome || '').slice(0, 40),
        // ID descoberto no jogo pelo /vercontanick (alvo que veio só com o nick)
        contaId: /^\d{1,9}$/.test(String(r.contaId || '')) ? String(r.contaId) : '',
        discord: String(r.discord || '').slice(0, 60),
        // texto do servidor quando a conta já estava banida
        resposta: String(r.resposta || '').slice(0, 200),
        organizacao: String(r.organizacao || '').slice(0, 60),
        em: new Date(),
        pc: instalacao.nome,
        // ban anterior que foi desbanido e somado neste
        acumulouDe: r.acumulouDe && mongoose.isValidObjectId(r.acumulouDe.punicaoId) && mongoose.isValidObjectId(r.acumulouDe.alvoId)
          ? { punicaoId: String(r.acumulouDe.punicaoId), alvoId: String(r.acumulouDe.alvoId) }
          : null
      }));

    const atual = await PontePunicao.findOne({ _id: id, guildId, status: 'executando', executandoPor: instalacao._id }).lean();
    if (!atual) throw new ErroPonte(409, 'Esta punição não está em execução por este PC.');

    const aplicados = new Set(resultado.filter(r => r.ok).map(r => String(r.alvoId)));
    const pendentes = (atual.alvos || []).filter(a => !a.removido && !aplicados.has(String(a._id)));
    const voltarParaFila = pendentes.length > 0 && req.body?.manterPendentes === true;

    // Alvos que vieram só com o nick ganham o ID descoberto no jogo.
    const idsDescobertos = new Map(resultado.filter(r => r.contaId).map(r => [String(r.alvoId), r.contaId]));
    const alvosComId = atual.alvos.map(a => (!a.contaId && idsDescobertos.has(String(a._id)) ? { ...a, contaId: idsDescobertos.get(String(a._id)) } : a));

    const $set = voltarParaFila
      ? {
        status: 'aceita',
        executandoPor: null,
        executandoDesde: null,
        alvos: alvosComId.map(a => (aplicados.has(String(a._id)) ? { ...a, removido: true } : a))
      }
      : { status: 'aplicada', aplicadaEm: new Date(), aplicadaPor: { instalacaoId: instalacao._id, nomePc: instalacao.nome }, alvos: alvosComId };

    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: id, guildId, status: 'executando', executandoPor: instalacao._id },
      { $set: { ...$set, resultado: [...(atual.resultado || []), ...resultado] }, $inc: { versao: 1 } },
      { new: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'Esta punição não está em execução por este PC.');

    // Ban antigo que foi somado neste: sai do histórico ativo para não somar de novo.
    for (const r of resultado.filter(item => item.ok && item.acumulouDe)) {
      await PontePunicao.updateOne(
        { _id: r.acumulouDe.punicaoId, guildId, resultado: { $elemMatch: { alvoId: r.acumulouDe.alvoId, retiradaEm: null } } },
        { $set: { 'resultado.$.retiradaEm': new Date(), 'resultado.$.retiradaPor': `somado em outra denúncia (PC ${instalacao.nome})` } }
      ).catch(() => {});
    }

    for (const r of resultado.filter(item => item.ok)) {
      const alvo = atual.alvos.find(a => String(a._id) === String(r.alvoId));
      await auditar(req, 'aplicar', {
        punicaoId: punicao._id, contaId: alvo?.contaId || '', nick: r.nome || alvo?.nick || '', comando: r.comando,
        detalhes: r.organizacao ? { organizacao: r.organizacao } : null
      });
    }

    // Cadeia Staff: marca a mensagem da denúncia como aplicada, com o PC.
    if (punicao.status === 'aplicada') {
      atualizarMensagensDiscord(client, punicao, `➱ Aplicado (painel: ${instalacao.nome})`).catch(() => {});
    }

    // Nick que o /vercontanick não achou: a punição fica pausada e o Log Admin é avisado.
    const naoEncontrados = resultado.filter(r => r.erro === 'nick nao encontrado');
    if (naoEncontrados.length) avisarNicksNaoEncontrados(client, punicao, naoEncontrados, instalacao.nome).catch(() => {});
    // Conta que já estava banida (ex.: 3/3 avisos), já tem ban permanente ou não foi possível
    // desbanir para somar: registro no Relatório de punições.
    const jaBanidos = resultado.filter(r => ['ja estava banido', 'ja tem ban permanente', 'desbanir falhou'].includes(r.erro));
    if (jaBanidos.length) avisarJaBanidos(client, punicao, jaBanidos, instalacao.nome).catch(() => {});

    // Registro no Log Admin; membro de organização marca o responsável admin.
    avisarAplicadas(client, punicao, resultado, instalacao.nome).catch(() => {});

    // Servidor do jogo sem responder: na 3ª vez para o mesmo jogador, o automático para e o Log Admin é avisado.
    const falhas = new Map();
    for (const r of [...(atual.resultado || []), ...resultado]) {
      if (semResposta(r)) falhas.set(String(r.alvoId), (falhas.get(String(r.alvoId)) || 0) + 1);
    }
    const noLimite = resultado.filter(r => semResposta(r) && falhas.get(String(r.alvoId)) >= LIMITE_SEM_RESPOSTA);
    const avisarAgora = noLimite.filter(r => falhas.get(String(r.alvoId)) === LIMITE_SEM_RESPOSTA);
    if (avisarAgora.length) avisarSemResposta(client, punicao, avisarAgora, instalacao.nome, LIMITE_SEM_RESPOSTA).catch(() => {});

    res.json({ ok: true, status: punicao.status, pendentes: pendentes.length, pausar: voltarParaFila && noLimite.length > 0 });
  }));

  // Punições aplicadas na guild (por qualquer PC), mais recentes primeiro.
  router.get('/historico', rota(async (req, res) => {
    const { guildId } = req.ponte;
    const lista = await PontePunicao.find({ guildId, 'resultado.ok': true })
      .sort({ aplicadaEm: -1, criadoEm: -1 }).limit(40).lean();
    const itens = [];
    for (const p of lista) {
      for (const r of p.resultado || []) {
        if (!r.ok) continue;
        const alvo = (p.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {};
        itens.push({
          punicaoId: String(p._id), alvoId: String(r.alvoId), contaId: alvo.contaId || '', cmd: alvo.cmd || '',
          tempo: alvo.tempo ?? 0, avisos: alvo.avisos ?? 0, motivo: alvo.motivo || '', comando: r.comando,
          nome: r.nome, discord: r.discord || '', organizacao: r.organizacao, em: r.em || p.aplicadaEm, quando: quandoBr(r.em || p.aplicadaEm), pc: r.pc || p.aplicadaPor?.nomePc || '',
          aceitoPor: p.aceitoPor?.nome || '', retiradaEm: r.retiradaEm, retiradaPor: r.retiradaPor || '',
          link: p.msgDiscord?.link || '',
          nota: notaParaJogo(p.nota),
          confirmado: r.confirmado !== false
        });
      }
    }
    itens.sort((a, b) => new Date(b.em || 0) - new Date(a.em || 0));
    res.json({ ok: true, itens: itens.slice(0, 60) });
  }));

  // Reserva a retirada (só um PC consegue) e devolve o alvo para o jogo montar o comando.
  router.post('/historico/:punicaoId/:alvoId/retirar', rota(async (req, res) => {
    const { guildId, instalacao } = req.ponte;
    const punicaoId = idValido(req.params.punicaoId);
    const alvoId = idValido(req.params.alvoId);
    const punicao = await PontePunicao.findOneAndUpdate(
      { _id: punicaoId, guildId, resultado: { $elemMatch: { alvoId, ok: true, retiradaEm: null } } },
      { $set: { 'resultado.$.retiradaEm': new Date(), 'resultado.$.retiradaPor': instalacao.nome } },
      { new: true }
    ).lean();
    if (!punicao) throw new ErroPonte(409, 'Punição não encontrada ou já retirada.');
    const alvo = (punicao.alvos || []).find(a => String(a._id) === String(alvoId)) || {};
    await auditar(req, 'retirar', { punicaoId: punicao._id, contaId: alvo.contaId || '', comando: alvo.cmd || '' });
    res.json({ ok: true, alvo: { contaId: alvo.contaId, cmd: alvo.cmd, tempo: alvo.tempo, motivo: alvo.motivo } });
  }));

  router.use((req, res) => res.status(404).json({ ok: false, erro: 'Rota não encontrada.' }));

  router.use((erro, req, res, next) => {
    const status = erro.status
      || (erro.type === 'entity.too.large' ? 413 : null)
      || (erro.type === 'entity.parse.failed' ? 400 : null)
      || 500;
    if (status >= 500) log?.error?.(`Erro na API da ponte (${req.method} ${req.path}): ${erro.stack || erro.message}`);
    res.status(status).json({ ok: false, erro: status === 500 ? 'Erro interno.' : erro.message });
  });

  return router;
}

module.exports = { criarApiJogo, liberarExecucoesPresas, EXECUCAO_PRESA_MS };
