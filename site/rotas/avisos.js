// Avisos do responsável: aparecem no topo do site para todos os membros do
// servidor, até vencerem ou serem removidos.
const express = require('express');
const mongoose = require('mongoose');
const AvisoSite = require('../../models/AvisoSite');
const { acessoAoServidor } = require('../acesso');
const { resolverPessoas, ErroHttp, assincrono } = require('./comum');

const MAX_AVISOS_ATIVOS = 5;
const DURACOES_EM_HORAS = [0, 1, 6, 24, 72, 168];
const ativo = (aviso, agora = Date.now()) => !aviso.expiraEm || new Date(aviso.expiraEm).getTime() > agora;

// Confere o que veio do formulário e devolve o aviso limpo.
function validarAviso(entrada, agora = Date.now()) {
  const texto = String(entrada?.texto ?? '').trim();
  if (texto.length < 3) throw new Error('Escreva o aviso.');
  if (texto.length > 400) throw new Error('O aviso aceita até 400 caracteres.');

  const horas = Number(entrada?.horas || 0);
  if (!DURACOES_EM_HORAS.includes(horas)) throw new Error('Duração inválida.');

  return {
    texto,
    tipo: ['info', 'atencao', 'urgente'].includes(entrada?.tipo) ? entrada.tipo : 'info',
    expiraEm: horas ? new Date(agora + horas * 60 * 60 * 1000) : null
  };
}

function registrarRotasDeAvisos(router, { client }) {
  async function acessoDe(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');
    return acesso;
  }

  router.get('/avisos', assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.query.guildId);
    const avisos = (await AvisoSite.find({ guildId: acesso.guild.id }).sort({ criadoEm: -1 }).limit(20).lean()).filter(item => ativo(item));
    const pessoas = acesso.papeis.responsavel ? await resolverPessoas(client, acesso.guild, avisos.map(item => item.criadoPor)) : {};

    res.json({
      avisos: avisos.map(item => ({
        id: String(item._id),
        texto: item.texto,
        tipo: item.tipo,
        criadoEm: item.criadoEm,
        expiraEm: item.expiraEm,
        // Só o responsável vê quem publicou.
        ...(acesso.papeis.responsavel ? { por: pessoas[item.criadoPor]?.nome || 'Responsável' } : {})
      }))
    });
  }));

  router.post('/avisos', express.json({ limit: '8kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.body?.guildId);
    if (!acesso.papeis.responsavel) throw new ErroHttp(403, 'Só o responsável pode publicar avisos.');

    let aviso;
    try {
      aviso = validarAviso(req.body);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }
    const ativos = (await AvisoSite.find({ guildId: acesso.guild.id }).select('expiraEm').lean()).filter(item => ativo(item)).length;
    if (ativos >= MAX_AVISOS_ATIVOS) throw new ErroHttp(409, `Já existem ${MAX_AVISOS_ATIVOS} avisos no ar. Remova um antes de publicar outro.`);

    await AvisoSite.create({ guildId: acesso.guild.id, criadoPor: req.usuario.id, ...aviso });
    res.status(201).json({ ok: true, mensagem: 'Aviso publicado para todos os membros do servidor.' });
  }));

  router.delete('/avisos/:id', assincrono(async (req, res) => {
    const acesso = await acessoDe(req, req.query.guildId);
    if (!acesso.papeis.responsavel) throw new ErroHttp(403, 'Só o responsável pode remover avisos.');
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Aviso não encontrado.');

    await AvisoSite.deleteOne({ _id: req.params.id, guildId: acesso.guild.id });
    res.json({ ok: true, mensagem: 'Aviso removido.' });
  }));
}

module.exports = { registrarRotasDeAvisos, validarAviso, DURACOES_EM_HORAS };
