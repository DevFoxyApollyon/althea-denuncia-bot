// Denúncias abertas: em andamento e ainda sem todos os acusados ligados a uma
// conta do Discord. Como no Discord, qualquer membro do servidor pode abrir e
// falar nelas. Quem for um dos acusados pode se identificar; o site só aceita se
// o ID do apelido da pessoa estiver entre os acusados.
const express = require('express');
const mongoose = require('mongoose');
const Denuncia = require('../../models/Denuncia');
const { extrairContaDoNickname } = require('../../utils/nickUtils');
const { registrarTopicoRestrito } = require('../../utils/restricaoTopicos');
const { avisarMudanca } = require('../../utils/eventosDenuncia');
const { categoriaDoMotivo } = require('../categorias');
const { acessoAoServidor } = require('../acesso');
const { ErroHttp, assincrono } = require('./comum');

const STATUS_EM_ANDAMENTO = ['pendente', 'reivindicacao', 'analise'];
// A aba "Denúncias abertas" mostra o caso em qualquer situação (menos finalizado)
// enquanto algum acusado não estiver ligado a uma conta do Discord.
const STATUS_VISIVEIS = [...STATUS_EM_ANDAMENTO, 'aceita', 'recusada'];
const JANELA_MS = 45 * 24 * 60 * 60 * 1000;
const idsDoAcusado = (acusado) => String(acusado || '').split('+').map(id => id.trim().toLowerCase()).filter(Boolean);

// Ainda há acusado sem conta do Discord ligada a esta denúncia?
function faltaIdentificar(denuncia) {
  const identificados = new Set(denuncia.acusadoUserIds || []).size;
  return identificados < idsDoAcusado(denuncia.acusado).length;
}

function registrarRotasDeIdentificacao(router, { client, podeEscrever }) {
  router.get('/nao-identificadas', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

    const minhaConta = extrairContaDoNickname(acesso.member.nickname);
    const denuncias = (await Denuncia.find({
      guildId: acesso.guild.id,
      status: { $in: STATUS_VISIVEIS },
      dataCriacao: { $gte: new Date(Date.now() - JANELA_MS) },
      criadoPor: { $ne: req.usuario.id },
      acusadoUserIds: { $ne: req.usuario.id }
    }).sort({ dataCriacao: -1 }).limit(400).select('acusado acusadoUserIds restritoParticipacao motivo platform status dataCriacao').lean())
      // Entra quem ainda tem acusado sem conta do Discord: nenhum identificado,
      // ou menos identificados do que acusados (1 marcado e 2 denunciados, por exemplo).
      .filter(denuncia => faltaIdentificar(denuncia)).slice(0, 150);

    res.json({
      minhaConta,
      denuncias: denuncias.map(denuncia => ({
        id: String(denuncia._id),
        acusado: denuncia.acusado,
        motivo: denuncia.motivo,
        categoria: categoriaDoMotivo(denuncia.motivo, denuncia.guildId),
        platform: denuncia.platform,
        status: denuncia.status,
        dataCriacao: denuncia.dataCriacao,
        acusados: idsDoAcusado(denuncia.acusado).length,
        identificados: (denuncia.acusadoUserIds || []).length,
        ehVoce: Boolean(minhaConta) && idsDoAcusado(denuncia.acusado).includes(String(minhaConta).toLowerCase())
      }))
    });
  }));

  // Antes de abrir uma denúncia: já existe caso em andamento contra esses IDs?
  router.get('/duplicadas', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

    const ids = idsDoAcusado(String(req.query.acusado || '').slice(0, 120)).slice(0, 6);
    if (!ids.length) return res.json({ total: 0, suas: 0, categorias: [] });

    const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const casos = await Denuncia.find({
      guildId: acesso.guild.id,
      status: { $in: STATUS_EM_ANDAMENTO },
      $or: ids.map(id => ({ acusado: new RegExp(`(^|\\+)\\s*${escapar(id)}\\s*(\\+|$)`, 'i') }))
    }).limit(20).select('motivo criadoPor').lean();

    res.json({
      total: casos.length,
      suas: casos.filter(caso => caso.criadoPor === req.usuario.id).length,
      categorias: [...new Set(casos.map(caso => categoriaDoMotivo(caso.motivo, acesso.guild.id)))]
    });
  }));

  router.post('/denuncias/:id/identificar', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Denúncia não encontrada.');
    const denuncia = await Denuncia.findById(req.params.id);
    const acesso = denuncia && await acessoAoServidor(client, req.usuario.id, denuncia.guildId);
    if (!acesso || !STATUS_VISIVEIS.includes(denuncia.status)) throw new ErroHttp(404, 'Denúncia não encontrada.');
    if (!podeEscrever(req.usuario.id)) throw new ErroHttp(429, 'Muitas ações em pouco tempo. Aguarde um minuto.');
    if (denuncia.criadoPor === req.usuario.id) throw new ErroHttp(400, 'Você é o denunciante deste caso.');

    // A prova de identidade é a mesma do bot: o ID no apelido do servidor.
    const conta = extrairContaDoNickname(acesso.member.nickname);
    if (!conta) {
      throw new ErroHttp(400, 'Seu apelido no servidor não tem o ID da sua conta. Use /menu dentro do jogo para corrigir e tente de novo.');
    }
    if (!idsDoAcusado(denuncia.acusado).includes(String(conta).toLowerCase())) {
      throw new ErroHttp(403, `O ID do seu apelido (${conta}) não está entre os acusados desta denúncia.`);
    }

    // O tópico só fica restrito quando todos os acusados estiverem identificados;
    // até lá continua aberto a qualquer membro, como no Discord.
    const identificados = new Set([...(denuncia.acusadoUserIds || []), req.usuario.id]);
    const todosIdentificados = identificados.size >= idsDoAcusado(denuncia.acusado).length;
    const atualizada = await Denuncia.findByIdAndUpdate(
      denuncia._id,
      { $addToSet: { acusadoUserIds: req.usuario.id }, $set: { restritoParticipacao: todosIdentificados } },
      { new: true }
    );
    registrarTopicoRestrito(denuncia.threadId, denuncia.criadoPor, atualizada.acusadoUserIds, todosIdentificados);

    const topico = await client.channels.fetch(denuncia.threadId).catch(() => null);
    await topico?.send?.({
      content: `✅ **Acusado identificado**: <@${req.usuario.id}> (conta \`${conta}\`) se identificou pelo site como acusado.`,
      allowedMentions: { parse: [] }
    }).catch(() => {});
    avisarMudanca(denuncia.threadId);

    res.json({ ok: true, id: String(denuncia._id), mensagem: 'Identificação confirmada. Você já pode ver o caso e enviar sua contraprova.' });
  }));
}

module.exports = { registrarRotasDeIdentificacao, idsDoAcusado, faltaIdentificar };
