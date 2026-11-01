const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Categorias e respostas prontas definidos pelo responsável no
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
  respostasProntas: [{
    _id: false,
    titulo: { type: String, required: true, maxlength: 60 },
    texto: { type: String, required: true, maxlength: 1500 }
  }],
  atualizadoPor: { type: String, default: null }
}, { timestamps: true });

module.exports = modelPermanente('ConfigSite', configSiteSchema);
