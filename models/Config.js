// Config.js
const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  guildId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  channels: {
    pc: { type: String, required: false, default: '' },
    mobile: { type: String, required: false, default: '' },
    logs: { type: String, required: false, default: '' }, // Log de status (texto)
    log: { type: String, required: false, default: '' },  // Log de auditoria (embed)
    analysis: { type: String, required: false, default: '' },
    topDaily: { type: String, required: false, default: '' },
    databaseprovas: { type: String, required: false, default: '' } 
  },
  roles: {
    permitido: { type: String, required: false, default: '' },
    pc: { type: String, required: false, default: '' },
    administrador: { type: String, required: false, default: '' },
    responsavel_admin: { type: String, required: false, default: '' }
  },
  templates: {
    denuncia_aceita: { 
      type: String, 
      required: false, 
      default: 'âž¥ DenÃºncia aceita Acusado ({acusadoId}) tomarÃ¡ puniÃ§Ã£o por ({motivo}) Data {dataPunicao} Link: {messageUrl}' 
    },
    denuncia_analise: { 
      type: String, 
      required: false, 
      default: 'ðŸ”Ž Esta denÃºncia estÃ¡ em anÃ¡lise por {user} Acusado: ({acusado}) Motivo: ({motivo}) Link: {messageUrl}' 
    },
    denuncia_recusada: { 
      type: String, 
      required: false, 
      default: 'âŒ DenÃºncia recusada por {user}' 
    }
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

module.exports = mongoose.model('Config', configSchema);