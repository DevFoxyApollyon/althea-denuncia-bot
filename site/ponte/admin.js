// Painel web do dono do bot (/admin): servidores, PCs, gamemode, auditoria e códigos da ponte.
// Abre para OWNER_DISCORD_ID e para as pessoas que ele liberou (aba Acessos); para qualquer
// outro responde 404, para não revelar que a rota existe. O token de um PC nunca abre este painel.
// Só o dono: gerenciar acessos, trocar a chave mestra, gerar/expirar códigos e desativar servidores.
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const PonteServidor = require('../../models/PonteServidor');
const PonteInstalacao = require('../../models/PonteInstalacao');
const PonteCodigo = require('../../models/PonteCodigo');
const PonteUso = require('../../models/PonteUso');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const PontePedidoGm = require('../../models/PontePedidoGm');
const gestao = require('../../services/ponteSamp/gestao');
const motivos = require('../../services/ponteSamp/motivos');
const { reclassificarFila } = require('../../services/ponteSamp/aceite');
const { ACOES_USO, STATUS_PEDIDO_GM, VERSAO_INCLUDE_GM: VERSAO_INCLUDE } = require('../../services/ponteSamp/constantes');
const { chaveMestraConfigurada, impressaoDaChave } = require('../../services/ponteSamp/cifra');
const { trocarChaveMestra } = require('../../services/ponteSamp/chaveMestra');
const acessos = require('../../services/ponteSamp/acessoAdmin');
const { criarToken, lerToken } = require('../sessao');
const { criarLimitador } = require('../rotas/comum');

const PASTA = path.join(__dirname, 'painel');
const DURACAO_CSRF_MS = 2 * 60 * 60 * 1000;
const ONLINE_MS = 90 * 1000;
// A gamemode busca a cada 10 s com a fila vazia.
const ONLINE_GM_MS = 30 * 1000;

