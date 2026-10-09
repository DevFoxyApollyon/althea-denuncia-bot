const Denuncia = require('../models/Denuncia');
const DenunciaMensagem = require('../models/DenunciaMensagem');

function serializarAnexos(message) {
  return Array.from(message.attachments?.values?.() || []).map(attachment => ({
    id: attachment.id,
    nome: attachment.name || '',
    url: attachment.url || '',
    tipo: attachment.contentType || '',
    tamanho: attachment.size ?? null,
  }));
}

function serializarEmbeds(message) {
  return (message.embeds || []).map(embed =>
    typeof embed.toJSON === 'function' ? embed.toJSON() : embed
  );
}

function serializarMensagem(message) {
  return {
    mensagemId: message.id,
    autorId: message.author?.id || '',
    autorNome: message.author?.tag || message.author?.username || '',
    conteudo: message.content || '',
    dataCriacao: message.createdAt || new Date(message.createdTimestamp || Date.now()),
    anexos: serializarAnexos(message),
    embeds: serializarEmbeds(message),
  };
}

async function buscarCanal(client, channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
}

// Grava as mensagens do tópico na coleção própria. O upsert torna a operação
// idempotente caso o mesmo evento chegue duas vezes.
async function registrarMensagens(denuncia, messages) {
  const lista = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
  if (!denuncia?._id || lista.length === 0) return;

  await DenunciaMensagem.bulkWrite(lista.map(message => ({
    updateOne: {
      filter: { threadId: denuncia.threadId, mensagemId: message.id },
      update: {
        $setOnInsert: {
          ...serializarMensagem(message),
          denunciaId: denuncia._id,
          guildId: denuncia.guildId,
          threadId: denuncia.threadId,
          expiraEm: denuncia.dataExpiracao || null,
        }
      },
      upsert: true
    }
  })), { ordered: false });
}

async function registrarEspelho(denuncia, mensagemId, espelho) {
  const result = await DenunciaMensagem.updateOne(
    { threadId: denuncia.threadId, mensagemId },
    { $push: { espelhos: espelho } }
  );
  if (result.matchedCount) return;

  // Denúncia anterior à coleção própria: a mensagem está no array embutido.
  await Denuncia.updateOne(
    { _id: denuncia._id, 'mensagens.mensagemId': mensagemId },
    { $push: { 'mensagens.$.espelhos': espelho } }
  );
}

// Atualiza o conteúdo salvo de uma mensagem editada e devolve os espelhos dela
// (ou null se a mensagem não pertence a nenhuma denúncia).
async function atualizarMensagemEditada(guildId, threadId, message) {
  const campos = {
    conteudo: message.content || '',
    editadaEm: new Date(),
    anexos: serializarAnexos(message),
    embeds: serializarEmbeds(message),
  };

  const atualizada = await DenunciaMensagem.findOneAndUpdate(
    { threadId, mensagemId: message.id },
    { $set: campos },
    { new: true }
  ).select('espelhos').lean();
  if (atualizada) return atualizada.espelhos || [];

  const legado = await Denuncia.findOneAndUpdate(
    { guildId, threadId, 'mensagens.mensagemId': message.id },
    { $set: {
      'mensagens.$.conteudo': campos.conteudo,
      'mensagens.$.editadaEm': campos.editadaEm,
      'mensagens.$.anexos': campos.anexos,
      'mensagens.$.embeds': campos.embeds,
    } },
    { new: true }
  ).select('mensagens.mensagemId mensagens.espelhos').lean();
  if (!legado) return null;

  return legado.mensagens?.find(item => item.mensagemId === message.id)?.espelhos || [];
}

async function marcarMensagemApagada(guildId, threadId, mensagemId) {
  const apagadaEm = new Date();
  const result = await DenunciaMensagem.updateOne({ threadId, mensagemId }, { $set: { apagadaEm } });
  if (result.matchedCount) return;

  await Denuncia.updateOne(
    { guildId, threadId, 'mensagens.mensagemId': mensagemId },
    { $set: { 'mensagens.$.apagadaEm': apagadaEm } }
  );
}

module.exports = {
  serializarMensagem,
  buscarCanal,
  registrarMensagens,
  registrarEspelho,
  atualizarMensagemEditada,
  marcarMensagemApagada
};
