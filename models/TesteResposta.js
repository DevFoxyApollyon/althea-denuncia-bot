const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Cada vez que alguém da staff envia o teste.
const testeRespostaSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  usuarioId: { type: String, required: true },
  acertos: { type: Number, required: true },
  total: { type: Number, required: true },
  aprovado: { type: Boolean, required: true },
  // Perguntas que a pessoa errou (só os identificadores).
  erradas: { type: [String], default: [] },
  em: { type: Date, default: Date.now }
});

testeRespostaSchema.index({ guildId: 1, usuarioId: 1, em: -1 });

module.exports = model('TesteResposta', testeRespostaSchema);
