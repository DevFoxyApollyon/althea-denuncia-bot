// O que gira em volta das mensagens do chat: reações, mensagens sinalizadas,
// modo lento, chat fechado, música e quem está online.
const express = require('express');
const mongoose = require('mongoose');
const ChatMensagem = require('../../models/ChatMensagem');
const ChatBanimento = require('../../models/ChatBanimento');
const ChatModeracao = require('../../models/ChatModeracao');
const ChatSala = require('../../models/ChatSala');
const ChatSinalizacao = require('../../models/ChatSinalizacao');
const { avisarMudanca } = require('../../utils/eventosDenuncia');
const { acessoAoServidor } = require('../acesso');
const { resolverPessoas, ErroHttp, assincrono, criarLimitador } = require('./comum');

const EMOJIS = ['👍', '❤️', '😂', '😮', '✅', '❌'];
const MODOS_LENTOS_SEG = [0, 5, 10, 30, 60, 300];
const canalDoChat = (guildId) => `chat:${guildId}`;

// ---- quem está com o chat aberto agora, por servidor
const presenca = new Map();

function entrarNaPresenca(guildId, pessoa) {
  const conexao = Symbol('conexao');
  if (!presenca.has(guildId)) presenca.set(guildId, new Map());
  presenca.get(guildId).set(conexao, pessoa);
  return () => {
    const sala = presenca.get(guildId);
    sala?.delete(conexao);
    if (sala && !sala.size) presenca.delete(guildId);
  };
}

