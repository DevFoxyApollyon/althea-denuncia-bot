const { EmbedBuilder } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const dateUtils = require('../utils/dateUtils');

const EMBED_FIELD_LIMIT = 1024;
const STATUS_META = {
    analise: { label: '🔎 Em Análise', color: '#FFA500', title: '📋 Denúncia em Análise' },
    aceita: { label: '✅ Aceita', color: '#00FF00', title: '✅ Denúncia Aceita' },
    recusada: { label: '❌ Recusada', color: '#FF0000', title: '❌ Denúncia Recusada' },
};

class LogManager {
    constructor(client, config) {
        this.client = client;
        this.config = config;
    }

    truncateText(text, maxLength = 1024) {
        if (!text) return 'Não informado';
        const value = String(text);
        return value.length > maxLength ? `${value.substring(0, maxLength - 3)}...` : value;
    }

    formatProvas(provas) {
        if (!provas) return 'Não informado';
        const links = String(provas).split(/[,\n]/).filter(url => url.trim().startsWith('http'));
        if (links.length === 0) return 'Não informado';
        return this.truncateText(
            links.map((url, index) => `🔗 [Evidência ${index + 1}](${url.trim()})`).join('\n'),
            EMBED_FIELD_LIMIT
        );
    }

    getStatusEmoji(type) {
        return STATUS_META[type]?.label || '❓ Desconhecido';
    }

    getStatusMeta(type) {
        return STATUS_META[type] || {
            label: '❓ Desconhecido',
            color: '#2f3136',
            title: '📋 Registro de Denúncia'
        };
    }

    formatHistory(historico = []) {
        if (!historico.length) return null;

        return this.truncateText(
            historico
                .slice(-3)
                .reverse()
                .map(item => `${dateUtils.getDiscordTimestamp(item.data, 'R')} - ${item.acao} por <@${item.staffId}>`)
                .join('\n'),
            EMBED_FIELD_LIMIT
        );
    }

    createBaseEmbed(type, staffUser) {
        const status = this.getStatusMeta(type);
        const staffTag = staffUser?.tag || staffUser?.username || 'Sistema';

        return new EmbedBuilder()
            .setColor(status.color)
            .setTitle(status.title)
            .setTimestamp()
            .setAuthor({
                name: 'Sistema de Denúncias',
                iconURL: this.client.user?.displayAvatarURL()
            })
            .setFooter({
                text: `Staff: ${staffTag} • Brasília: ${dateUtils.getBrasiliaDateTime()}`,
                iconURL: staffUser?.displayAvatarURL?.()
            });
    }

    getDenunciaUrl(denuncia) {
        if (!denuncia?.messageId || !this.config?.guildId || !denuncia.channelId) return null;
        return `https://discord.com/channels/${this.config.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
    }

    createDenunciaFields(type, denuncia, staffUser, actionSource = 'botão') {
        const messageId = denuncia?.messageId || denuncia?._id || 'N/A';
        const fields = [
            { name: '👤 Responsável', value: `${staffUser || 'Sistema'}`, inline: true },
            {
                name: '⏱️ Criado por',
                value: `<@${denuncia.criadoPor}> (${dateUtils.getDiscordTimestamp(denuncia.createdAt || denuncia.dataCriacao || new Date(), 'R')})`,
                inline: false
            },
            { name: '🆔 Denúncia', value: `\`${String(messageId)}\``, inline: true }
        ];

        if (type === 'aceita') {
            fields.push(
                { name: '🎯 Acusado', value: this.truncateText(`\`${denuncia.acusadoId || denuncia.acusado || 'Não informado'}\``), inline: false }
            );
        } else {
            fields.push(
                { name: '🎯 Acusado', value: this.truncateText(`\`${denuncia.acusado || 'Não informado'}\``), inline: false }
            );
        }

        return fields;
    }

    async createLogEmbed(type, staffUser, threadId, options = {}) {
        try {
            const denuncia = await Denuncia.findOne({ threadId }).lean();

            if (!denuncia) {
                console.error(`❌ [LOG] Denúncia ${threadId} não encontrada no banco.`);
                return null;
            }

            const actionSource = options.actionSource || 'botão';
            const embed = this.createBaseEmbed(type, staffUser);
            const denunciaUrl = this.getDenunciaUrl(denuncia);
            if (denunciaUrl) embed.setURL(denunciaUrl);
            embed.addFields(...this.createDenunciaFields(type, denuncia, staffUser, actionSource));

            const denunciaLink = denunciaUrl
                ? `🔗 [Abrir denúncia](${denunciaUrl})`
                : 'Não disponível';

            embed.addFields({ name: '🔗 Denúncia', value: this.truncateText(denunciaLink), inline: false });

            const history = this.formatHistory(denuncia.historico);
            if (history) embed.addFields({ name: '📜 Histórico Recente', value: history, inline: false });

            return embed;
        } catch (error) {
            console.error('❌ [LOG] Erro ao gerar embed:', error);
            return null;
        }
    }
}

module.exports = { LogManager };