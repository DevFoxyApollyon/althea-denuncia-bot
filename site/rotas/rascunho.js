// Rascunho da denúncia guardado na conta: a pessoa começa no celular e
// termina no computador.
const express = require('express');
const RascunhoDenuncia = require('../../models/RascunhoDenuncia');
const { acessoAoServidor } = require('../acesso');
const { ErroHttp, assincrono, criarLimitador } = require('./comum');

const CAMPOS = { platform: 10, acusado: 100, categoria: 40, detalhes: 75, provas: 1000 };

// Só os campos do formulário, como texto e dentro do tamanho de cada um.
function limparRascunho(entrada) {
  return Object.fromEntries(Object.entries(CAMPOS).map(([campo, limite]) => [campo, String(entrada?.[campo] ?? '').slice(0, limite)]));
}

const temConteudo = (rascunho) => ['acusado', 'detalhes', 'provas'].some(campo => String(rascunho?.[campo] || '').trim());

function registrarRotasDeRascunho(router, { client }) {
  const podeSalvar = criarLimitador(60, 60 * 1000);

  async function acessoDe(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');
    return acesso;
  }

  router.get('/rascunho', assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.query.guildId);
    const rascunho = await RascunhoDenuncia.findOne({ usuarioId: req.usuario.id, guildId: acesso.guild.id }).lean();
    res.json({ rascunho: rascunho ? { ...limparRascunho(rascunho), atualizadoEm: rascunho.atualizadoEm } : null });
  }));

  router.put('/rascunho', express.json({ limit: '8kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.body?.guildId);
    if (!podeSalvar(req.usuario.id)) throw new ErroHttp(429, 'Muitas gravações em pouco tempo.');
    const rascunho = limparRascunho(req.body?.rascunho);
    const filtro = { usuarioId: req.usuario.id, guildId: acesso.guild.id };

    // Formulário vazio não ocupa espaço no banco.
    if (!temConteudo(rascunho)) {
      await RascunhoDenuncia.deleteOne(filtro);
      return res.json({ ok: true, atualizadoEm: null });
    }
    const atualizadoEm = new Date();
    await RascunhoDenuncia.updateOne(filtro, { $set: { ...rascunho, atualizadoEm } }, { upsert: true });
    res.json({ ok: true, atualizadoEm });
  }));

  router.delete('/rascunho', assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.query.guildId);
    await RascunhoDenuncia.deleteOne({ usuarioId: req.usuario.id, guildId: acesso.guild.id });
    res.json({ ok: true });
  }));
}

module.exports = { registrarRotasDeRascunho, limparRascunho, temConteudo };
