const mongoose = require('mongoose');
const { getBrasiliaDate, getWeekDates } = require('../utils/dateUtils');
const cron = require('node-cron');

const ModerationActionSchema = new mongoose.Schema({
  moderatorId: { type: String, required: true },
  guildId: { type: String, required: true },
  action: { 
    type: String, 
    enum: ['aceita', 'recusada', 'analise', 'reivindicacao'],
    required: true 
  },
  denunciaId: { type: String },
  timestamp: { 
    type: Date, 
    default: () => getBrasiliaDate() 
  },
  weekOf: { 
    type: Date, 
    required: true,
    // Se não for enviado, ele calcula automaticamente a segunda-feira da semana
    default: () => getWeekDates().weekStart 
  },
  weekNumber: { 
    type: Number,
    required: true,
    // Se não for enviado, ele calcula automaticamente o número da semana
    default: function() {
        return mongoose.model('ModerationAction').getCurrentWeekNumber();
    }
  }
}, {
  timestamps: {
    currentTime: () => getBrasiliaDate()
  }
});

// --- ÍNDICES PARA PERFORMANCE ---
ModerationActionSchema.index({ weekOf: 1, moderatorId: 1 });
ModerationActionSchema.index({ weekNumber: 1, moderatorId: 1 });
ModerationActionSchema.index({ timestamp: 1 });
ModerationActionSchema.index({ moderatorId: 1, timestamp: 1 });

// --- MÉTODOS ESTÁTICOS ---

// Retorna o número da semana no ano
ModerationActionSchema.statics.getCurrentWeekNumber = function() {
  const now = getBrasiliaDate();
  const start = new Date(now.getFullYear(), 0, 1);
  const firstWeek = new Date(start);
  firstWeek.setDate(start.getDate() + (1 - start.getDay()));
  const days = Math.floor((now - firstWeek) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + 1) / 7);
};

// Busca ações da semana atual para o ranking
ModerationActionSchema.statics.getActionsForCurrentWeek = async function(guildId) {
  try {
    const { weekStart, weekEnd } = getWeekDates();
    
    return await this.aggregate([
      { 
        $match: { 
          guildId: guildId,
          timestamp: { $gte: weekStart, $lte: weekEnd } 
        } 
      },
      {
        $group: {
          _id: "$moderatorId",
          aceitas: { $sum: { $cond: [{ $eq: ["$action", "aceita"] }, 1, 0] } },
          recusadas: { $sum: { $cond: [{ $eq: ["$action", "recusada"] }, 1, 0] } },
          analises: { $sum: { $cond: [{ $eq: ["$action", "analise"] }, 1, 0] } },
          reivindicacoes: { $sum: { $cond: [{ $eq: ["$action", "reivindicacao"] }, 1, 0] } },
          ultimaAcao: { $max: "$timestamp" }
        }
      },
      {
        $addFields: {
          total: { $add: ["$aceitas", "$recusadas", "$analises", "$reivindicacoes"] }
        }
      },
      { $sort: { total: -1 } }
    ]);
  } catch (error) {
    console.error('Erro ao buscar ações:', error);
    throw error;
  }
};

// Valida e salva uma nova ação (Melhorado para evitar erros de validação)
ModerationActionSchema.statics.validarAcao = async function(moderatorId, action, denunciaId, guildId) {
  if (!moderatorId || !action || !guildId) throw new Error('Dados obrigatórios ausentes');
  try {
    const { weekStart } = getWeekDates();
    const weekNumber = this.getCurrentWeekNumber();

    const novaAcao = new this({
      moderatorId,
      action,
      denunciaId,
      guildId,
      weekNumber: weekNumber,
      weekOf: weekStart,
      timestamp: getBrasiliaDate()
    });

    return await novaAcao.save();
  } catch (error) {
    console.error('Erro ao validar ação:', error);
    throw error;
  }
};

const ModerationAction = mongoose.models.ModerationAction || mongoose.model('ModerationAction', ModerationActionSchema);

// --- CRON JOB: RESET MENSAL ---
cron.schedule('5 0 1 * *', async () => {
  try {
    await ModerationAction.deleteMany({});
    console.log(`[DATABASE] Reset mensal do ranking realizado.`);
  } catch (error) {
    console.error('Erro no reset mensal:', error);
  }
}, {
  timezone: 'America/Sao_Paulo',
  scheduled: true
});

module.exports = ModerationAction;