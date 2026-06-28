// LogManager.js
/**
 * Handlers/LogManager.js
 * Gerenciamento centralizado de logs de denÃºncias.
 */
const { EmbedBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const dateUtils = require('../utils/dateUtils');

class LogManager {
    constructor(client, config) {
        this.client = client;
        this.config = config;
    }

    /**
     * Trunca textos longos para nÃ£o exceder o limite dos Embeds (1024 caracteres).
     */
    truncateText(text, maxLength = 1024) {
        if (!text) return 'NÃ£o informado';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    }

    /**
     * Formata os links de provas em formato markdown.
     */
    formatProvas(provas) {
        if (!provas) return 'NÃ£o informado';
        const links = provas.split(/[,\n]/).filter(url => url.trim().startsWith('http'));
        if (links.length === 0) return 'NÃ£o informado';
        return links.map((url, index) => `ðŸ”— [EvidÃªncia ${index + 1}](${url.trim()})`).join('\n');
    }

    getStatusEmoji(type) {
        const statusMap = {
            analise: 'ðŸ”Ž Em AnÃ¡lise',
            aceita: 'âœ… Aceita',
            recusada: 'âŒ Recusada'
        };
        return statusMap[type] || 'â“ Desconhecido';
    }

    /**
     * Cria o Embed de Log principal.
     */
    async createLogEmbed(type, staffUser, threadId) {
        try {
            // .lean() melhora a performance e economiza RAM
            const denuncia = await Denuncia.findOne({ threadId }).lean();

            if (!denuncia) {
                console.error(`âŒ [LOG] DenÃºncia ${threadId} nÃ£o encontrada no banco.`);
                return null;
            }

            const colorMap = { analise: '#FFA500', aceita: '#00FF00', recusada: '#FF0000' };
            const titleMap = {
                analise: 'ðŸ“‹ DenÃºncia em AnÃ¡lise',
                aceita: 'âœ… DenÃºncia Aceita',
                recusada: 'âŒ DenÃºncia Recusada'
            };

            const embed = new EmbedBuilder()
                .setColor(colorMap[type] || '#2f3136')
                .setTitle(titleMap[type])
                .setTimestamp()
                .setAuthor({
                    name: 'Sistema de DenÃºncias',
                    iconURL: this.client.user.displayAvatarURL()
                })
                .setFooter({
                    text: `Staff: ${staffUser.tag} â€¢ BrasÃ­lia: ${dateUtils.getBrasiliaDateTime()}`,
                    iconURL: staffUser.displayAvatarURL()
                });

            // Campos de IdentificaÃ§Ã£o
            embed.addFields(
                { name: 'ðŸ‘¤ Staff ResponsÃ¡vel', value: `${staffUser}`, inline: false },
                { name: 'ðŸ“Š Status Atual', value: this.getStatusEmoji(type), inline: false },
                { name: 'â±ï¸ Criado por', value: `<@${denuncia.criadoPor}> (${dateUtils.getDiscordTimestamp(denuncia.createdAt || new Date(), 'R')})`, inline: false },
                { name: 'ðŸ’» Plataforma', value: `\`${denuncia.platform || 'NÃ£o informada'}\``, inline: false }
            );

            // ConteÃºdo dependente do status
            if (type === 'aceita') {
                embed.addFields(
                    { name: 'ðŸŽ¯ Acusado', value: `\`${denuncia.acusadoId || denuncia.acusado || 'NÃ£o informado'}\``, inline: false },
                    { name: 'âš–ï¸ Motivo da PuniÃ§Ã£o', value: this.truncateText(denuncia.motivoAceite), inline: false },
                    { name: 'ðŸ“… Data da PuniÃ§Ã£o', value: denuncia.dataPunicao || 'Registrada agora', inline: false }
                );
            } else {
                embed.addFields(
                    { name: 'ðŸŽ¯ Acusado', value: `\`${denuncia.acusado || 'NÃ£o informado'}\``, inline: false },
                    { name: 'ðŸ“ Motivo', value: this.truncateText(denuncia.motivo), inline: false }
                );
            }

            // Provas e Links
            const provasText = this.formatProvas(denuncia.provas);
            const denunciaLink = denuncia.messageId 
                ? `ðŸ”— [Mensagem Original](https://discord.com/channels/${this.config.guildId}/${denuncia.channelId}/${denuncia.messageId})`
                : 'NÃ£o disponÃ­vel';
            const provasComLink = provasText === 'NÃ£o informado' 
                ? denunciaLink 
                : `${denunciaLink}\n\n${provasText}`;
            
            embed.addFields({ name: 'ðŸ” Provas/EvidÃªncias', value: provasComLink, inline: false });

            // HistÃ³rico Recente (Usando Timestamps Relativos do Discord)
            if (denuncia.historico?.length > 0) {
                const hist = denuncia.historico
                    .slice(-3) // Ãšltimas 3 aÃ§Ãµes
                    .reverse()
                    .map(h => `${dateUtils.getDiscordTimestamp(h.data, 'R')} - ${h.acao} por <@${h.staffId}>`)
                    .join('\n');
                embed.addFields({ name: 'ðŸ“œ HistÃ³rico Recente', value: hist, inline: false });
            }

            return embed;
        } catch (error) {
            console.error('âŒ [LOG] Erro ao gerar embed:', error);
            return null;
        }
    }
}

module.exports = { LogManager };