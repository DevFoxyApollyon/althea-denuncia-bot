// services/rankService.js
const ModerationAction = require('../models/ModerationAction');
const Config = require('../models/Config');

class RankService {
  static rankCache = new Map();
  static cacheTimeout = 5 * 60 * 1000; 

  static async getRankData(guild, type = 'month', forceRefresh = false) {
    try {
      const safeType = (type === 'week' || type === 'day' || type === 'month') ? type : 'month';

      const cacheKey = `${guild.id}:${safeType}`;
      const cached = this.rankCache.get(cacheKey);

      if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }

      const config = await Config.findOne({ guildId: guild.id }).lean();

      const adminRoleId = config?.roles?.administrador || config?.administrador;
      let activeModeratorMembers = new Map();

      if (adminRoleId) {
        const adminRole = await guild.roles.fetch(adminRoleId).catch(() => null);
        if (adminRole) {
          activeModeratorMembers = new Map(adminRole.members.entries());
        }
      }

      let allActions = [];
      if (safeType === 'day') {
        allActions = await ModerationAction.getActionsForToday(guild.id);
      } else if (safeType === 'week') {
        allActions = await ModerationAction.getActionsForCurrentWeek(guild.id);
      } else {
        allActions = await ModerationAction.getActionsForCurrentMonth(guild.id);
      }

      const finalActions = [];

      for (const action of allActions) {
        const moderatorId = action._id;
        if (!moderatorId) continue;

        const member = activeModeratorMembers.get(moderatorId) || guild.members.cache.get(moderatorId);

        const tag = member?.user?.username || member?.user?.tag || `Staff Antigo (${moderatorId})`;

        finalActions.push({
          _id: moderatorId,
          userId: moderatorId,
          tag,

          aceitas: action.aceitas || 0,
          recusadas: action.recusadas || 0,
          analises: action.analises || 0,
          reivindicacoes: action.reivindicacoes || 0,

          total: action.total || 0,
          ultimaAcao: action.ultimaAcao || null,
        });
      }

      finalActions.sort((a, b) => b.total - a.total);

      const result = {
        type: safeType,
        actions: finalActions,
        total: finalActions.reduce((sum, a) => sum + a.total, 0),
        stats: {
          aceitas: finalActions.reduce((sum, a) => sum + a.aceitas, 0),
          recusadas: finalActions.reduce((sum, a) => sum + a.recusadas, 0),
          analises: finalActions.reduce((sum, a) => sum + a.analises, 0),
          reivindicacoes: finalActions.reduce((sum, a) => sum + a.reivindicacoes, 0),
          participantes: finalActions.length,
        },
      };

      this.rankCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error('Erro ao buscar dados do ranking:', error);
      return {
        type: (type === 'week' || type === 'day' || type === 'month') ? type : 'month',
        actions: [],
        total: 0,
        stats: { aceitas: 0, recusadas: 0, analises: 0, reivindicacoes: 0, participantes: 0 },
      };
    }
  }

  static clearCache() {
    this.rankCache.clear();
  }
}

module.exports = RankService;