// Ferramentas do responsável: saúde do bot, tópicos do Discord, registro de
// logins, backup das configurações e metas da staff.
const express = require('express');
const Denuncia = require('../../models/Denuncia');
const Config = require('../../models/Config');
const ModerationAction = require('../../models/ModerationAction');
const MetaStaff = require('../../models/MetaStaff');
const LoginSite = require('../../models/LoginSite');
const { primaryConnection, secondaryConnection } = require('../../utils/persistencia');
const { pausaDeDMs, avisosExtrasLigados } = require('../../utils/dmSegura');
const { resumoDosTopicos, limparEspelhosAbertos } = require('../../utils/espelhos');
const { ultimosRegistros } = require('../../utils/registroDeErros');
const StaffProfile = require('../../models/StaffProfile');
const { papeisDoMembro } = require('../acesso');
const { configVisivel } = require('../categorias');
const { salvarConfigDoSite, restaurarConfigDoSite } = require('../configSite');
const { salvarPainel } = require('./painelBot');
const { acessoAoServidor } = require('../acesso');
const { resolverPessoas, ErroHttp, assincrono } = require('./comum');
const versaoDoBot = require('../../package.json').version;

const DIA_MS = 24 * 60 * 60 * 1000;
const ESTADOS_DO_BANCO = ['desconectado', 'conectado', 'conectando', 'desconectando'];
const VERSAO_DO_BACKUP = 1;
// Mesmo critério do finalizador automático: denúncia aberta há 7 dias ou mais.
const STATUS_FINALIZAVEIS = ['pendente', 'analise', 'reivindicacao', 'aceita', 'recusada'];

// Quem está abaixo da meta: cada pessoa da staff e quantas denúncias diferentes
// atendeu nos últimos 7 dias. Separado das rotas para poder ser testado.
function montarMetas(minimoSemanal, staffIds, atendimentosPorPessoa) {
  const ids = [...new Set([...staffIds, ...atendimentosPorPessoa.keys()])];
  const linhas = ids.map((id) => {
    const atendimentos = atendimentosPorPessoa.get(id) || 0;
    return { id, atendimentos, faltam: Math.max(0, minimoSemanal - atendimentos), naEquipe: staffIds.includes(id) };
  })
    // Quem saiu da equipe só aparece se atendeu algo na semana.
    .filter(linha => linha.naEquipe || linha.atendimentos > 0)
    .sort((a, b) => a.atendimentos - b.atendimentos || a.id.localeCompare(b.id));

  return {
    minimoSemanal,
    linhas,
    abaixo: minimoSemanal > 0 ? linhas.filter(linha => linha.naEquipe && linha.faltam > 0).length : 0
  };
}

// Qualidade das decisões: uma decisão (aceita ou recusada) conta como revertida
// quando depois dela a mesma denúncia recebeu a decisão contrária.
// "acoes" vem em ordem de data: { moderatorId, action, denunciaId }.
function contarRevertidas(acoes) {
  const porPessoa = new Map();
  const ultimaDoCaso = new Map();
  const linha = (id) => {
    if (!porPessoa.has(id)) porPessoa.set(id, { decisoes: 0, revertidas: 0 });
    return porPessoa.get(id);
  };

  for (const acao of acoes) {
    if (!['aceita', 'recusada'].includes(acao.action) || !acao.denunciaId) continue;
    const anterior = ultimaDoCaso.get(acao.denunciaId);
    if (anterior && anterior.action !== acao.action) linha(anterior.moderatorId).revertidas += 1;
    // Repetir a mesma decisão no mesmo caso não conta duas vezes.
    if (!anterior || anterior.action !== acao.action) linha(acao.moderatorId).decisoes += 1;
    ultimaDoCaso.set(acao.denunciaId, acao);
  }
  return porPessoa;
}

