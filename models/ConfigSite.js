const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

// Categorias definidas pelo responsável no
// site, por servidor. Sem documento, valem os padrões de site/categorias.js.
const configSiteSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  categorias: [{
    _id: false,
    nome: { type: String, required: true, maxlength: 40 },
    grupo: { type: String, default: '', maxlength: 30 },
    prioridade: { type: String, enum: ['alta', 'normal'], default: 'normal' },
    termos: { type: [String], default: [] }
  }],
  atualizadoPor: { type: String, default: null }
}, { timestamps: true });

module.exports = modelSecundarioPermanente('ConfigSite', configSiteSchema);
