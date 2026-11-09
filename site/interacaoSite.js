// Os fluxos do bot (abrir denúncia, reivindicar, aceitar, recusar...) foram
// escritos em cima das interações do Discord. Para o site executar exatamente a
// mesma regra, sem duplicá-la, ele entrega aos handlers um objeto com o mesmo
// formato de uma interação e recolhe as respostas que eles dariam ao usuário.

function textoDaResposta(payload) {
  if (typeof payload === 'string') return payload;
  return typeof payload?.content === 'string' ? payload.content : '';
}

function criarInteracaoSite({ client, guild, member, user, channel, message = null, campos = {}, tipo = 'botao', customId = '' }) {
  const respostas = [];
  const registrar = async (payload) => {
    const texto = textoDaResposta(payload).trim();
    if (texto) respostas.push(texto);
    return null;
  };

  const valores = new Map(Object.entries(campos).filter(([, valor]) => valor !== undefined && valor !== null));

  const interacao = {
    viaSite: true,
    client,
    guild,
    guildId: guild.id,
    member,
    user,
    channel,
    channelId: channel?.id ?? null,
    message,
    customId,
    replied: false,
    deferred: false,
    deferrable: true,
    modal: null,
    respostas,

    isRepliable: () => true,
    isButton: () => tipo === 'botao',
    isModalSubmit: () => tipo === 'modal',
    isStringSelectMenu: () => false,
    isChatInputCommand: () => false,
    inGuild: () => true,

    fields: {
      fields: valores,
      getTextInputValue: (id) => String(valores.get(id) ?? '')
    },

    deferReply: async () => { interacao.deferred = true; },
    deferUpdate: async () => { interacao.deferred = true; },
    reply: async (payload) => { interacao.replied = true; return registrar(payload); },
    editReply: registrar,
    followUp: registrar,
    deleteReply: async () => {},
    fetchReply: async () => null,
    showModal: async (modal) => { interacao.modal = modal; }
  };

  return interacao;
}

// Os handlers respondem com um emoji de situação no começo do texto.
const PREFIXOS_DE_ERRO = ['❌', '⏳', '⚠️', '🛠️', '⛔'];

// Menções do Discord não fazem sentido fora dele.
function limparTexto(texto) {
  return texto
    .replace(/<#(\d+)>/g, 'o tópico no Discord')
    .replace(/<@&(\d+)>/g, 'o cargo exigido')
    .replace(/<@!?(\d+)>/g, 'o usuário')
    .replace(/\*\*|`/g, '');
}

// A última resposta é o desfecho ("⏳ Processando..." vem antes do resultado).
function resultadoDaInteracao(interacao, mensagemPadrao = 'Ação concluída.') {
  const ultima = interacao.respostas[interacao.respostas.length - 1];
  if (!ultima) return { ok: true, mensagem: mensagemPadrao };

  const ok = !PREFIXOS_DE_ERRO.some(prefixo => ultima.startsWith(prefixo));
  return { ok, mensagem: limparTexto(ultima).replace(/^[^\p{L}\p{N}]+/u, '').trim() };
}

module.exports = { criarInteracaoSite, resultadoDaInteracao, limparTexto };
