const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Quem abriu cada caso pelo site, para auditoria do responsável.
const acessoCasoSchema = new mongoose.Schema({
  denunciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Denuncia', required: true },
  guildId: { type: String, required: true },
  usuarioId: { type: String, required: true },
  // denunciante, acusado ou staff
  relacao: { type: String, required: true },
  em: { type: Date, default: Date.now },
  expiraEm: { type: Date, default: null, index: true }
});

acessoCasoSchema.index({ denunciaId: 1, em: -1 });

module.exports = model('AcessoCaso', acessoCasoSchema);
