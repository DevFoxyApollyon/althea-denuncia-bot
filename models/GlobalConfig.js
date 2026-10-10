const mongoose = require('mongoose');

const globalConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    unique: true,
    default: 'global'
  },
  usuariosIsentos: {
    type: [String],
    default: []
  },
  updatedBy: {
    type: String,
    default: 'Sistema'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);
