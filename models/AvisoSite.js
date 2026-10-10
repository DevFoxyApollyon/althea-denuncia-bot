const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Aviso que o responsável publica para todos os membros de um servidor verem
// no topo do site (manutenção, evento, mudança de regra).
const avisoSiteSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  texto: { type: String, required: true, maxlength: 400 },
  // "info" (verde), "atencao" (amarelo) ou "urgente" (vermelho).
  tipo: { type: String, enum: ['info', 'atencao', 'urgente'], default: 'info' },
  criadoPor: { type: String, required: true },
  criadoEm: { type: Date, default: Date.now },
  // Sem data, o aviso fica até ser removido.
  expiraEm: { type: Date, default: null }
});

avisoSiteSchema.index({ guildId: 1, criadoEm: -1 });

module.exports = model('AvisoSite', avisoSiteSchema);
