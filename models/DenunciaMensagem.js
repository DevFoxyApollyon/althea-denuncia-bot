const mongoose = require('mongoose');

// Mensagens dos tópicos de denúncia. Ficavam embutidas em Denuncia.mensagens,
// o que fazia o documento crescer sem limite a cada mensagem do tópico.
// Denúncias antigas continuam com o array embutido e são lidas como fallback.
const denunciaMensagemSchema = new mongoose.Schema({
  denunciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Denuncia', required: true, index: true },
  guildId: { type: String, required: true },
  threadId: { type: String, required: true },
  mensagemId: { type: String, required: true },
  autorId: { type: String, required: true },
  autorNome: { type: String, default: '' },
  conteudo: { type: String, default: '' },
  dataCriacao: { type: Date, required: true },
  editadaEm: { type: Date, default: null },
  anexos: [{
    _id: false,
    id: { type: String, default: '' },
    nome: { type: String, default: '' },
    url: { type: String, default: '' },
    tipo: { type: String, default: '' },
    tamanho: { type: Number, default: null }
  }],
  embeds: { type: mongoose.Schema.Types.Mixed, default: [] },
  espelhos: [{
    _id: false,
    threadId: { type: String, required: true },
    messageId: { type: String, required: true }
  }],
  apagadaEm: { type: Date, default: null },
  // Enviada pelo site: o bot publicou no tópico em nome de autorId.
  viaSite: { type: Boolean, default: false },
  // Mesma data de expiração da denúncia: as mensagens somem junto com ela.
  expiraEm: { type: Date, default: null, index: { expires: 0 } }
});

denunciaMensagemSchema.index({ threadId: 1, mensagemId: 1 }, { unique: true });

module.exports = mongoose.model('DenunciaMensagem', denunciaMensagemSchema);
