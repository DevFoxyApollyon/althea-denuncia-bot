const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Mensagem do chat que um membro sinalizou para a staff olhar.
const chatSinalizacaoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  mensagemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  autorId: { type: String, required: true },
  trecho: { type: String, default: '', maxlength: 160 },
  por: { type: String, required: true },
  motivo: { type: String, default: '', maxlength: 200 },
  em: { type: Date, default: Date.now },
  resolvidaPor: { type: String, default: null },
  resolvidaEm: { type: Date, default: null }
});

// Cada pessoa sinaliza a mesma mensagem uma vez só.
chatSinalizacaoSchema.index({ mensagemId: 1, por: 1 }, { unique: true });
chatSinalizacaoSchema.index({ guildId: 1, resolvidaEm: 1, em: -1 });

module.exports = model('ChatSinalizacao', chatSinalizacaoSchema);
