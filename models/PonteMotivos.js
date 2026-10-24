const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');

// Tabela de motivos da ponte com o jogo: um documento só, o mesmo para todos os servidores.
// Vazia: usa a padrão (services/ponteSamp/constantes.js).
const ponteMotivosSchema = new mongoose.Schema({
  chave: { type: String, required: true, unique: true, default: 'global' },
  regras: {
    type: [{
      _id: false,
      nome: { type: String, required: true },
      sinonimos: { type: [String], default: [] },
      cmd: { type: String, enum: ['ban', 'cadeia'], required: true },
      tempo: { type: Number, min: 0, max: 99999, required: true },
      avisos: { type: Number, min: 0, max: 10, default: 0 }
    }],
    default: []
  },
  // Já passou pela migração da tabela antiga (GlobalConfig / servidor).
  definidas: { type: Boolean, default: false },
  atualizadoPor: { type: String, default: '' }
}, { timestamps: true });

module.exports = modelSecundarioPermanente('PonteMotivos', ponteMotivosSchema, 'pontemotivos');
