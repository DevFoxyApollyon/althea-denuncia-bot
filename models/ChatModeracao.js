const mongoose = require('mongoose');

// Registro do que a staff fez no chat do site (apagar mensagem, castigo,
// banimento e remoção de punição). Aparece na auditoria do responsável e fica
// guardado por 90 dias.
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
  em: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 }
});

chatModeracaoSchema.index({ guildId: 1, em: -1 });

module.exports = mongoose.model('ChatModeracao', chatModeracaoSchema);
