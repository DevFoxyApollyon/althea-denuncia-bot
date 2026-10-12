// Rotas do painel da staff: ações do caso, finalização, notas internas, números e ranking.
const express = require('express');
const mongoose = require('mongoose');
const Denuncia = require('../../models/Denuncia');
const NotaInterna = require('../../models/NotaInterna');
const ModerationAction = require('../../models/ModerationAction');
const { avisarMudanca } = require('../../utils/eventosDenuncia');
const { loadRank } = require('../../commands/rank');
const { categoriaDoMotivo, prazoDoSla, slaHorasDoServidor, configVisivel, PADRAO } = require('../categorias');
const { salvarConfigDoSite, restaurarConfigDoSite } = require('../configSite');
const AcessoCaso = require('../../models/AcessoCaso');
const ChatModeracao = require('../../models/ChatModeracao');
const { handleStatusButton, handlePunishmentModal, handleClaimButton } = require('../../Handlers/handlerStatusButton');
const { handleExportButton } = require('../../Handlers/exportDenuncia');
const { bloquearReivindicacaoSeHouverPendentes } = require('../../utils/avisoPendentesAnteriores');
const { bloquearReivindicacaoSemTeste } = require('../../utils/testesObrigatorios');
const { acessoAoServidor } = require('../acesso');
const { criarInteracaoSite, resultadoDaInteracao } = require('../interacaoSite');
const {
  STATUS_ABERTOS,
  resolverPessoas,
  chaveDoDia,
  ErroHttp,
  assincrono,
  exigirDenunciaAberta
} = require('./comum');

