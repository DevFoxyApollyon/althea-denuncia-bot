const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');
const { STATUS_CONEXAO_GM } = require('../services/ponteSamp/constantes');

// Credencial de uma gamemode na ponte (protocolo gm/v1). O segredo fica
// cifrado com a PONTE_CHAVE_MESTRA e só é mostrado ao dono na criação.
const ponteConexaoGmSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  nome: { type: String, required: true, maxlength: 40 },
  segredoCifrado: {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    dados: { type: String, required: true }
  },
  // Só para o dono reconhecer a credencial no painel.
  ultimos4: { type: String, default: '' },
  // Vazio = qualquer IP (o painel avisa).
  ipsPermitidos: { type: [String], default: [] },
  status: { type: String, enum: STATUS_CONEXAO_GM, default: 'ativa' },
  pausada: { type: Boolean, default: false },
  criadoPor: { type: String, default: '' },
  criadoEm: { type: Date, default: Date.now },
  // Atualizados a cada busca da gamemode (online/offline no painel).
  ultimoContatoEm: { type: Date, default: null },
  ultimoIp: { type: String, default: '' },
  versaoInclude: { type: String, default: '' },
  modoTesteInformado: { type: Boolean, default: null },
  revogadoEm: { type: Date, default: null },
  revogadoPor: { type: String, default: '' }
});

ponteConexaoGmSchema.index({ guildId: 1, status: 1 });

module.exports = modelSecundarioPermanente('PonteConexaoGm', ponteConexaoGmSchema, 'ponteconexoesgm');
