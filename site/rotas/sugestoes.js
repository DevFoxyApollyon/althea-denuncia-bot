// Rotas das sugestões enviadas pelos jogadores.
const express = require('express');
const mongoose = require('mongoose');
const Sugestao = require('../../models/Sugestao');
const { contemPalavraProibida, contemLinkProibido } = require('../../utils/strikeWords');
const { acessoAoServidor } = require('../acesso');
const { resolverPessoas, ErroHttp, assincrono, criarLimitador } = require('./comum');

function registrarRotasDeSugestoes(router, { client }) {
  // Sugestões: o jogador vê as próprias; só o responsável vê todas e responde.
  const podeSugerir = criarLimitador(3, 24 * 60 * 60 * 1000);

  router.get('/sugestoes', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

    const todas = acesso.papeis.responsavel && req.query.escopo === 'staff';
    const sugestoes = await Sugestao.find(todas ? { guildId: acesso.guild.id } : { guildId: acesso.guild.id, autorId: req.usuario.id })
      .sort({ criadaEm: -1 }).limit(100).lean();
    const pessoas = await resolverPessoas(client, acesso.guild, sugestoes.flatMap(item => [item.autorId, item.respondidaPor]));

    res.json({
      pessoas,
      sugestoes: sugestoes.map(item => ({
        id: String(item._id),
        autorId: item.autorId,
        texto: item.texto,
        status: item.status,
        resposta: item.resposta || '',
        respondidaPor: item.respondidaPor,
        respondidaEm: item.respondidaEm,
        criadaEm: item.criadaEm
      }))
    });
  }));

  router.post('/sugestoes', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.body?.guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

    const texto = String(req.body?.texto || '').trim();
    if (texto.length < 10) throw new ErroHttp(400, 'Descreva a sugestão com pelo menos 10 caracteres.');
    if (texto.length > 1000) throw new ErroHttp(400, 'A sugestão aceita até 1000 caracteres.');
    if (contemLinkProibido(texto)) throw new ErroHttp(400, 'A sugestão contém um link que não é permitido.');
    if (contemPalavraProibida(texto)) throw new ErroHttp(400, 'A sugestão contém palavras que não são permitidas.');
    if (!podeSugerir(req.usuario.id)) throw new ErroHttp(429, 'Você já enviou 3 sugestões nas últimas 24 horas.');

    const sugestao = await Sugestao.create({ guildId: acesso.guild.id, autorId: req.usuario.id, texto });

    // Opcional: também publica num canal do Discord (SUGESTOES_CHANNEL_ID no .env).
    const canalId = String(process.env.SUGESTOES_CHANNEL_ID || '').trim();
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (canal?.isTextBased?.() && canal.guild?.id === acesso.guild.id) {
      await canal.send({ content: `💡 **Nova sugestão** de <@${req.usuario.id}>\n${texto}`, allowedMentions: { parse: [] } }).catch(() => {});
    }

    res.status(201).json({ ok: true, id: String(sugestao._id), mensagem: 'Sugestão enviada. A administração vai avaliar.' });
  }));

  router.post('/sugestoes/:id/resposta', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Sugestão não encontrada.');
    const sugestao = await Sugestao.findById(req.params.id);
    const acesso = sugestao && await acessoAoServidor(client, req.usuario.id, sugestao.guildId);
    if (!acesso) throw new ErroHttp(404, 'Sugestão não encontrada.');
    if (!acesso.papeis.responsavel) throw new ErroHttp(403, 'Só o responsável responde sugestões.');

    const status = String(req.body?.status || '');
    if (!['nova', 'analise', 'aceita', 'recusada'].includes(status)) throw new ErroHttp(400, 'Status inválido.');
    const resposta = String(req.body?.resposta || '').trim();
    if (resposta.length > 1000) throw new ErroHttp(400, 'A resposta aceita até 1000 caracteres.');

    sugestao.status = status;
    sugestao.resposta = resposta;
    sugestao.respondidaPor = req.usuario.id;
    sugestao.respondidaEm = new Date();
    await sugestao.save();
    res.json({ ok: true, mensagem: 'Sugestão atualizada.' });
  }));
}

module.exports = { registrarRotasDeSugestoes };
