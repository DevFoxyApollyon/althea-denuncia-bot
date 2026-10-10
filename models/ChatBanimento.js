const mongoose = require('mongoose');

// Quem a staff proibiu de escrever no chat do site, por servidor. A pessoa
// continua lendo as mensagens. Com "expiraEm" é um castigo (acaba sozinho na
// hora marcada); sem, é um banimento, que vale até alguém da staff remover.
const chatBanimentoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  usuarioId: { type: String, required: true },
  banidoPor: { type: String, required: true },
  motivo: { type: String, default: '', maxlength: 200 },
  criadoEm: { type: Date, default: Date.now },
  expiraEm: { type: Date, default: null }
});

chatBanimentoSchema.index({ guildId: 1, usuarioId: 1 }, { unique: true });
// O banco apaga o castigo quando o prazo vence (banimentos não têm prazo).
chatBanimentoSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ChatBanimento', chatBanimentoSchema);