function quemEstaOnline(guildId) {
  const unicos = new Map();
  for (const pessoa of presenca.get(guildId)?.values() || []) unicos.set(pessoa.id, pessoa);
  // Staff primeiro, depois por nome.
  return [...unicos.values()].sort((a, b) => Number(b.staff) - Number(a.staff) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---- ajustes da sala
async function lerSala(guildId) {
  const sala = await ChatSala.findOne({ guildId }).lean().catch(() => null);
  return {
    modoLentoSeg: sala?.modoLentoSeg || 0,
    fechado: Boolean(sala?.fechado)
  };
}

// Lê um link de vídeo (usado no teste da staff) e devolve só o identificador:
// o site nunca embute um endereço que veio pronto de quem digitou.
function analisarMusica(link) {
  let url;
  try { url = new URL(String(link || '').trim()); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');

  if (host === 'youtu.be' || host === 'youtube.com') {
    const id = host === 'youtu.be'
      ? url.pathname.slice(1)
      : url.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([^/?]+)/.exec(url.pathname)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? { tipo: 'youtube', ref: id } : null;
  }
  if (host === 'open.spotify.com') {
    const partes = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})/.exec(url.pathname);
    return partes ? { tipo: 'spotify', ref: `${partes[1]}/${partes[2]}` } : null;
  }
  return null;
}

function serializarReacoes(reacoes, usuarioId) {
  return (reacoes || []).filter(item => item.usuarios?.length)
    .map(item => ({ emoji: item.emoji, total: item.usuarios.length, minha: item.usuarios.includes(usuarioId) }));
}

function registrarRotasDaSala(router, { client }) {
  const podeReagir = criarLimitador(30, 60 * 1000);
  const podeSinalizar = criarLimitador(5, 10 * 60 * 1000);
  const registrar = (dados) => ChatModeracao.create(dados).catch(() => {});

  async function exigirMembro(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');
    return acesso;
  }

  async function exigirStaff(req, guildId) {
    const acesso = await exigirMembro(req, guildId);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode fazer isso no chat.');
    return acesso;
  }

  async function buscarMensagem(id, guildId) {
    if (!mongoose.isValidObjectId(id)) throw new ErroHttp(404, 'Mensagem não encontrada.');
    const mensagem = await ChatMensagem.findOne({ _id: id, guildId, apagadaEm: null });
    if (!mensagem) throw new ErroHttp(404, 'Mensagem não encontrada.');
    return mensagem;
  }

  // Reagir: apertar de novo o mesmo emoji tira a reação.
  router.post('/chat/:id/reacoes', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.body?.guildId);
    const emoji = String(req.body?.emoji || '');
    if (!EMOJIS.includes(emoji)) throw new ErroHttp(400, 'Reação não disponível.');
    if (!podeReagir(req.usuario.id)) throw new ErroHttp(429, 'Muitas reações em pouco tempo. Aguarde um minuto.');

    const bloqueio = await ChatBanimento.findOne({ guildId: acesso.guild.id, usuarioId: req.usuario.id }).lean();
    if (bloqueio && (!bloqueio.expiraEm || new Date(bloqueio.expiraEm) > new Date())) throw new ErroHttp(403, 'Você não pode reagir enquanto estiver punido no chat.');

    const mensagem = await buscarMensagem(req.params.id, acesso.guild.id);
    const reacao = mensagem.reacoes.find(item => item.emoji === emoji);
    if (!reacao) mensagem.reacoes.push({ emoji, usuarios: [req.usuario.id] });
    else if (reacao.usuarios.includes(req.usuario.id)) reacao.usuarios.pull(req.usuario.id);
    else reacao.usuarios.push(req.usuario.id);
    await mensagem.save();

    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true });
  }));

  // Sinalizar uma mensagem para a staff olhar.
  router.post('/chat/:id/sinalizar', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.body?.guildId);
    const mensagem = await buscarMensagem(req.params.id, acesso.guild.id);
    if (mensagem.autorId === req.usuario.id) throw new ErroHttp(400, 'Esta mensagem é sua.');
    if (!podeSinalizar(req.usuario.id)) throw new ErroHttp(429, 'Muitas sinalizações em pouco tempo. Aguarde alguns minutos.');

    const motivo = String(req.body?.motivo || '').trim().slice(0, 200);
    await ChatSinalizacao.updateOne(
      { mensagemId: mensagem._id, por: req.usuario.id },
      { $setOnInsert: { guildId: acesso.guild.id, autorId: mensagem.autorId, trecho: (mensagem.texto || `[arquivo] ${mensagem.anexo?.nome || ''}`).slice(0, 160), motivo, em: new Date() } },
      { upsert: true }
    );
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.status(201).json({ ok: true, mensagem: 'Mensagem enviada para a staff analisar.' });
  }));

  router.get('/chat/sinalizacoes', assincrono(async (req, res) => {
    const acesso = await exigirStaff(req, req.query.guildId);
    const pendentes = await ChatSinalizacao.find({ guildId: acesso.guild.id, resolvidaEm: null }).sort({ em: -1 }).limit(30).lean();
    res.json({
      sinalizacoes: pendentes.map(item => ({ id: String(item._id), mensagemId: String(item.mensagemId), autorId: item.autorId, trecho: item.trecho, por: item.por, motivo: item.motivo, em: item.em })),
      pessoas: await resolverPessoas(client, acesso.guild, pendentes.flatMap(item => [item.autorId, item.por]))
    });
  }));

  // A staff resolve a sinalização apagando a mensagem ou só dispensando.
  router.post('/chat/sinalizacoes/:id/resolver', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirStaff(req, req.body?.guildId);
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Sinalização não encontrada.');
    const sinalizacao = await ChatSinalizacao.findOne({ _id: req.params.id, guildId: acesso.guild.id, resolvidaEm: null });
    if (!sinalizacao) throw new ErroHttp(404, 'Sinalização não encontrada.');

    if (req.body?.apagar) {
      const apagada = await ChatMensagem.findOneAndUpdate(
        { _id: sinalizacao.mensagemId, guildId: acesso.guild.id, apagadaEm: null },
        { $set: { apagadaPor: req.usuario.id, apagadaEm: new Date() } }
      );
      if (apagada) await registrar({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: apagada.autorId, acao: 'apagar', motivo: 'Mensagem sinalizada por um membro', trecho: sinalizacao.trecho });
    }
    // As outras sinalizações da mesma mensagem saem da fila junto.
    await ChatSinalizacao.updateMany(
      { guildId: acesso.guild.id, mensagemId: sinalizacao.mensagemId, resolvidaEm: null },
      { $set: { resolvidaPor: req.usuario.id, resolvidaEm: new Date() } }
    );
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true, mensagem: req.body?.apagar ? 'Mensagem apagada.' : 'Sinalização dispensada.' });
  }));

  // Modo lento e chat fechado.
  router.post('/chat/config', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirStaff(req, req.body?.guildId);
    const mudanca = {};
    if (req.body?.modoLentoSeg !== undefined) {
      const segundos = Number(req.body.modoLentoSeg);
      if (!MODOS_LENTOS_SEG.includes(segundos)) throw new ErroHttp(400, 'Intervalo de modo lento inválido.');
      mudanca.modoLentoSeg = segundos;
    }
    if (req.body?.fechado !== undefined) mudanca.fechado = Boolean(req.body.fechado);
    if (!Object.keys(mudanca).length) throw new ErroHttp(400, 'Nada para alterar.');

    await ChatSala.updateOne({ guildId: acesso.guild.id }, { $set: mudanca }, { upsert: true });
    const descricao = [
      mudanca.modoLentoSeg !== undefined && (mudanca.modoLentoSeg ? `Modo lento: ${mudanca.modoLentoSeg} s` : 'Modo lento desligado'),
      mudanca.fechado !== undefined && (mudanca.fechado ? 'Chat fechado' : 'Chat reaberto')
    ].filter(Boolean).join('. ');
    await registrar({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: req.usuario.id, acao: 'config', motivo: descricao });
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true, mensagem: `${descricao}.` });
  }));

}

module.exports = { registrarRotasDaSala, lerSala, analisarMusica, serializarReacoes, entrarNaPresenca, quemEstaOnline, EMOJIS, MODOS_LENTOS_SEG };
