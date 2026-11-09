const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Senha pessoal da staff para os botões Aceitar e Recusar da Cadeia Staff (quando a
// opção está ligada no Painel do bot). Só o hash fica guardado. Depois de digitar a
// senha certa, a pessoa fica liberada por 30 minutos (liberadoAte).
const senhaStaffSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  hash: { type: String, required: true },
  salt: { type: String, required: true },
  criadaEm: { type: Date, default: Date.now },
  liberadoAte: { type: Date, default: null },
  // Senha errada várias vezes seguidas: espera antes de tentar de novo.
  erros: { type: Number, default: 0 },
  bloqueadoAte: { type: Date, default: null }
});

module.exports = modelPermanente('SenhaStaff', senhaStaffSchema, 'senhastaffs');
