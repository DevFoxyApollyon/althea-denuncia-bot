const mongoose = require('mongoose');
const { modelSecundario } = require('../utils/persistencia');
const { ACOES_USO } = require('../services/ponteSamp/constantes');

// Auditoria da ponte: ações da staff e da gamemode e falhas de autenticação. Dura 90 dias.
const ponteUsoSchema = new mongoose.Schema({
  guildId: { type: String, default: '' },
  em: { type: Date, default: Date.now },
  acao: { type: String, enum: ACOES_USO, required: true },
  punicaoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PontePunicao', default: null },
  contaId: { type: String, default: '' },
  nick: { type: String, default: '' },
  comando: { type: String, default: '' },
  ip: { type: String, default: '' },
  detalhes: { type: mongoose.Schema.Types.Mixed, default: null }
});

ponteUsoSchema.index({ guildId: 1, em: -1 });
ponteUsoSchema.index({ em: -1 });

module.exports = modelSecundario('PonteUso', ponteUsoSchema, 'ponteusos');
