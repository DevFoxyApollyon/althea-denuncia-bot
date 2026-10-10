const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Mensagens do chat do site, um por servidor. Somem sozinhas após seis meses.
const chatMensagemSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  autorId: { type: String, required: true },
  autorNome: { type: String, default: '' },
  texto: { type: String, default: '', maxlength: 500 },
  // Quem foi marcado com @ nesta mensagem.
  mencoes: { type: [String], default: [] },
  // Mensagem da staff com @all: vale como menção para todo mundo do servidor.
  todos: { type: Boolean, default: false },
  // "geral" é a conversa; "avisos" é a aba em que só a staff escreve.
  canal: { type: String, default: 'geral' },
  // Mensagem a que esta responde (cópia do começo, para continuar valendo se a original sumir).
  resposta: {
    id: { type: String, default: '' },
    autorId: { type: String, default: '' },
    autorNome: { type: String, default: '' },
    trecho: { type: String, default: '' }
  },
  reacoes: [{ _id: false, emoji: { type: String, required: true }, usuarios: { type: [String], default: [] } }],
  // Imagem, áudio ou vídeo enviado junto; o arquivo fica no banco (GridFS).
  anexo: {
    arquivoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    nome: { type: String, default: '' },
    tipo: { type: String, default: '' },
    tamanho: { type: Number, default: 0 }
  },
  criadaEm: { type: Date, default: Date.now },
  // Quem da staff apagou; a mensagem deixa de aparecer, mas o registro fica.
  apagadaPor: { type: String, default: null },
  apagadaEm: { type: Date, default: null }
});

chatMensagemSchema.index({ guildId: 1, criadaEm: -1 });

module.exports = model('ChatMensagem', chatMensagemSchema);