// arquivoEnv: só nos testes (a troca da chave mestra grava no .env do projeto).
function criarAdmin({ client, config, log, arquivoEnv }) {
  const router = express.Router();
  const limite = criarLimitador(120, 60 * 1000);
  const naoExiste = (res) => res.status(404).json({ erro: 'Rota não encontrada.' });
  const nomeGuild = (id) => client?.guilds?.cache?.get(id)?.name || '';

  router.use(async (req, res, next) => {
    if (!req.usuario || !(await acessos.podeAbrirPainel(req.usuario.id))) return naoExiste(res);
    if (!limite(req.usuario.id)) return res.status(429).json({ erro: 'Muitas requisições. Aguarde um minuto.' });
    req.dono = gestao.ehDono(req.usuario.id);
    res.set('Cache-Control', 'no-store');
    next();
  });
  const soDono = (req, res, next) => (req.dono ? next() : res.status(403).json({ erro: 'Só o dono do bot pode fazer isso.' }));

  router.get('/', (req, res) => res.sendFile(path.join(PASTA, 'index.html')));
  router.get(['/admin.js', '/admin.css'], (req, res) => res.sendFile(path.join(PASTA, path.basename(req.path))));

  router.use('/api', express.json({ limit: '8kb' }));
  router.get('/api/csrf', (req, res) => {
    res.json({ csrf: criarToken({ sid: req.sid, csrf: true }, config.segredo, DURACAO_CSRF_MS), dono: req.dono });
  });

  // A checagem de Origin do app já cobre os POSTs; o token CSRF é uma segunda barreira.
  router.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    const dados = lerToken(String(req.get('X-CSRF') || ''), config.segredo);
    if (!dados?.csrf || dados.sid !== req.sid) return res.status(403).json({ erro: 'Token CSRF inválido. Recarregue a página.' });
    next();
  });

  const rota = (fn) => (req, res) => fn(req, res).catch((erro) => {
    log?.error?.(`Erro no /admin (${req.method} ${req.path}): ${erro.stack || erro.message}`);
    res.status(500).json({ erro: 'Erro interno.' });
  });
  const idValido = (id) => mongoose.isValidObjectId(id);

  router.get('/api/servidores', rota(async (req, res) => {
    const [servidores, contagem] = await Promise.all([
      PonteServidor.find().sort({ ativadoEm: -1 }).limit(500).lean(),
      PonteInstalacao.aggregate([{ $match: { status: 'ativa' } }, { $group: { _id: '$guildId', total: { $sum: 1 } } }])
    ]);
    const pcs = new Map(contagem.map(c => [c._id, c.total]));
    res.json(servidores.map(s => ({
      guildId: s.guildId, nome: nomeGuild(s.guildId), ativo: s.ativo, ativadoEm: s.ativadoEm,
      limitePcs: s.limitePcs, pcs: pcs.get(s.guildId) || 0
    })));
  }));

  router.post('/api/servidores/:guildId/desativar', soDono, rota(async (req, res) => {
    if (!/^\d{5,25}$/.test(req.params.guildId)) return res.status(400).json({ erro: 'ID inválido.' });
    const s = await gestao.desativarGuild({ guildId: req.params.guildId, por: req.usuario.id });
    log?.info?.(`Ponte desativada pelo dono em ${req.params.guildId}`);
    res.json({ ok: !!s });
  }));

  router.get('/api/instalacoes', rota(async (req, res) => {
    const lista = await PonteInstalacao.find().sort({ criadoEm: -1 }).limit(500).lean();
    const agora = Date.now();
    res.json(lista.map(i => ({
      id: String(i._id), nome: i.nome, guildId: i.guildId, guild: nomeGuild(i.guildId), status: i.status,
      criadoPor: i.criadoPor, criadoEm: i.criadoEm, ultimoUsoEm: i.ultimoUsoEm, ultimoIp: i.ultimoIp,
      hwid: i.hwidHash ? i.hwidHash.slice(0, 8) : '', ultimos4: i.ultimos4, versaoScript: i.versaoScript,
      online: !!i.ultimoPingEm && agora - new Date(i.ultimoPingEm).getTime() < ONLINE_MS
    })));
  }));

  router.post('/api/instalacoes/:id/revogar', rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const r = await PonteInstalacao.updateOne(
      { _id: req.params.id },
      { $set: { status: 'revogada', revogadoEm: new Date(), revogadoPor: req.usuario.id } }
    );
    res.json({ ok: r.matchedCount === 1 });
  }));

  // Paginação por data: "antes" é o "em" do último item da página anterior.
  router.get('/api/uso', rota(async (req, res) => {
    const filtro = {};
    if (/^\d{5,25}$/.test(String(req.query.guildId || ''))) filtro.guildId = String(req.query.guildId);
    if (ACOES_USO.includes(String(req.query.acao || ''))) filtro.acao = String(req.query.acao);
    // "gm": todas as ações da ponte com a gamemode (gm_*).
    else if (req.query.acao === 'gm') filtro.acao = { $in: ACOES_USO.filter(a => a.startsWith('gm_')) };
    const antes = new Date(String(req.query.antes || ''));
    if (!Number.isNaN(antes.getTime())) filtro.em = { $lt: antes };
    const lista = await PonteUso.find(filtro).sort({ em: -1 }).limit(50).lean();
    res.json(lista.map(u => ({
      em: u.em, guildId: u.guildId, guild: nomeGuild(u.guildId), acao: u.acao, instalacaoId: u.instalacaoId ? String(u.instalacaoId) : '',
      contaId: u.contaId, nick: u.nick, comando: u.comando, ip: u.ip, detalhes: u.detalhes
    })));
  }));

  router.get('/api/codigos', rota(async (req, res) => {
    const lista = await PonteCodigo.find().sort({ criadoEm: -1 }).limit(200).lean();
    res.json(lista.map(c => ({
      id: String(c._id), ultimos4: c.ultimos4, criadoEm: c.criadoEm, expiraEm: c.expiraEm, limitePcs: c.limitePcs,
      usadoEm: c.usadoEm, usadoPorGuild: c.usadoPorGuild, guild: nomeGuild(c.usadoPorGuild), expirado: c.expirado
    })));
  }));

  router.post('/api/codigos', soDono, rota(async (req, res) => {
    const validadeDias = Number(req.body?.validadeDias) || null;
    const limitePcs = Number(req.body?.limitePcs) || null;
    if ((validadeDias && (validadeDias < 1 || validadeDias > 365)) || (limitePcs && (limitePcs < 1 || limitePcs > 50))) {
      return res.status(400).json({ erro: 'Validade (1–365) ou limite de PCs (1–50) inválido.' });
    }
    const { codigo } = await gestao.criarCodigo({ criadoPor: req.usuario.id, validadeDias, limitePcs });
    res.json({ ok: true, codigo });
  }));

  // Tabela de motivos (a mesma para todos os servidores).
  router.get('/api/motivos', rota(async (req, res) => {
    const { tabela, propria } = await motivos.obterTabela();
    res.json({ propria, tabela: tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.filter(s => s !== t.nome), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos, grupo: t.grupo })) });
  }));

  router.put('/api/motivos', rota(async (req, res) => {
    const salvo = await motivos.salvarTabela(req.body?.tabela, `site: ${req.usuario.nome}`);
    if (salvo.erro) return res.status(400).json({ erro: salvo.erro });
    reclassificarFila({ client, tabela: salvo.tabela }).catch(() => {});
    log?.info?.(`Tabela de motivos da ponte salva pelo site (${salvo.tabela.length} motivos).`);
    res.json({ ok: true, propria: salvo.propria, total: salvo.tabela.length });
  }));

  router.post('/api/codigos/:id/expirar', soDono, rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const r = await PonteCodigo.updateOne({ _id: req.params.id, usadoEm: null }, { $set: { expirado: true } });
    res.json({ ok: r.matchedCount === 1 });
  }));

  // Credenciais da gamemode. O segredo (nem cifrado) nunca sai daqui.
  router.get('/api/gamemode/conexoes', rota(async (req, res) => {
    const [lista, servidores] = await Promise.all([
      PonteConexaoGm.find({}, { segredoCifrado: 0 }).sort({ criadoEm: -1 }).limit(200).lean(),
      PonteServidor.find({}, { guildId: 1, executor: 1, gm: 1 }).lean()
    ]);
    const porGuild = new Map(servidores.map(s => [s.guildId, s]));
    const agora = Date.now();
    res.json(lista.map(c => {
      const servidor = porGuild.get(c.guildId);
      return {
        id: String(c._id), guildId: c.guildId, guild: nomeGuild(c.guildId), nome: c.nome, status: c.status, pausada: c.pausada,
        online: c.status === 'ativa' && !!c.ultimoContatoEm && agora - new Date(c.ultimoContatoEm).getTime() < ONLINE_GM_MS,
        ultimoContatoEm: c.ultimoContatoEm, ultimoIp: c.ultimoIp, versaoInclude: c.versaoInclude, modoTesteInformado: c.modoTesteInformado,
        ipsPermitidos: c.ipsPermitidos || [], ultimos4: c.ultimos4, criadoEm: c.criadoEm,
        executor: servidor?.executor || 'pc', guildPausada: servidor?.gm?.pausado === true, modoTesteGuild: servidor?.gm?.modoTeste !== false
      };
    }));
  }));

  router.post('/api/gamemode/conexoes/:id/revogar', rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' },
      { $set: { status: 'revogada', revogadoEm: new Date(), revogadoPor: req.usuario.id } },
      { projection: { guildId: 1 } }
    ).lean();
    if (c) await PonteUso.create({ guildId: c.guildId, acao: 'gm_credencial', detalhes: { sub: 'revogar', via: 'admin', conexaoId: req.params.id, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: !!c });
  }));

  router.post('/api/gamemode/conexoes/:id/pausar', rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const pausada = req.body?.pausada !== false;
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' }, { $set: { pausada } }, { projection: { guildId: 1 } }
    ).lean();
    if (c) await PonteUso.create({ guildId: c.guildId, acao: 'gm_config', detalhes: { sub: pausada ? 'pausar' : 'retomar', via: 'admin', conexaoId: req.params.id, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: !!c });
  }));

  // Pedidos recentes da gamemode, mais novos primeiro (filtro por status e guild).
  router.get('/api/gamemode/pedidos', rota(async (req, res) => {
    const filtro = {};
    if (STATUS_PEDIDO_GM.includes(String(req.query.status || ''))) filtro.status = String(req.query.status);
    if (/^\d{5,25}$/.test(String(req.query.guildId || ''))) filtro.guildId = String(req.query.guildId);
    const lista = await PontePedidoGm.find(filtro).sort({ criadoEm: -1 }).limit(100).lean();
    res.json(lista.map(p => ({
      id: String(p._id), punicaoId: String(p.punicaoId), guildId: p.guildId, guild: nomeGuild(p.guildId), rodada: p.rodada,
      tipo: p.tipo, conta: p.conta, nick: p.nick, tempo: p.tempo, avisos: p.avisos, motivo: p.motivo, aprovadoPor: p.aprovadoPor,
      teste: p.teste, status: p.status, codigo: p.codigo, entregas: p.entregas, devolucoes: p.devolucoes,
      criadoEm: p.criadoEm, entregueEm: p.entregueEm, resultado: p.resultado, resolvidoPor: p.resolvidoPor?.nome || ''
    })));
  }));

  // Pessoas liberadas no painel (pelo ID do Discord). Só o dono vê e mexe.
  router.get('/api/acessos', soDono, rota(async (req, res) => {
    const lista = await acessos.listarAcessos();
    res.json(lista.map(a => ({ userId: a.userId, nome: a.nome, adicionadoEm: a.adicionadoEm })));
  }));

  router.post('/api/acessos', soDono, rota(async (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    const usuario = /^\d{15,21}$/.test(userId) && client?.users ? await client.users.fetch(userId).catch(() => null) : null;
    const r = await acessos.adicionarAcesso({ userId, nome: usuario?.globalName || usuario?.username || '', por: req.usuario.id });
    if (r.erro) return res.status(400).json({ erro: r.erro });
    await PonteUso.create({ acao: 'gm_config', detalhes: { sub: 'acesso_admin_adicionar', userId, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: true, nome: r.acesso.nome, encontrado: !!usuario });
  }));

  router.post('/api/acessos/:userId/remover', soDono, rota(async (req, res) => {
    const ok = await acessos.removerAcesso(req.params.userId);
    if (ok) await PonteUso.create({ acao: 'gm_config', detalhes: { sub: 'acesso_admin_remover', userId: req.params.userId, por: req.usuario.id } }).catch(() => {});
    res.json({ ok });
  }));

  // Chave mestra da ponte com a gamemode: só a impressão (8 letras do SHA-256) sai daqui.
  router.get('/api/chave', rota(async (req, res) => {
    res.json({ configurada: chaveMestraConfigurada(), impressao: impressaoDaChave(), credenciais: await PonteConexaoGm.countDocuments({}) });
  }));

  // Gera a chave (ou troca a atual) e recifra os segredos das credenciais. A chave nova
  // aparece só nesta resposta, para o dono colar no .env do PC.
  router.post('/api/chave/trocar', soDono, rota(async (req, res) => {
    if (req.body?.confirmar !== 'TROCAR') return res.status(400).json({ erro: 'Confirme digitando TROCAR.' });
    const r = await trocarChaveMestra({ arquivo: arquivoEnv });
    if (r.erro) return res.status(409).json({ erro: r.erro });
    await PonteUso.create({
      acao: 'gm_credencial',
      detalhes: { sub: 'chave_mestra', via: 'admin', por: req.usuario.id, impressao: r.impressao, recifradas: r.recifradas, ilegiveis: r.ilegiveis, envGravado: r.envGravado }
    }).catch(() => {});
    log?.info?.(`Chave mestra da ponte trocada pelo dono (impressão ${r.impressao}, ${r.recifradas} credencial(is) recifrada(s)).`);
    res.json({ ok: true, ...r });
  }));

  // Guia de instalação: em que passo cada servidor está (chave, executor, credencial, contato, modo teste).
  router.get('/api/gamemode/guia', rota(async (req, res) => {
    const [servidores, conexoes, pedidos] = await Promise.all([
      PonteServidor.find({ ativo: true }, { guildId: 1, executor: 1, gm: 1 }).lean(),
      PonteConexaoGm.find({ status: 'ativa' }, { guildId: 1, ultimoContatoEm: 1, versaoInclude: 1, modoTesteInformado: 1, ipsPermitidos: 1, pausada: 1 }).lean(),
      PontePedidoGm.aggregate([{ $group: { _id: { guildId: '$guildId', status: '$status' }, total: { $sum: 1 } } }])
    ]);
    const agora = Date.now();
    const porStatus = (guildId, status) => pedidos.find(p => p._id.guildId === guildId && p._id.status === status)?.total || 0;
    res.json({
      chaveMestra: chaveMestraConfigurada(),
      versaoInclude: VERSAO_INCLUDE,
      servidores: servidores.map(s => {
        const daGuild = conexoes.filter(c => c.guildId === s.guildId);
        const contato = daGuild.map(c => c.ultimoContatoEm).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
        return {
          guildId: s.guildId,
          nome: nomeGuild(s.guildId),
          executor: s.executor || 'pc',
          pausado: s.gm?.pausado === true,
          modoTesteBot: s.gm?.modoTeste !== false,
          permitirPermanente: s.gm?.permitirPermanente !== false,
          credenciais: daGuild.length,
          semIp: daGuild.some(c => !(c.ipsPermitidos || []).length),
          pausadas: daGuild.filter(c => c.pausada).length,
          ultimoContatoEm: contato,
          online: !!contato && agora - new Date(contato).getTime() < ONLINE_GM_MS,
          versaoInclude: daGuild.find(c => c.versaoInclude)?.versaoInclude || '',
          // Algum contato informou modo teste ligado no jogo (null: ainda sem contato).
          modoTesteJogo: daGuild.some(c => c.modoTesteInformado === true) ? true : daGuild.some(c => c.modoTesteInformado === false) ? false : null,
          aplicadas: porStatus(s.guildId, 'aplicada'),
          simuladas: porStatus(s.guildId, 'simulada'),
          incertos: porStatus(s.guildId, 'incerto')
        };
      })
    });
  }));

  router.use((req, res) => naoExiste(res));
  return router;
}

module.exports = { criarAdmin };
