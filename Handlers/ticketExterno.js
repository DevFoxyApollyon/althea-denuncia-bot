// Botão "Abrir Ticket" do tópico da denúncia: pede ao bot de tickets (outro bot)
// um ticket em nome de quem clicou, já com o link da denúncia e o motivo.
//
// Os dois bots conversam por um canal ponte (Painel do bot > "Ponte com o bot de
// tickets"), oculto para os membros:
//   Althea posta:       {"tipo_msg":"pedido_ticket","pedido":"<id>","guild_id":"...","user_id":"...","tipo":"revisao_denuncia","info":"..."}
//   Bot de tickets responde (reply): {"pedido":"<id>","ok":true,"ticket_id":"AB12","url":"https://discord.com/channels/..."}
//                                ou: {"pedido":"<id>","ok":false,"erro":"motivo para o player"}
// O botão só aparece com o canal ponte escolhido e a opção "Botão de ticket de
// revisão" ligada no Painel do bot (site).
const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const { getConfig: getCachedConfig } = require('../utils/configCache');

const BOTAO_ABRIR_TICKET = 'abrir_ticket_denuncia';
const TIPO_TICKET = 'revisao_denuncia';
const ESPERA_MS = 60 * 1000;
const RESPOSTA_MS = 20 * 1000;
const MOTIVO_MAX = 900;

// Quem clicou por último e quando: evita spam de pedidos ao bot de tickets.
const ultimoPedido = new Map();

const canalPonte = (config) => String(config?.channels?.ponteTickets || '').trim();
const botaoTicketLigado = (config) => config?.botaoTicketRevisao !== false;
const integracaoAtiva = (config) => Boolean(canalPonte(config)) && botaoTicketLigado(config);

function botaoAbrirTicket(config) {
  if (!integracaoAtiva(config)) return null;
  return new ButtonBuilder()
    .setCustomId(BOTAO_ABRIR_TICKET)
    .setLabel('Abrir Ticket')
    .setEmoji('🎫')
    .setStyle(ButtonStyle.Primary);
}

function montarInfo(denuncia) {
  const link = `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
  let motivo = String(denuncia.motivo || '').trim() || 'Não informado';
  if (motivo.length > MOTIVO_MAX) motivo = `${motivo.slice(0, MOTIVO_MAX - 1)}…`;
  return `📌 **Denúncia:** ${link}\n📝 **Motivo:** ${motivo}`;
}

// Lê a resposta do bot de tickets; null quando a mensagem não é resposta a este pedido.
function lerResposta(mensagem, pedidoId, meuId) {
  if (!mensagem.author?.bot || mensagem.author.id === meuId) return null;
  try {
    const dados = JSON.parse(mensagem.content);
    return dados && dados.pedido === pedidoId ? dados : null;
  } catch {
    return null;
  }
}

// Posta o pedido no canal ponte e espera a resposta. O coletor começa antes do
// envio para não perder uma resposta rápida. Devolve os dados ou null (sem resposta).
async function pedirTicket(canal, corpo, meuId, esperaMs = RESPOSTA_MS) {
  const pedidoId = crypto.randomUUID();
  const espera = canal.awaitMessages({
    filter: (mensagem) => lerResposta(mensagem, pedidoId, meuId) !== null,
    max: 1,
    time: esperaMs
  });
  await canal.send({
    content: JSON.stringify({ tipo_msg: 'pedido_ticket', pedido: pedidoId, ...corpo }),
    allowedMentions: { parse: [] }
  });
  const recebidas = await espera;
  const resposta = recebidas.first();
  return resposta ? lerResposta(resposta, pedidoId, meuId) : null;
}

async function handleAbrirTicket(interaction, { agora = Date.now, lerConfig = getCachedConfig, esperaMs = RESPOSTA_MS } = {}) {
  const config = await lerConfig(interaction.guildId).catch(() => null);
  if (!canalPonte(config)) {
    return interaction.reply({ content: '❌ A ponte com o bot de tickets não está configurada.', flags: [MessageFlags.Ephemeral] });
  }
  // Botões já postados continuam no tópico: desligado no site, o clique é recusado.
  if (!botaoTicketLigado(config)) {
    return interaction.reply({ content: '❌ A abertura de ticket pela denúncia está desativada.', flags: [MessageFlags.Ephemeral] });
  }

  const ultimo = ultimoPedido.get(interaction.user.id);
  if (ultimo && agora() - ultimo < ESPERA_MS) {
    const segundos = Math.ceil((ESPERA_MS - (agora() - ultimo)) / 1000);
    return interaction.reply({ content: `⏳ Aguarde ${segundos}s para pedir outro ticket.`, flags: [MessageFlags.Ephemeral] });
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const denuncia = await Denuncia.findOne({ threadId: interaction.channelId }).lean();
  if (!denuncia) return interaction.editReply('❌ Não encontrei a denúncia deste tópico.');

  const canal = await interaction.client.channels.fetch(canalPonte(config)).catch(() => null);
  if (!canal?.isTextBased?.()) {
    console.warn(`Canal ponte de tickets ${canalPonte(config)} não encontrado.`);
    return interaction.editReply('❌ Não encontrei o canal ponte com o bot de tickets. Avise a staff.');
  }

  ultimoPedido.set(interaction.user.id, agora());

  let resposta;
  try {
    resposta = await pedirTicket(canal, {
      guild_id: interaction.guildId,
      user_id: interaction.user.id,
      tipo: TIPO_TICKET,
      info: montarInfo(denuncia)
    }, interaction.client.user?.id, esperaMs);
  } catch (erro) {
    ultimoPedido.delete(interaction.user.id);
    console.warn(`Falha ao pedir ticket no canal ponte: ${erro.message}`);
    return interaction.editReply('❌ Não consegui enviar o pedido ao bot de tickets. Confira as permissões do Althea no canal ponte.');
  }

  if (!resposta) {
    ultimoPedido.delete(interaction.user.id);
    return interaction.editReply('❌ O bot de tickets não respondeu. Ele pode estar fora do ar; tente de novo em instantes.');
  }

  if (resposta.ok && resposta.url) {
    return interaction.editReply({
      content: `✅ Ticket${resposta.ticket_id ? ` **${resposta.ticket_id}**` : ''} aberto com o link e o motivo desta denúncia.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Ir para o Ticket').setEmoji('🎫').setStyle(ButtonStyle.Link).setURL(resposta.url)
      )]
    });
  }

  // Recusa do bot de tickets (limite, horário, cargo): o motivo vem pronto para o player.
  return interaction.editReply(String(resposta.erro || '❌ O bot de tickets recusou o pedido.').slice(0, 2000));
}

module.exports = {
  BOTAO_ABRIR_TICKET,
  botaoAbrirTicket,
  botaoTicketLigado,
  montarInfo,
  lerResposta,
  handleAbrirTicket,
  _ultimoPedido: ultimoPedido
};
