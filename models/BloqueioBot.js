const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

// Pessoas bloqueadas pelo dono do bot no painel da ponte (/admin), pelo ID do Discord.
// Bloqueada, a pessoa não usa botões, comandos nem o site do bot, em nenhum servidor.
const bloqueioBotSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, match: /^\d{15,21}$/ },
  nome: { type: String, default: '' },
  motivo: { type: String, default: '', maxlength: 200 },
  bloqueadoPor: { type: String, default: '' },
  bloqueadoEm: { type: Date, default: Date.now }
});

module.exports = modelSecundarioPermanente('BloqueioBot', bloqueioBotSchema, 'bloqueiosbot');
