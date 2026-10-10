const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Aviso fixado no topo do chat do site (regras, evento do dia). Um por
// servidor. Guarda uma cópia do texto, então continua valendo mesmo depois
// que a mensagem original some do chat.
const chatFixadaSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  texto: { type: String, required: true, maxlength: 500 },
  autorId: { type: String, required: true },
  fixadaPor: { type: String, required: true },
  em: { type: Date, default: Date.now }
});

module.exports = modelPermanente('ChatFixada', chatFixadaSchema);
