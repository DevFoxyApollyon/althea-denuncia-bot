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
      // "registro": punição que não é ban nem cadeia (ex.: mute), já feita no jogo; o
      // aceite segue normal, mas nada vai para o jogo. O texto é o que aparece como punição.
      cmd: { type: String, enum: ['ban', 'cadeia', 'registro'], required: true },
      tempo: { type: Number, min: 0, max: 99999, required: true },
      avisos: { type: Number, min: 0, max: 10, default: 0 },
      texto: { type: String, default: '', maxlength: 60 }
    }],
    default: []
  },
  // Já passou pela migração da tabela antiga (GlobalConfig / servidor).
  definidas: { type: Boolean, default: false },
  atualizadoPor: { type: String, default: '' }
}, { timestamps: true });

module.exports = modelSecundarioPermanente('PonteMotivos', ponteMotivosSchema, 'pontemotivos');
