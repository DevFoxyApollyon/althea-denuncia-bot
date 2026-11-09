const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');

test.after(fecharConexoes);

const Denuncia = require('../models/Denuncia');
const ticketExterno = require('../Handlers/ticketExterno');
const { handleAbrirTicket, botaoAbrirTicket, montarInfo, lerResposta, _ultimoPedido } = ticketExterno;

const CONFIG = { channels: { ponteTickets: '555' }, botaoTicketRevisao: true };
const LIGADO = async () => CONFIG;
const DENUNCIA = {
  guildId: '10', channelId: '20', messageId: '30', threadId: 'topico-1', motivo: 'Anti-RP na praça'
};

function comDenuncia(fn) {
  return async () => {
    const findOne = Denuncia.findOne;
    Denuncia.findOne = (filtro) => ({ lean: async () => (filtro.threadId === DENUNCIA.threadId ? DENUNCIA : null) });
    _ultimoPedido.clear();
    try {
      await fn();
    } finally {
      Denuncia.findOne = findOne;
    }
  };
}

// Canal ponte falso: "responder" decide o que o bot de tickets devolve a cada pedido.
function canalFalso(responder) {
  const enviados = [];
  let esperando = null;
  return {
    enviados,
    isTextBased: () => true,
    awaitMessages: ({ filter }) => new Promise((resolve) => { esperando = { filter, resolve }; }),
    send: async ({ content }) => {
      const pedido = JSON.parse(content);
      enviados.push(pedido);
      const resposta = responder(pedido);
      const recebidas = [];
      if (resposta) {
        const mensagem = { author: { bot: true, id: 'bot-tickets' }, content: JSON.stringify(resposta) };
        if (esperando.filter(mensagem)) recebidas.push(mensagem);
      }
      esperando.resolve({ first: () => recebidas[0] });
      return { id: 'msg-pedido' };
    }
  };
}

function interacaoFalsa(canal, { channelId = DENUNCIA.threadId, userId = 'player-1' } = {}) {
  const respostas = [];
  return {
    respostas,
    user: { id: userId },
    guildId: '10',
    channelId,
    client: { user: { id: 'althea' }, channels: { fetch: async (id) => (id === '555' ? canal : null) } },
    reply: async (msg) => respostas.push(msg),
    deferReply: async () => {},
    editReply: async (msg) => respostas.push(msg)
  };
}

test('botão só aparece com canal ponte e opção ligada', () => {
  assert.equal(botaoAbrirTicket({ channels: {} }), null);
  assert.equal(botaoAbrirTicket({ ...CONFIG, botaoTicketRevisao: false }), null);
  assert.equal(botaoAbrirTicket(CONFIG).toJSON().custom_id, ticketExterno.BOTAO_ABRIR_TICKET);
  assert.ok(botaoAbrirTicket({ channels: { ponteTickets: '555' } }), 'sem a opção salva vale ligado');
});

test('info leva o link da mensagem principal e o motivo', () => {
  const info = montarInfo(DENUNCIA);
  assert.match(info, /https:\/\/discord\.com\/channels\/10\/20\/30/);
  assert.match(info, /Anti-RP na praça/);
  assert.ok(montarInfo({ ...DENUNCIA, motivo: 'x'.repeat(5000) }).length < 1100);
});

test('resposta só vale do outro bot e com o mesmo pedido', () => {
  const msg = (autor, dados) => ({ author: autor, content: JSON.stringify(dados) });
  assert.deepEqual(lerResposta(msg({ bot: true, id: 'b' }, { pedido: 'p1', ok: true }), 'p1', 'althea'), { pedido: 'p1', ok: true });
  assert.equal(lerResposta(msg({ bot: true, id: 'b' }, { pedido: 'p2', ok: true }), 'p1', 'althea'), null);
  assert.equal(lerResposta(msg({ bot: false, id: 'humano' }, { pedido: 'p1', ok: true }), 'p1', 'althea'), null);
  assert.equal(lerResposta(msg({ bot: true, id: 'althea' }, { pedido: 'p1', ok: true }), 'p1', 'althea'), null);
  assert.equal(lerResposta({ author: { bot: true, id: 'b' }, content: 'texto' }, 'p1', 'althea'), null);
});

test('pede o ticket no canal ponte em nome de quem clicou e devolve o link', comDenuncia(async () => {
  const canal = canalFalso((pedido) => ({ pedido: pedido.pedido, ok: true, ticket_id: 'AB12', url: 'https://discord.com/channels/10/999' }));
  const interacao = interacaoFalsa(canal);
  await handleAbrirTicket(interacao, { lerConfig: LIGADO });

  const pedido = canal.enviados[0];
  assert.equal(pedido.tipo_msg, 'pedido_ticket');
  assert.equal(pedido.user_id, 'player-1');
  assert.equal(pedido.guild_id, '10');
  assert.equal(pedido.tipo, 'revisao_denuncia');
  assert.match(pedido.info, /channels\/10\/20\/30/);
  const final = interacao.respostas.at(-1);
  assert.match(final.content, /AB12/);
  assert.equal(final.components[0].toJSON().components[0].url, 'https://discord.com/channels/10/999');
}));

test('recusa do bot de tickets chega ao player e segura cliques repetidos', comDenuncia(async () => {
  const canal = canalFalso((pedido) => ({ pedido: pedido.pedido, ok: false, erro: '❌ Você já tem 1 ticket(s) de revisao_denuncia aberto(s). Limite: 1' }));
  const interacao = interacaoFalsa(canal);
  await handleAbrirTicket(interacao, { lerConfig: LIGADO });
  assert.match(interacao.respostas.at(-1), /Limite: 1/);

  const repetida = interacaoFalsa(canal);
  await handleAbrirTicket(repetida, { lerConfig: LIGADO });
  assert.match(repetida.respostas.at(-1).content, /Aguarde/);
  assert.equal(canal.enviados.length, 1);
}));

test('bot de tickets sem responder não prende o player na espera', comDenuncia(async () => {
  const canal = canalFalso(() => null);
  const interacao = interacaoFalsa(canal);
  await handleAbrirTicket(interacao, { lerConfig: LIGADO });
  assert.match(interacao.respostas.at(-1), /não respondeu/);
  assert.equal(_ultimoPedido.has('player-1'), false);
}));

test('tópico sem denúncia não pede ticket', comDenuncia(async () => {
  const canal = canalFalso(() => { throw new Error('não devia pedir'); });
  const interacao = interacaoFalsa(canal, { channelId: 'outro-topico' });
  await handleAbrirTicket(interacao, { lerConfig: LIGADO });
  assert.equal(canal.enviados.length, 0);
  assert.match(interacao.respostas.at(-1), /Não encontrei a denúncia/);
}));

test('desligado no site ou sem canal ponte: clique no botão antigo é recusado', comDenuncia(async () => {
  const canal = canalFalso(() => { throw new Error('não devia pedir'); });
  const desligado = interacaoFalsa(canal);
  await handleAbrirTicket(desligado, { lerConfig: async () => ({ ...CONFIG, botaoTicketRevisao: false }) });
  assert.match(desligado.respostas.at(-1).content, /desativada/);

  const semCanal = interacaoFalsa(canal);
  await handleAbrirTicket(semCanal, { lerConfig: async () => ({ channels: {} }) });
  assert.match(semCanal.respostas.at(-1).content, /não está configurada/);
  assert.equal(canal.enviados.length, 0);
}));
