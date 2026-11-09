const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

// Pessoas que o dono do bot liberou no painel da ponte (/admin), pelo ID do Discord.
// O dono (OWNER_DISCORD_ID) não precisa estar aqui.
const ponteAcessoAdminSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, match: /^\d{15,21}$/ },
  nome: { type: String, default: '' },
  adicionadoPor: { type: String, default: '' },
  adicionadoEm: { type: Date, default: Date.now }
});

module.exports = modelSecundarioPermanente('PonteAcessoAdmin', ponteAcessoAdminSchema, 'ponteacessosadmin');
