const { Schema } = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

const usuariosSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  username: { type: String },
  nickname: { type: String },
  conta: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

// Os upserts usam { guildId, userId }; sem o índice único, dois upserts
// simultâneos do mesmo membro criavam registros duplicados.
usuariosSchema.index({ guildId: 1, userId: 1 }, { unique: true });
usuariosSchema.index({ guildId: 1, conta: 1 });

module.exports = modelSecundarioPermanente('Usuarios', usuariosSchema, 'usuarios');
