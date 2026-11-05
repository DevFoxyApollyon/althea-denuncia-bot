const mongoose = require('mongoose');
const { modelSecundario } = require('../utils/persistencia');

// Histórico do painel do bot: quem mudou o quê, quando, e por onde (site ou
// /painel no Discord). Dura seis meses (prazo padrão de utils/retencaoDados.js).
const painelHistoricoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  por: { type: String, default: '' },
  via: { type: String, enum: ['site', 'discord'], default: 'site' },
  em: { type: Date, default: Date.now },
  mudancas: [{
    _id: false,
    campo: { type: String, maxlength: 80 },
    antes: { type: String, maxlength: 300 },
    depois: { type: String, maxlength: 300 }
  }]
});

painelHistoricoSchema.index({ guildId: 1, em: -1 });

module.exports = modelSecundario('PainelHistorico', painelHistoricoSchema, 'painelhistoricos');
