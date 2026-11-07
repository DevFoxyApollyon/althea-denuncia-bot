const mongoose = require('mongoose');
const { modelSecundarioPermanente } = require('../utils/persistencia');
const { TEMPLATES_PADRAO, LIMITE_PCS_PADRAO, EXECUTORES, LIMITES_GM_PADRAO } = require('../services/ponteSamp/constantes');

// Guild com a ponte do jogo ligada. Só existe depois do /ativar com um código válido.
const ponteServidorSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  ativo: { type: Boolean, default: false },
  ativadoEm: { type: Date, default: null },
  ativadoPor: { type: String, default: null },
  codigoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PonteCodigo', default: null },
  limitePcs: { type: Number, default: LIMITE_PCS_PADRAO, min: 1 },
  // cmd → template do comando no chat do jogo.
  templates: { type: Map, of: String, default: () => ({ ...TEMPLATES_PADRAO }) },
  // Tabela de motivos editada no painel do jogo. Vazia: usa a padrão (constantes.js).
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
  // Alertas de segurança (HWID diferente). Vazio usa o log admin da Config.
  canalAlertasId: { type: String, default: '' },
  // Quem aplica as punições: o PC da staff (mod Lua), a gamemode ou os dois.
  executor: { type: String, enum: EXECUTORES, default: 'pc' },
  // Limites do modo gamemode (o bot confere antes de criar o pedido; a gamemode confere de novo).
  gm: {
    pausado: { type: Boolean, default: LIMITES_GM_PADRAO.pausado },
    maxBanDias: { type: Number, default: LIMITES_GM_PADRAO.maxBanDias, min: 1, max: 99999 },
    permitirPermanente: { type: Boolean, default: LIMITES_GM_PADRAO.permitirPermanente },
    maxCadeiaMin: { type: Number, default: LIMITES_GM_PADRAO.maxCadeiaMin, min: 1, max: 99999 },
    maxAvisos: { type: Number, default: LIMITES_GM_PADRAO.maxAvisos, min: 0, max: 10 },
    modoTeste: { type: Boolean, default: LIMITES_GM_PADRAO.modoTeste }
  },
  desativadoEm: { type: Date, default: null },
  desativadoPor: { type: String, default: null }
}, { timestamps: true });

module.exports = modelSecundarioPermanente('PonteServidor', ponteServidorSchema, 'ponteservidores');
