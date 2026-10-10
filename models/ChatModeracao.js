const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Registro do que a staff fez no chat do site (apagar mensagem, castigo,
// banimento e remoção de punição). Aparece na auditoria do responsável.
const chatModeracaoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  staffId: { type: String, required: true },
  alvoId: { type: String, required: true },
  acao: { type: String, required: true, enum: ['apagar', 'castigo', 'banimento', 'remocao', 'fixar', 'desafixar'] },
  motivo: { type: String, default: '', maxlength: 200 },
  // Duração do castigo, em minutos.
  minutos: { type: Number, default: null },
  // Começo da mensagem apagada, para a auditoria saber do que se tratava.
  trecho: { type: String, default: '', maxlength: 160 },
  em: { type: Date, default: Date.now }
});

chatModeracaoSchema.index({ guildId: 1, em: -1 });

module.exports = model('ChatModeracao', chatModeracaoSchema);
