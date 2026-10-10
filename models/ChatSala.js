const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Ajustes do chat de cada servidor, definidos pela staff: modo lento, chat
// fechado.
const chatSalaSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  // Intervalo mínimo entre mensagens de cada pessoa, em segundos (0 = desligado).
  modoLentoSeg: { type: Number, default: 0 },
  // Fechado: só a staff escreve.
  fechado: { type: Boolean, default: false }
});

module.exports = modelPermanente('ChatSala', chatSalaSchema);
