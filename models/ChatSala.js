const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Ajustes do chat de cada servidor, definidos pela staff: modo lento, chat
// fechado e a música que está tocando para todos.
const chatSalaSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  // Intervalo mínimo entre mensagens de cada pessoa, em segundos (0 = desligado).
  modoLentoSeg: { type: Number, default: 0 },
  // Fechado: só a staff escreve.
  fechado: { type: Boolean, default: false },
  musica: {
    tipo: { type: String, default: '' },
    ref: { type: String, default: '' },
    por: { type: String, default: '' },
    em: { type: Date, default: null }
  }
});

module.exports = modelPermanente('ChatSala', chatSalaSchema);
