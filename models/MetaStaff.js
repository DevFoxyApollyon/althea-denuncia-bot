const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Meta de atendimentos da staff, definida pelo responsável de cada servidor.
const metaStaffSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  // Mínimo de denúncias atendidas por pessoa nos últimos 7 dias. 0 = sem meta.
  minimoSemanal: { type: Number, default: 0, min: 0, max: 1000 },
  atualizadoPor: { type: String, default: null }
}, { timestamps: true });

module.exports = modelPermanente('MetaStaff', metaStaffSchema);