function registrarRotasDaStaff(router, { client, carregarDenuncia, buscarTopico, podeEscrever, podeFinalizar, finalizandoDenuncias }) {
  router.post('/denuncias/:id/acoes', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const { denuncia, acesso } = await carregarDenuncia(req);
    exigirDenunciaAberta(denuncia);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode executar esta ação.');
    if (!podeEscrever(req.usuario.id)) throw new ErroHttp(429, 'Muitas ações em pouco tempo. Aguarde um minuto.');

    const acao = String(req.body?.acao || '');
    if (!['reivindicar', 'analisar', 'aceitar', 'recusar'].includes(acao)) throw new ErroHttp(400, 'Ação desconhecida.');

    const topico = await buscarTopico(denuncia);
    const user = await client.users.fetch(req.usuario.id);
    const base = {
      client,
      guild: acesso.guild,
      member: acesso.member,
      user,
      channel: topico,
      message: {
        id: denuncia.messageId,
        url: `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`
      }
    };

    let interacao;

    if (acao === 'reivindicar') {
      interacao = criarInteracaoSite({ ...base, customId: 'reivindicar' });
      // Mesma checagem que o evento do Discord faz antes do botão.
      if (!await bloquearReivindicacaoSemTeste(interacao) && !await bloquearReivindicacaoSeHouverPendentes(interacao)) await handleClaimButton(interacao);
    } else if (acao === 'aceitar') {
      const campos = {
        acusadoId: String(req.body?.acusadoId || '').trim(),
        motivo: String(req.body?.motivo || '').trim(),
        data: String(req.body?.data || '').trim()
      };
      if (!campos.acusadoId || !campos.motivo || !campos.data) throw new ErroHttp(400, 'Informe o ID do acusado, o motivo e a data da punição.');
      if (campos.motivo.length > 1000) throw new ErroHttp(400, 'O motivo da punição aceita até 1000 caracteres.');

      // No Discord, "Aceitar" valida as permissões e abre o formulário de punição;
      // aqui os dois passos acontecem em sequência.
      interacao = criarInteracaoSite({ ...base, customId: 'aceitar' });
      await handleStatusButton(interacao, 'aceitar');
      if (interacao.modal) {
        interacao = criarInteracaoSite({ ...base, campos, tipo: 'modal', customId: 'punishment_modal' });
        await handlePunishmentModal(interacao);
      }
    } else {
      const status = acao === 'analisar' ? 'analiser' : 'recusar';
      interacao = criarInteracaoSite({ ...base, customId: status });
      await handleStatusButton(interacao, status);
    }

    const resultado = resultadoDaInteracao(interacao);
    const atual = await Denuncia.findById(denuncia._id).select('status claimedBy').lean();
    res.status(resultado.ok ? 200 : 409).json({ ...resultado, status: atual?.status, claimedBy: atual?.claimedBy || null });
  }));

  router.post('/denuncias/:id/finalizar', assincrono(async (req, res) => {
    const { denuncia, acesso } = await carregarDenuncia(req);
    if (!acesso.papeis.responsavel) throw new ErroHttp(403, 'Apenas o responsável administrativo pode finalizar denúncias.');
    if (!STATUS_ABERTOS.includes(denuncia.status)) throw new ErroHttp(409, 'Esta denúncia já foi finalizada.');
    if (!podeFinalizar(req.usuario.id)) throw new ErroHttp(429, 'Muitas tentativas de finalização. Aguarde um minuto.');
    const idDenuncia = String(denuncia._id);
    if (finalizandoDenuncias.has(idDenuncia)) throw new ErroHttp(409, 'Esta denúncia já está sendo finalizada.');

    finalizandoDenuncias.add(idDenuncia);
    try {
      const topico = await buscarTopico(denuncia);
      if (!topico.isThread?.()) throw new ErroHttp(409, 'O canal desta denúncia não é um tópico válido.');
      if (topico.locked) throw new ErroHttp(409, 'O tópico já está trancado no Discord.');

      const user = await client.users.fetch(req.usuario.id);
      const interacao = criarInteracaoSite({
        client,
        guild: acesso.guild,
        member: acesso.member,
        user,
        channel: topico,
        customId: 'finalizar_denuncia'
      });
      await handleExportButton(interacao);

      const atual = await Denuncia.findById(denuncia._id).select('status').lean();
      if (atual?.status !== 'finalizada') {
        const resultado = resultadoDaInteracao(interacao, 'Não foi possível finalizar a denúncia.');
        throw new ErroHttp(409, resultado.mensagem || 'A exportação não foi concluída; a denúncia continua aberta.');
      }

      res.json({ ok: true, mensagem: 'Denúncia exportada e finalizada.' });
    } finally {
      finalizandoDenuncias.delete(idDenuncia);
    }
  }));

  router.post('/denuncias/:id/notas', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const { denuncia, acesso } = await carregarDenuncia(req);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'As notas internas são restritas à staff.');
    if (!podeEscrever(req.usuario.id)) throw new ErroHttp(429, 'Muitas ações em pouco tempo. Aguarde um minuto.');

    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new ErroHttp(400, 'Escreva a nota antes de salvar.');
    if (texto.length > 1000) throw new ErroHttp(400, 'A nota aceita até 1000 caracteres.');

    await NotaInterna.create({
      denunciaId: denuncia._id,
      guildId: denuncia.guildId,
      autorId: req.usuario.id,
      texto,
      expiraEm: denuncia.dataExpiracao || null
    });
    avisarMudanca(denuncia.threadId);
    res.status(201).json({ ok: true });
  }));

  // Números do período para o responsável: volume por dia, categorias e taxa de aceite.
  router.get('/numeros', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'Os números são restritos ao responsável.');

    const dias = [7, 30, 45].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - (dias - 1));

    const casos = await Denuncia.find({ guildId: acesso.guild.id, dataCriacao: { $gte: inicio } })
      .select('motivo status platform dataCriacao claimedAt feedbackNota').limit(10000).lean();

    const porDia = new Map();
    for (let i = 0; i < dias; i++) {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      porDia.set(chaveDoDia(dia), 0);
    }
    const porCategoria = new Map();
    const porStatus = {};
    let somaEspera = 0;
    let reivindicadas = 0;
    let slaAvaliados = 0;
    let slaCumpridos = 0;
    let foraDoPrazo = 0;
    const agora = Date.now();
    const notas = [];

    for (const caso of casos) {
      const dia = chaveDoDia(new Date(caso.dataCriacao));
      if (porDia.has(dia)) porDia.set(dia, porDia.get(dia) + 1);
      const categoria = categoriaDoMotivo(caso.motivo, acesso.guild.id);
      porCategoria.set(categoria, (porCategoria.get(categoria) || 0) + 1);
      porStatus[caso.status] = (porStatus[caso.status] || 0) + 1;
      if (caso.claimedAt) {
        somaEspera += Math.max(0, new Date(caso.claimedAt) - new Date(caso.dataCriacao));
        reivindicadas++;
      }
      if (caso.feedbackNota) notas.push(caso.feedbackNota);

      // SLA: conta quem foi reivindicado e quem já estourou o prazo sem ser.
      const prazo = prazoDoSla(caso.motivo, caso.dataCriacao, acesso.guild.id).getTime();
      if (caso.claimedAt) {
        slaAvaliados++;
        if (new Date(caso.claimedAt).getTime() <= prazo) slaCumpridos++;
      } else if (agora > prazo) {
        slaAvaliados++;
        if (caso.status === 'pendente') foraDoPrazo++;
      }
    }

    const aceitas = porStatus.aceita || 0;
    const recusadas = porStatus.recusada || 0;

    res.json({
      dias,
      total: casos.length,
      porDia: [...porDia].map(([dia, total]) => ({ dia, total })),
      porCategoria: [...porCategoria].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total).slice(0, 10),
      porStatus,
      // Só entram casos com decisão ainda visível; os finalizados perdem essa informação.
      taxaDeAceite: aceitas + recusadas ? aceitas / (aceitas + recusadas) : null,
      minutosAteReivindicar: reivindicadas ? Math.round(somaEspera / reivindicadas / 60000) : null,
      notaMedia: notas.length ? notas.reduce((soma, nota) => soma + nota, 0) / notas.length : null,
      avaliacoes: notas.length,
      slaCumprido: slaAvaliados ? slaCumpridos / slaAvaliados : null,
      foraDoPrazo,
      slaHoras: slaHorasDoServidor(acesso.guild.id)
    });
  }));

  // Configurações do site (categorias, prazos de SLA e respostas prontas), por servidor.
  router.get('/config-site', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'As configurações são restritas ao responsável.');
    res.json({ config: configVisivel(acesso.guild.id), padrao: PADRAO });
  }));

  router.post('/config-site', express.json({ limit: '128kb' }), assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.body?.guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'As configurações são restritas ao responsável.');

    if (req.body?.restaurar === true) {
      await restaurarConfigDoSite(acesso.guild.id);
      return res.json({ ok: true, mensagem: 'Configurações restauradas para o padrão.', config: configVisivel(acesso.guild.id) });
    }

    try {
      await salvarConfigDoSite(acesso.guild.id, req.body?.config, req.usuario.id);
    } catch (erro) {
      if (erro.name === 'ValidationError' || !erro.code) throw new ErroHttp(400, erro.message);
      throw erro;
    }
    res.json({ ok: true, mensagem: 'Configurações salvas.', config: configVisivel(acesso.guild.id) });
  }));

  // Últimas ações da staff no servidor inteiro, para o painel do responsável.
  router.get('/auditoria', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'A auditoria é restrita ao responsável.');

    const acoes = await ModerationAction.find({ guildId: acesso.guild.id })
      .sort({ timestamp: -1 }).limit(80).select('moderatorId action denunciaId timestamp').lean();

    const ids = [...new Set(acoes.map(acao => acao.denunciaId).filter(id => mongoose.isValidObjectId(id)))];
    const casos = new Map((await Denuncia.find({ _id: { $in: ids } }).select('acusado motivo status').lean())
      .map(caso => [String(caso._id), caso]));
    // Denúncias abertas podem ser vistas por qualquer membro: aqui fica quem viu.
    const acessos = await AcessoCaso.find({ guildId: acesso.guild.id, relacao: 'participante' })
      .sort({ em: -1 }).limit(80).select('denunciaId usuarioId em').lean();
    const idsDosAcessos = [...new Set(acessos.map(item => String(item.denunciaId)))].filter(id => !casos.has(id));
    for (const caso of await Denuncia.find({ _id: { $in: idsDosAcessos } }).select('acusado motivo status').lean()) {
      casos.set(String(caso._id), caso);
    }
    const resumoDoCaso = (id) => {
      const caso = casos.get(String(id));
      return caso ? { id: String(caso._id), acusado: caso.acusado, motivo: caso.motivo, status: caso.status } : null;
    };

    // Apagar mensagem, castigo e banimento no chat do site.
    const chat = await ChatModeracao.find({ guildId: acesso.guild.id }).sort({ em: -1 }).limit(80).lean();

    const pessoas = await resolverPessoas(client, acesso.guild, [
      ...acoes.map(acao => acao.moderatorId),
      ...chat.flatMap(item => [item.staffId, item.alvoId]),
      ...acessos.map(item => item.usuarioId)
    ]);

    res.json({
      pessoas,
      acessosAbertos: acessos.map(item => ({ usuarioId: item.usuarioId, em: item.em, caso: resumoDoCaso(item.denunciaId) })),
      chat: chat.map(item => ({ staffId: item.staffId, alvoId: item.alvoId, acao: item.acao, motivo: item.motivo, minutos: item.minutos, trecho: item.trecho, em: item.em })),
      acoes: acoes.map(acao => {
        const caso = casos.get(String(acao.denunciaId));
        return {
          autorId: acao.moderatorId,
          acao: acao.action,
          data: acao.timestamp,
          // Casos já apagados pelo prazo de 45 dias ficam sem link.
          caso: caso ? { id: String(caso._id), acusado: caso.acusado, motivo: caso.motivo, status: caso.status } : null
        };
      })
    });
  }));

  // Mesmos números do /rank do Discord (commands/rank.js), mais o tempo médio
  // entre a abertura da denúncia e a reivindicação.
  router.get('/ranking', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso?.papeis.staff) throw new ErroHttp(403, 'O ranking é restrito à staff.');

    const tipo = { hoje: 'day', semana: 'week', mes: 'month' }[req.query.periodo] || 'month';
    const dados = await loadRank(acesso.guild, tipo);

    const tempos = await Denuncia.aggregate([
      { $match: { guildId: acesso.guild.id, claimedBy: { $nin: [null, ''] }, claimedAt: { $gte: dados.period.start } } },
      { $group: { _id: '$claimedBy', mediaMs: { $avg: { $subtract: ['$claimedAt', '$dataCriacao'] } } } }
    ]).catch(() => []);
    const tempoPorStaff = new Map(tempos.map(item => [item._id, item.mediaMs]));
    const pessoas = await resolverPessoas(client, acesso.guild, dados.actions.map(item => item.userId));

    res.json({
      periodo: req.query.periodo || 'mes',
      hoje: dados.daily,
      totais: dados.totals,
      qualidade: dados.qualidade.media === null ? null : { media: dados.qualidade.media, avaliacoes: dados.qualidade.avaliacoes },
      staff: dados.actions.map(item => ({
        id: item.userId,
        nome: pessoas[item.userId]?.nome || item.plainTag,
        avatar: pessoas[item.userId]?.avatar || null,
        cor: pessoas[item.userId]?.cor || null,
        total: item.total,
        aceitas: item.aceitas,
        recusadas: item.recusadas,
        analises: item.analises,
        reivindicacoes: item.reivindicacoes,
        qualidade: item.qualidade ? { media: item.qualidade.media, avaliacoes: item.qualidade.avaliacoes } : null,
        minutosAteReivindicar: tempoPorStaff.has(item.userId) ? Math.max(0, Math.round(tempoPorStaff.get(item.userId) / 60000)) : null
      }))
    });
  }));
}

module.exports = { registrarRotasDaStaff };
