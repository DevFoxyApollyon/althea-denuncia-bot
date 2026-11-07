const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

// Código de ativação da ponte, gerado só pelo dono do bot. O código em si
// nunca é gravado: ficam o sha256 e os 4 últimos caracteres.
const ponteCodigoSchema = new mongoose.Schema({
  codigoHash: { type: String, required: true, unique: true },
  ultimos4: { type: String, default: '' },
  criadoPor: { type: String, required: true },
  criadoEm: { type: Date, default: Date.now },
  expiraEm: { type: Date, default: null },
  // Vazio usa o limite padrão.
  limitePcs: { type: Number, default: null, min: 1 },
  usadoEm: { type: Date, default: null },
  usadoPorGuild: { type: String, default: null },
  usadoPorUser: { type: String, default: null },
  // Expirado à mão pelo painel do dono.
  expirado: { type: Boolean, default: false }
});

ponteCodigoSchema.index({ criadoEm: -1 });

module.exports = modelSecundarioPermanente('PonteCodigo', ponteCodigoSchema, 'pontecodigos');
