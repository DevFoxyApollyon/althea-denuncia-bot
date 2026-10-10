const mongoose = require('mongoose');

// Mensagens do chat do site, um por servidor. Somem sozinhas depois de 30 dias.
const chatMensagemSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  autorId: { type: String, required: true },
  autorNome: { type: String, default: '' },
  texto: { type: String, default: '', maxlength: 500 },
  // Quem foi marcado com @ nesta mensagem.
  mencoes: { type: [String], default: [] },
  // Imagem, áudio ou vídeo enviado junto; o arquivo fica no banco (GridFS).
  anexo: {
    arquivoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    nome: { type: String, default: '' },
    tipo: { type: String, default: '' },
    tamanho: { type: Number, default: 0 }
  },
  criadaEm: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 },
  // Quem da staff apagou; a mensagem deixa de aparecer, mas o registro fica.
  apagadaPor: { type: String, default: null },
  apagadaEm: { type: Date, default: null }
});

chatMensagemSchema.index({ guildId: 1, criadaEm: -1 });

module.exports = mongoose.model('ChatMensagem', chatMensagemSchema);
