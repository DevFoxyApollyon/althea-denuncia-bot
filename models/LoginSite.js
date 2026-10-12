const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Cada entrada no site pela conta do Discord: quem, quando e de qual IP.
// Serve para o responsável investigar acesso indevido. Dura 30 dias.
const loginSiteSchema = new mongoose.Schema({
  usuarioId: { type: String, required: true },
  nome: { type: String, default: '' },
  ip: { type: String, default: '' },
  // Navegador e sistema, como o próprio navegador informa.
  agente: { type: String, default: '', maxlength: 300 },
  em: { type: Date, default: Date.now }
});

loginSiteSchema.index({ em: -1 });
loginSiteSchema.index({ usuarioId: 1, em: -1 });

module.exports = model('LoginSite', loginSiteSchema);
