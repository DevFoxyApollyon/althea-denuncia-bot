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
    logs: { type: String, required: false, default: '' }, 
    log: { type: String, required: false, default: '' }, 
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