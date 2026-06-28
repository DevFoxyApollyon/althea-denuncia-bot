const { EmbedBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const dateUtils = require('../utils/dateUtils');

class LogManager {
    constructor(client, config) {
        this.client = client;
        this.config = config;
    }

    truncateText(text, maxLength = 1024) {
        if (!text) return 'Não informado';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    }

    formatProvas(provas) {
        if (!provas) return 'Não informado';
        const links = provas.split(/[,\n]/).filter(url => url.trim().startsWith('http'));
        if (links.length === 0) return 'Não informado';
        return links.map((url, index) => `🔗 [Evidência ${index + 1}](${url.trim()})`).join('\n');
    }

    getStatusEmoji(type) {
        const statusMap = {
            analise: '🔎 Em Análise',
            aceita: '✅ Aceita',
            recusada: '❌ Recusada'
        };
        return statusMap[type] || '❓ Desconhecido';
    }

    async createLogEmbed(type, staffUser, threadId) {
        try {
            const denuncia = await Denuncia.findOne({ threadId }).lean();

            if (!denuncia) {
                console.error(`❌ [LOG] Denúncia ${threadId} não encontrada no banco.`);
                return null;
            }

            const colorMap = { analise: '#FFA500', aceita: '#00FF00', recusada: '#FF0000' };
            const titleMap = {
                analise: '📋 Denúncia em Análise',
                aceita: '✅ Denúncia Aceita',
                recusada: '❌ Denúncia Recusada'
            };

            const embed = new EmbedBuilder()
                .setColor(colorMap[type] || '#2f3136')
                .setTitle(titleMap[type])
                .setTimestamp()
                .setAuthor({
                    name: 'Sistema de Denúncias',
                    iconURL: this.client.user.displayAvatarURL()
                })
                .setFooter({
                    text: `Staff: ${staffUser.tag} • Brasília: ${dateUtils.getBrasiliaDateTime()}`,
                    iconURL: staffUser.displayAvatarURL()
                });

            embed.addFields(
                { name: '👤 Staff Responsável', value: `${staffUser}`, inline: false },
                { name: '📊 Status Atual', value: this.getStatusEmoji(type), inline: false },
                { name: '⏱️ Criado por', value: `<@${denuncia.criadoPor}> (${dateUtils.getDiscordTimestamp(denuncia.createdAt || new Date(), 'R')})`, inline: false },
                { name: '💻 Plataforma', value: `\`${denuncia.platform || 'Não informada'}\``, inline: false }
            );

            if (type === 'aceita') {
                embed.addFields(
                    { name: '🎯 Acusado', value: `\`${denuncia.acusadoId || denuncia.acusado || 'Não informado'}\``, inline: false },
                    { name: '⚖️ Motivo da Punição', value: this.truncateText(denuncia.motivoAceite), inline: false },
                    { name: '📅 Data da Punição', value: denuncia.dataPunicao || 'Registrada agora', inline: false }
                );
            } else {
                embed.addFields(
                    { name: '🎯 Acusado', value: `\`${denuncia.acusado || 'Não informado'}\``, inline: false },
                    { name: '📝 Motivo', value: this.truncateText(denuncia.motivo), inline: false }
                );
            }

            const provasText = this.formatProvas(denuncia.provas);
            const denunciaLink = denuncia.messageId 
                ? `🔗 [Mensagem Original](https://discord.com/channels/${this.config.guildId}/${denuncia.channelId}/${denuncia.messageId})`
                : 'Não disponível';
            const provasComLink = provasText === 'Não informado' 
                ? denunciaLink 
                : `${denunciaLink}\n\n${provasText}`;
            
            embed.addFields({ name: '🔍 Provas/Evidências', value: provasComLink, inline: false });

            if (denuncia.historico?.length > 0) {
                const hist = denuncia.historico
                    .slice(-3) 
                    .reverse()
                    .map(h => `${dateUtils.getDiscordTimestamp(h.data, 'R')} - ${h.acao} por <@${h.staffId}>`)
                    .join('\n');
                embed.addFields({ name: '📜 Histórico Recente', value: hist, inline: false });
            }

            return embed;
        } catch (error) {
            console.error('❌ [LOG] Erro ao gerar embed:', error);
            return null;
        }
    }
}

module.exports = { LogManager };