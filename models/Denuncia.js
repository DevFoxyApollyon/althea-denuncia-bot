const mongoose = require('mongoose');
const { getBrasiliaDate } = require('../utils/dateUtils');

const denunciaSchema = new mongoose.Schema({
  guildId: { 
    type: String, 
    required: true,
    index: true 
  },
  messageId: { 
    type: String, 
    required: true,
    index: true 
  },
  channelId: { 
    type: String, 
    required: true 
  },
  threadId: { 
    type: String, 
    required: true,
    index: true 
  },
  denunciante: { 
    type: String, 
    required: true 
  },
  acusado: { 
    type: String, 
    required: true 
  },
  motivo: { 
    type: String, 
    required: true 
  },
  provas: { 
    type: String, 
    required: true 
  },
  platform: { 
    type: String, 
    required: true, 
    enum: ['PC', 'Mobile'] 
  },
  criadoPor: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    required: true, 
    enum: ['pendente', 'aceita', 'recusada', 'analise'],
    default: 'pendente'
  },
  dataCriacao: { 
    type: Date, 
    default: () => getBrasiliaDate(),
    index: true
  },
  dataExpiracao: {
    type: Date,
    default: () => {
      const date = getBrasiliaDate();
      date.setDate(date.getDate() + 15);
      return date;
    },
    index: { expires: 0 }
  },
  punicao: { 
    type: String 
  },
  staffId: { 
    type: String 
  },
  dataAceite: { 
    type: Date,
    set: (v) => v ? getBrasiliaDate(v) : v
  },
  ultimaEdicao: {
    staffId: { type: String },
    data: { 
      type: Date,
      set: (v) => v ? getBrasiliaDate(v) : v
    },
    motivoEdicao: { type: String }
  },
  historico: [{
    acao: { type: String, required: true },
    staffId: { type: String, required: true },
    data: { 
      type: Date, 
      required: true,
      set: (v) => getBrasiliaDate(v)
    },
    detalhes: { type: mongoose.Schema.Types.Mixed }
  }],
  logMessageId: {
    type: String,
    default: null
  },
  acusadoId: { 
    type: String
  },
  motivoAceite: { 
    type: String
  },
  dataPunicao: { 
    type: String
  },
  claimedBy: {
    type: String,
    default: null
  },
  claimedAt: {
    type: Date,
    default: null,
    set: (v) => v ? getBrasiliaDate(v) : v
  },
  isInAnalysis: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: { 
    currentTime: () => getBrasiliaDate()
  }
});

denunciaSchema.pre('save', function(next) {
  if (this.isModified()) {
    const now = getBrasiliaDate();
    if (this.isNew) {
      this.dataCriacao = now;
    }
    this.updatedAt = now;
  }
  next();
});

denunciaSchema.index({ status: 1 });
denunciaSchema.index({ platform: 1 });
denunciaSchema.index({ 'ultimaEdicao.data': 1 });
denunciaSchema.index({ guildId: 1, createdAt: 1 });

module.exports = mongoose.model('Denuncia', denunciaSchema);