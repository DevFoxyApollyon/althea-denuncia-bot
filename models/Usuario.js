const secondaryConnection = require('../utils/secondaryDb');
const { Schema } = require('mongoose');

const usuariosSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  username: { type: String },
  nickname: { type: String },
  conta: { type: String },
  updatedAt: { type: Date, default: Date.now }
});



module.exports = secondaryConnection.model('Usuarios', usuariosSchema, 'usuarios');
