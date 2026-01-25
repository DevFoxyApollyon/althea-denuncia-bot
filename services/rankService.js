const ModerationAction = require('../models/ModerationAction');
const Config = require('../models/Config');

class RankService {
    static rankCache = new Map();
    static cacheTimeout = 5 * 60 * 1000; // 5 minutos

    static async getRankData(guild, forceRefresh = false) {
        try {
            const cacheKey = guild.id;
            const cached = this.rankCache.get(cacheKey);

            if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }

            const config = await Config.findOne({ guildId: guild.id }).lean();
            
            // Busca o cargo de administrador para tentar pegar as TAGS amigáveis
            const adminRoleId = config?.roles?.administrador || config?.administrador;
            let activeModeratorMembers = new Map();

            if (adminRoleId) {
                const adminRole = await guild.roles.fetch(adminRoleId).catch(() => null);
                if (adminRole) {
                    activeModeratorMembers = new Map(adminRole.members.entries());
                }
            }
            
            // 🛑 Busca as ações no banco (usando a lógica de data corrigida no Model)
            const allActions = await ModerationAction.getActionsForCurrentWeek(guild.id); 

            const finalActions = [];
            
            for (const action of allActions) {
                const moderatorId = action._id; 
                if (!moderatorId) continue;
                
                // Tenta pegar o membro pela lista do cargo, se não conseguir, tenta pelo cache geral da guild
                const member = activeModeratorMembers.get(moderatorId) || guild.members.cache.get(moderatorId);
                
                // Define a tag. Se o membro não for encontrado, exibe o ID mas NÃO remove do rank.
                const tag = member?.user?.username || member?.user?.tag || `Staff Antigo (${moderatorId})`;

                finalActions.push({
                    _id: moderatorId, 
                    userId: moderatorId, 
                    tag: tag,
                    aceitas: action.aceitas || 0,
                    recusadas: action.recusadas || 0,
                    analises: action.analises || 0,
                    reivindicacoes: action.reivindicacoes || 0,
                    total: action.total || 0,
                });
            }

            // Ordena por total de ações (Maior para o menor)
            finalActions.sort((a, b) => b.total - a.total);

            // Re-calcula o total geral e as estatísticas do servidor
            const result = {
                actions: finalActions,
                total: finalActions.reduce((sum, action) => sum + action.total, 0),
                stats: {
                    aceitas: finalActions.reduce((sum, action) => sum + action.aceitas, 0),
                    recusadas: finalActions.reduce((sum, action) => sum + action.recusadas, 0),
                    analises: finalActions.reduce((sum, action) => sum + action.analises, 0),
                    reivindicacoes: finalActions.reduce((sum, action) => sum + action.reivindicacoes, 0),
                    participantes: finalActions.length
                }
            };

            // Salva no cache
            this.rankCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Erro ao buscar dados do ranking:', error);
            return { 
                actions: [], 
                total: 0, 
                stats: { aceitas: 0, recusadas: 0, analises: 0, reivindicacoes: 0, participantes: 0 } 
            };
        }
    }

    static clearCache() {
        this.rankCache.clear();
    }
}

module.exports = RankService;