// Confere o arquivo de backup antes de restaurar.
function lerBackup(entrada) {
  if (!entrada || typeof entrada !== 'object' || entrada.tipo !== 'althea-backup') throw new Error('Este arquivo não é um backup do Althea.');
  if (Number(entrada.versao) !== VERSAO_DO_BACKUP) throw new Error('Este backup é de uma versão que o site não sabe ler.');
  if (!entrada.painelBot || typeof entrada.painelBot !== 'object') throw new Error('O backup está sem as configurações do painel do bot.');
  return {
    painelBot: entrada.painelBot,
    configSite: entrada.configSite && typeof entrada.configSite === 'object' ? entrada.configSite : null,
    minimoSemanal: Math.min(1000, Math.max(0, Math.round(Number(entrada.minimoSemanal) || 0)))
  };
}

function registrarRotasDeGestao(router, { client }) {
  async function acessoDoResponsavel(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'Esta área é restrita ao responsável.');
    return acesso;
  }

  // ---------------------------------------------------------------- saúde do bot
  router.get('/saude', assincrono(async (req, res) => {
    await acessoDoResponsavel(req, req.query.guildId);
    const memoria = process.memoryUsage();
    const limite = new Date(Date.now() - 7 * DIA_MS);
    const [filaDoFinalizador, abertas] = await Promise.all([
      Denuncia.countDocuments({ status: { $in: STATUS_FINALIZAVEIS }, dataCriacao: { $lte: limite } }).catch(() => null),
      Denuncia.countDocuments({ status: { $in: ['pendente', 'reivindicacao', 'analise'] } }).catch(() => null)
    ]);
    const pausa = pausaDeDMs();

    res.json({
      versao: versaoDoBot,
      node: process.version,
      ligadoHaMs: Math.round(process.uptime() * 1000),
      memoria: { usadaMb: Math.round(memoria.rss / 1048576), heapMb: Math.round(memoria.heapUsed / 1048576) },
      discord: { conectado: client.isReady?.() ?? true, latenciaMs: Math.round(client.ws?.ping ?? -1), servidores: client.guilds.cache.size },
      bancos: [
        { nome: 'Principal', estado: ESTADOS_DO_BANCO[primaryConnection.readyState] || 'desconhecido' },
        { nome: 'Secundário', estado: ESTADOS_DO_BANCO[secondaryConnection.readyState] || 'desconhecido' }
      ],
      finalizador: { naFila: filaDoFinalizador, abertas },
      dms: { pausadaAte: pausa > Date.now() ? new Date(pausa) : null, avisosExtras: avisosExtrasLigados() },
      agora: new Date()
    });
  }));

  // ---------------------------------------------------------------- painel de erros
  // Últimos erros e avisos do bot e do site, guardados na memória desde que o bot ligou.
  router.get('/erros', assincrono(async (req, res) => {
    await acessoDoResponsavel(req, req.query.guildId);
    res.json({ registros: ultimosRegistros(150), ligadoHaMs: Math.round(process.uptime() * 1000) });
  }));

  // ---------------------------------------------------------------- tópicos do Discord
  router.get('/topicos', assincrono(async (req, res) => {
    await acessoDoResponsavel(req, req.query.guildId);
    res.json(await resumoDosTopicos(client, { forcar: req.query.atualizar === '1' }));
  }));

  // Fecha só os tópicos de denúncia e espelho abertos há 7 dias ou mais. Roda
  // por trás: um por segundo, para não bater no limite do Discord.
  router.post('/topicos/limpar', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    await acessoDoResponsavel(req, req.body?.guildId);
    const resumo = await resumoDosTopicos(client);
    if (resumo.limpeza.rodando) throw new ErroHttp(409, 'Já existe uma limpeza em andamento.');

    limparEspelhosAbertos(client, { soAntigos: true })
      .then(({ fechados }) => console.log(`[Espelhos] Limpeza pedida pelo site por ${req.usuario.id}: ${fechados} tópico(s) com 7 dias ou mais fechado(s).`))
      .catch(erro => console.warn(`[Espelhos] Limpeza pedida pelo site falhou: ${erro.message}`));
    res.json({ ok: true, mensagem: 'Limpeza iniciada. Só os tópicos abertos há 7 dias ou mais são fechados.' });
  }));

  // ---------------------------------------------------------------- registro de logins
  router.get('/logins', assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.query.guildId);
    const recentes = await LoginSite.find({}).sort({ em: -1 }).limit(400).lean();

    // O registro é do site inteiro; o responsável só vê quem é membro do servidor dele.
    const ids = [...new Set(recentes.map(item => item.usuarioId))];
    const faltando = ids.filter(id => !acesso.guild.members.cache.has(id)).slice(0, 100);
    const buscados = faltando.length ? await acesso.guild.members.fetch({ user: faltando }).catch(() => null) : null;
    const ehMembro = (id) => acesso.guild.members.cache.has(id) || Boolean(buscados?.has(id));

    const logins = recentes.filter(item => ehMembro(item.usuarioId)).slice(0, 150);
    const pessoas = await resolverPessoas(client, acesso.guild, logins.map(item => item.usuarioId));
    res.json({
      logins: logins.map((item) => {
        const membro = acesso.guild.members.cache.get(item.usuarioId) || buscados?.get(item.usuarioId);
        return {
          usuarioId: item.usuarioId, nome: pessoas[item.usuarioId]?.nome || item.nome, ip: item.ip, agente: item.agente, em: item.em,
          ipNovo: Boolean(item.ipNovo),
          staff: Boolean(membro && papeisDoMembro(membro, acesso.config).staff)
        };
      }),
      pessoas
    });
  }));

  // ---------------------------------------------------------------- backup
  router.get('/backup', assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.query.guildId);
    const [config, meta] = await Promise.all([
      Config.findOne({ guildId: acesso.guild.id }).lean(),
      MetaStaff.findOne({ guildId: acesso.guild.id }).lean()
    ]);
    const site = configVisivel(acesso.guild.id);

    res.json({
      tipo: 'althea-backup',
      versao: VERSAO_DO_BACKUP,
      geradoEm: new Date(),
      servidor: { id: acesso.guild.id, nome: acesso.guild.name },
      painelBot: {
        channels: { ...(config?.channels || {}) },
        roles: { ...(config?.roles || {}) },
        manutencao: Boolean(config?.manutencaoDenuncia),
        bloqueio: config?.bloquearReivindicacaoComPendentes !== false,
        somenteLeitura: Boolean(config?.siteSomenteLeitura)
      },
      // null = o servidor usa o padrão do site.
      configSite: site.personalizada ? { categorias: site.categorias, slaHoras: site.slaHoras, respostasProntas: site.respostasProntas } : null,
      minimoSemanal: meta?.minimoSemanal || 0
    });
  }));

  router.post('/backup', express.json({ limit: '256kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.body?.guildId);
    let backup;
    try {
      backup = lerBackup(req.body?.backup);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }

    // Passa pelas mesmas conferências de quem salva pela tela: canal ou cargo
    // que não existe mais, ou troca que tiraria o próprio acesso, é recusado.
    const { aviso } = await salvarPainel(client, acesso, backup.painelBot, req.usuario.id, { manterIsentos: true });
    try {
      if (backup.configSite) await salvarConfigDoSite(acesso.guild.id, backup.configSite, req.usuario.id);
      else await restaurarConfigDoSite(acesso.guild.id);
    } catch (erro) {
      throw new ErroHttp(400, `Painel do bot restaurado, mas as configurações do site não: ${erro.message}`);
    }
    await MetaStaff.findOneAndUpdate({ guildId: acesso.guild.id }, { $set: { minimoSemanal: backup.minimoSemanal, atualizadoPor: req.usuario.id } }, { upsert: true });

    res.json({ ok: true, mensagem: `Backup restaurado.${aviso}` });
  }));

  // ---------------------------------------------------------------- metas da staff
  async function metasDoServidor(acesso) {
    const { guild, config } = acesso;
    const meta = await MetaStaff.findOne({ guildId: guild.id }).lean();
    const desde = new Date(Date.now() - 7 * DIA_MS);

    // Atendimento = denúncia diferente em que a pessoa agiu (reivindicou, analisou, aceitou ou recusou).
    const acoes = await ModerationAction.aggregate([
      { $match: { guildId: guild.id, timestamp: { $gte: desde } } },
      { $group: { _id: { quem: '$moderatorId', caso: '$denunciaId' } } },
      { $group: { _id: '$_id.quem', atendimentos: { $sum: 1 } } }
    ]);
    const porPessoa = new Map(acoes.map(item => [item._id, item.atendimentos]));

    const cargos = [config.roles?.administrador, config.roles?.responsavel_admin].filter(Boolean);
    const staffIds = [...new Set(cargos.flatMap(id => [...(guild.roles.cache.get(id)?.members.keys() || [])]))];

    const metas = montarMetas(meta?.minimoSemanal || 0, staffIds, porPessoa);
    // Qualidade: decisões dos últimos 30 dias, quantas foram revertidas e a nota das avaliações.
    const decisoes = await ModerationAction.find({ guildId: guild.id, action: { $in: ['aceita', 'recusada'] }, timestamp: { $gte: new Date(Date.now() - 30 * DIA_MS) } })
      .sort({ timestamp: 1 }).limit(20000).select('moderatorId action denunciaId').lean();
    const revertidas = contarRevertidas(decisoes);
    const perfis = await StaffProfile.find({ guildId: guild.id, userId: { $in: [...revertidas.keys()] } }).lean().catch(() => []);
    const notaDe = new Map(perfis.map(perfil => [perfil.userId, perfil]));
    const idsDaQualidade = [...revertidas.keys()];
    const pessoas = await resolverPessoas(client, guild, [...metas.linhas.map(linha => linha.id), ...idsDaQualidade].slice(0, 60));

    const qualidade = idsDaQualidade.map((id) => {
      const { decisoes: total, revertidas: quantas } = revertidas.get(id);
      const perfil = notaDe.get(id);
      const avaliacoes = Number(perfil?.feedback?.count || 0);
      const media = avaliacoes ? Number(perfil.feedback.soma || 0) / avaliacoes : null;
      return { id, nome: pessoas[id]?.nome || 'Staff', decisoes: total, revertidas: quantas, taxa: total ? quantas / total : 0, nota: media, avaliacoes };
    }).sort((a, b) => b.taxa - a.taxa || b.revertidas - a.revertidas || b.decisoes - a.decisoes);

    return { ...metas, desde, qualidade, linhas: metas.linhas.map(linha => ({ ...linha, nome: pessoas[linha.id]?.nome || 'Staff', avatar: pessoas[linha.id]?.avatar || null })) };
  }

  router.get('/metas', assincrono(async (req, res) => {
    res.json(await metasDoServidor(await acessoDoResponsavel(req, req.query.guildId)));
  }));

  router.post('/metas', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.body?.guildId);
    const minimo = Number(req.body?.minimoSemanal);
    if (!Number.isInteger(minimo) || minimo < 0 || minimo > 1000) throw new ErroHttp(400, 'A meta precisa ser um número inteiro entre 0 e 1000.');

    await MetaStaff.findOneAndUpdate({ guildId: acesso.guild.id }, { $set: { minimoSemanal: minimo, atualizadoPor: req.usuario.id } }, { upsert: true });
    res.json({ ok: true, mensagem: minimo ? `Meta salva: ${minimo} atendimento(s) por semana.` : 'Meta desligada.', ...await metasDoServidor(acesso) });
  }));
}

module.exports = { registrarRotasDeGestao, montarMetas, lerBackup, contarRevertidas };
