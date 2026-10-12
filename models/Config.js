const mongoose = require('mongoose');
const { globalCache } = require('../utils/smartCache');
const { modelPermanente } = require('../utils/persistencia');

const configSchema = new mongoose.Schema({
  guildId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  channels: {
    pc: { type: String, required: false, default: '' },
    mobile: { type: String, required: false, default: '' },
    logs: { type: String, required: false, default: '' }, 
    log: { type: String, required: false, default: '' }, 
    backup: { type: String, required: false, default: '' },
    armazem: { type: String, required: false, default: '' },
    registro: { type: String, required: false, default: '' },
    cloud: { type: String, required: false, default: '' },
    canalDenuncia: { type: String, required: false, default: '' },
    analysis: { type: String, required: false, default: '' },
    topDaily: { type: String, required: false, default: '' }
  },
  manutencaoDenuncia: { type: Boolean, default: false },
  bloquearReivindicacaoComPendentes: { type: Boolean, default: true },
  // Site só para consulta: ninguém (fora o responsável) envia ou altera nada por ele.
  siteSomenteLeitura: { type: Boolean, default: false },
  roles: {
    permitido: { type: String, required: false, default: '' },
    pc: { type: String, required: false, default: '' },
    administrador: { type: String, required: false, default: '' },
    responsavel_admin: { type: String, required: false, default: '' }
  },
  
  lastUpdated: { 
    type: Date,  
    default: Date.now 
  },
  updatedBy: { 
    type: String, 
    required: false,
    default: 'Sistema'
  }
});

configSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();
  next();
});

// Mantém o cache de utils/configCache.js coerente com o banco.
function invalidarCache(guildId) {
  if (guildId) globalCache.delete(`config:${guildId}`);
}

configSchema.post('save', function(doc) {
  invalidarCache(doc?.guildId);
});

configSchema.post(['findOneAndUpdate', 'updateOne', 'deleteOne', 'findOneAndDelete'], function() {
  invalidarCache(this.getQuery?.()?.guildId);
});

module.exports = modelPermanente('Config', configSchema);