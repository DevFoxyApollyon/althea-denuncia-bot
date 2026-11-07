const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');
const { STATUS_INSTALACAO } = require('../services/ponteSamp/constantes');

// PC autorizado a puxar a fila de punições de uma guild. O token só aparece
// na criação; aqui ficam o sha256 e os 4 últimos caracteres.
const ponteInstalacaoSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  nome: { type: String, required: true, maxlength: 40 },
  tokenHash: { type: String, required: true, unique: true },
  ultimos4: { type: String, default: '' },
  // Gravado no primeiro uso; se mudar, a instalação é bloqueada (token copiado para outro PC).
  hwidHash: { type: String, default: null },
  status: { type: String, enum: STATUS_INSTALACAO, default: 'ativa' },
  criadoPor: { type: String, required: true },
  criadoEm: { type: Date, default: Date.now },
  ultimoUsoEm: { type: Date, default: null },
  ultimoIp: { type: String, default: '' },
  ultimoPingEm: { type: Date, default: null },
  versaoScript: { type: String, default: '' },
  revogadoEm: { type: Date, default: null },
  revogadoPor: { type: String, default: null }
});

ponteInstalacaoSchema.index({ guildId: 1, status: 1 });

module.exports = modelSecundarioPermanente('PonteInstalacao', ponteInstalacaoSchema, 'ponteinstalacoes');
