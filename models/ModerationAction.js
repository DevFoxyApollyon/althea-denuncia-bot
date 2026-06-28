// models/ModerationAction.js
const mongoose = require('mongoose');
const { getBrasiliaDate, getWeekDates } = require('../utils/dateUtils');
const cron = require('node-cron');

const ModerationActionSchema = new mongoose.Schema(
  {
    moderatorId: { type: String, required: true },
    guildId: { type: String, required: true },

    action: {
      type: String,
      enum: ['aceita', 'recusada', 'analise', 'reivindicacao'],
      required: true,
    },

    denunciaId: { type: String },

    timestamp: {
      type: Date,
      default: () => getBrasiliaDate(),
    },

    weekOf: {
      type: Date,
      required: true,
      default: () => getWeekDates().weekStart,
    },

    weekNumber: {
      type: Number,
      required: true,
      default: function () {
        return mongoose.model('ModerationAction').getCurrentWeekNumber();
      },
    },
  },
  {
    timestamps: {
      currentTime: () => getBrasiliaDate(),
    },
  }
);

ModerationActionSchema.index({ guildId: 1, timestamp: 1 });
ModerationActionSchema.index({ weekOf: 1, moderatorId: 1 });
ModerationActionSchema.index({ weekNumber: 1, moderatorId: 1 });
ModerationActionSchema.index({ timestamp: 1 });
ModerationActionSchema.index({ moderatorId: 1, timestamp: 1 });

ModerationActionSchema.statics.getCurrentWeekNumber = function () {
  const now = getBrasiliaDate();
  const start = new Date(now.getFullYear(), 0, 1);
  const firstWeek = new Date(start);
  firstWeek.setDate(start.getDate() + (1 - start.getDay()));
  const days = Math.floor((now - firstWeek) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + 1) / 7);
};

ModerationActionSchema.statics.getActionsForPeriod = async function (guildId, startDate, endDate) {
  try {
    return await this.aggregate([
      {
        $match: {
          guildId: guildId,
          timestamp: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: '$moderatorId',
          aceitas: { $sum: { $cond: [{ $eq: ['$action', 'aceita'] }, 1, 0] } },
          recusadas: { $sum: { $cond: [{ $eq: ['$action', 'recusada'] }, 1, 0] } },
          analises: { $sum: { $cond: [{ $eq: ['$action', 'analise'] }, 1, 0] } },
          reivindicacoes: { $sum: { $cond: [{ $eq: ['$action', 'reivindicacao'] }, 1, 0] } },
          ultimaAcao: { $max: '$timestamp' },
        },
      },
      {
        $addFields: {
          total: { $add: ['$aceitas', '$recusadas', '$analises', '$reivindicacoes'] },
        },
      },
      { $sort: { total: -1 } },
    ]);
  } catch (error) {
    console.error('Erro ao buscar ações por período:', error);
    throw error;
  }
};

ModerationActionSchema.statics.getActionsForCurrentWeek = async function (guildId) {
  try {
    const { weekStart, weekEnd } = getWeekDates();

    const endExclusive = new Date((weekEnd instanceof Date ? weekEnd : getBrasiliaDate()).getTime() + 1);

    return await this.getActionsForPeriod(guildId, weekStart, endExclusive);
  } catch (error) {
    console.error('Erro ao buscar ações da semana:', error);
    throw error;
  }
};

ModerationActionSchema.statics.getMonthDates = function () {
  const now = getBrasiliaDate();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now);
  return { monthStart, monthEnd };
};

ModerationActionSchema.statics.getActionsForCurrentMonth = async function (guildId) {
  try {
    const { monthStart, monthEnd } = this.getMonthDates();
    const endExclusive = new Date(monthEnd.getTime() + 1);
    return await this.getActionsForPeriod(guildId, monthStart, endExclusive);
  } catch (error) {
    console.error('Erro ao buscar ações do mês:', error);
    throw error;
  }
};

ModerationActionSchema.statics.getTodayDates = function () {
  const now = getBrasiliaDate();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now);
  return { startOfDay, endOfDay };
};

ModerationActionSchema.statics.getActionsForToday = async function (guildId) {
  try {
    const { startOfDay, endOfDay } = this.getTodayDates();
    const endExclusive = new Date(endOfDay.getTime() + 1);
    return await this.getActionsForPeriod(guildId, startOfDay, endExclusive);
  } catch (error) {
    console.error('Erro ao buscar ações do dia:', error);
    throw error;
  }
};

ModerationActionSchema.statics.validarAcao = async function (moderatorId, action, denunciaId, guildId) {
  if (!moderatorId || !action || !guildId) throw new Error('Dados obrigatórios ausentes');

  try {
    const { weekStart } = getWeekDates();
    const weekNumber = this.getCurrentWeekNumber();

    const novaAcao = new this({
      moderatorId,
      action,
      denunciaId,
      guildId,
      weekNumber,
      weekOf: weekStart,
      timestamp: getBrasiliaDate(),
    });

    return await novaAcao.save();
  } catch (error) {
    console.error('Erro ao validar ação:', error);
    throw error;
  }
};
 
const ModerationAction =
  mongoose.models.ModerationAction || mongoose.model('ModerationAction', ModerationActionSchema);

cron.schedule(
  '5 0 1 * *',
  async () => {
    try {
      await ModerationAction.deleteMany({});
      console.log(`[DATABASE] Reset mensal do ranking realizado.`);
    } catch (error) {
      console.error('Erro no reset mensal:', error);
    }
  },
  {
    timezone: 'America/Sao_Paulo',
    scheduled: true,
  }
);

module.exports = ModerationAction;