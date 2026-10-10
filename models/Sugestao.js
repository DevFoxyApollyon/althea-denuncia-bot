const mongoose = require('mongoose');
const { modelSecundario } = require('../utils/persistencia');

// Sugestões que os jogadores enviam pelo site para a administração do servidor.
const sugestaoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  autorId: { type: String, required: true },
  texto: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['nova', 'analise', 'aceita', 'recusada'], default: 'nova' },
  resposta: { type: String, default: '', maxlength: 1000 },
  respondidaPor: { type: String, default: null },
  respondidaEm: { type: Date, default: null },
  criadaEm: { type: Date, default: Date.now }
});

sugestaoSchema.index({ guildId: 1, criadaEm: -1 });
sugestaoSchema.index({ guildId: 1, autorId: 1, criadaEm: -1 });

module.exports = modelSecundario('Sugestao', sugestaoSchema);
