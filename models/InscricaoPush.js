const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Um registro por navegador ou aparelho que aceitou receber notificações do site.
const inscricaoPushSchema = new mongoose.Schema({
  usuarioId: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  chaves: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  criadaEm: { type: Date, default: Date.now }
});

module.exports = model('InscricaoPush', inscricaoPushSchema);
