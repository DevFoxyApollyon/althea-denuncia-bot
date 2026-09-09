function serializarMensagem(message) {
  return {
    mensagemId: message.id,
    autorId: message.author?.id || '',
    autorNome: message.author?.tag || message.author?.username || '',
    conteudo: message.content || '',
    dataCriacao: message.createdAt || new Date(message.createdTimestamp || Date.now()),
    anexos: Array.from(message.attachments?.values?.() || []).map(attachment => ({
      id: attachment.id,
      nome: attachment.name || '',
      url: attachment.url || '',
      tipo: attachment.contentType || '',
      tamanho: attachment.size ?? null,
    })),
    embeds: (message.embeds || []).map(embed =>
      typeof embed.toJSON === 'function' ? embed.toJSON() : embed
    ),
  };
}

async function buscarCanal(client, channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
}

module.exports = { serializarMensagem, buscarCanal };