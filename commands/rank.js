const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const RankService = require('../services/rankService');
const Config = require('../models/Config');
const Denuncia = require('../models/Denuncia');
const ModerationAction = require('../models/ModerationAction');
const { getBrasiliaDate, formatDateBR } = require('../utils/dateUtils'); 

const ITEMS_PER_PAGE = 8;

function getMonthDates() {
    const now = getBrasiliaDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now); 
    return { monthStart, monthEnd };
}

async function getDailyStats(guildId) {
    try {
        const today = getBrasiliaDate();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
        const tomorrow = new Date(startOfDay);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const totalDenuncias = await Denuncia.countDocuments({
            guildId: guildId,
            createdAt: { $gte: startOfDay, $lt: tomorrow }
        });

        const totalReivindicadas = await Denuncia.countDocuments({
            guildId: guildId,
            createdAt: { $gte: startOfDay, $lt: tomorrow },
            claimedBy: { $ne: null }
        });

        return {
            total: totalDenuncias,
            reivindicadas: totalReivindicadas,
            pendentes: Math.max(0, totalDenuncias - totalReivindicadas)
        };
    } catch (error) {
        return { total: 0, reivindicadas: 0, pendentes: 0 };
    }
}

function buildRankTable(actions) {
    const rows = actions.map((mod, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
        return `${medal} ${(index + 1).toString().padStart(2)}º ${mod.tag}
📊 Total: ${mod.total} | ✅ Aceitas: ${mod.aceitas} | ❌ Recusadas: ${mod.recusadas}
📝 Reivindicadas: ${mod.reivindicadas}
─────────────────────────`;
    });
    return rows.length > 0 ? rows.join('\n') : "Nenhuma ação registrada.";
}

// FUNÇÃO PARA GERAR O CONTEÚDO DO TXT
function generateRankTxtContent(actions, guildName, guildId, start, end, daily) {
    const content = [
        `🏆 RANKING MENSAL DE MODERAÇÃO - ${guildName.toUpperCase()}`,
        `Período: ${formatDateBR(start)} até ${formatDateBR(end)}`,
        `Gerado em: ${formatDateBR(getBrasiliaDate())}`,
        `\n--- ESTATÍSTICAS DO SERVIDOR HOJE ---`,
        `📫 Denúncias hoje: ${daily.total}`,
        `📝 Reivindicadas: ${daily.reivindicadas}`,
        `📊 Pendentes: ${daily.pendentes}`,
        `\n--- RANKING INDIVIDUAL COMPLETO ---`,
        `====================================================`
    ];

    actions.forEach((mod, index) => {
        content.push(
            `${(index + 1)}º LUGAR: ${mod.plainTag || mod.userId}`,
            `ID: ${mod.userId}`,
            `Total de Ações: ${mod.total}`,
            `✅ Aceitas: ${mod.aceitas}`,
            `❌ Recusadas: ${mod.recusadas}`,
            `📝 Reivindicadas: ${mod.reivindicadas}`,
            `----------------------------------------------------`
        );
    });

    return content.join('\n');
}

async function handleRankCommand(message) {
    let loadingMsg = null;
    let page = 0;
    
    try {
        if (!message || !message.guild) return;
        loadingMsg = await message.reply("🔄 Calculando ranking mensal e gerando relatório...");

        const { monthStart, monthEnd } = getMonthDates();
        const { actions: rawActions } = await RankService.getRankData(message.guild, monthStart, monthEnd);
        
        if (!rawActions || rawActions.length === 0) {
            return loadingMsg.edit(`⚠️ Nenhuma ação registrada de ${formatDateBR(monthStart)} até hoje.`);
        }

        await message.guild.members.fetch();
        const dailyStats = await getDailyStats(message.guild.id);

        // Normalização de dados para Embed e TXT
        const formattedActions = rawActions.map(a => {
            const userId = a.userId || a.id;
            const member = message.guild.members.cache.get(userId);
            return {
                ...a,
                userId,
                plainTag: member ? member.user.username : `Desconhecido (${userId})`,
                tag: member ? `<@${userId}> (${member.user.username})` : `<@${userId}>`,
                aceitas: a.aceita || a.aceitas || 0,
                recusadas: a.recusada || a.recusadas || 0,
                reivindicadas: a.reivindicacao || a.reivindicacoes || 0
            };
        });

        // --- GERAÇÃO DO ARQUIVO TXT ---
        const txtString = generateRankTxtContent(formattedActions, message.guild.name, message.guild.id, monthStart, monthEnd, dailyStats);
        const attachment = new AttachmentBuilder(Buffer.from(txtString, 'utf-8'), { name: `ranking_mensal_${message.guild.id}.txt` });

        const totalPages = Math.ceil(formattedActions.length / ITEMS_PER_PAGE);

        const createEmbed = (pageNum) => {
            const start = pageNum * ITEMS_PER_PAGE;
            const pageActions = formattedActions.slice(start, start + ITEMS_PER_PAGE);

            return new EmbedBuilder()
                .setColor('#2F3136')
                .setTitle('🏆 Ranking Mensal (Acumulado)')
                .setDescription(
                    `*Período: ${formatDateBR(monthStart)} até hoje*\n\n` +
                    `📫 **Hoje:** ${dailyStats.total} | 📝 **Reiv:** ${dailyStats.reivindicadas}\n` +
                    `📊 **Pendentes:** ${dailyStats.pendentes}\n\n` +
                    buildRankTable(pageActions)
                )
                .setFooter({ text: `Página ${pageNum + 1} de ${totalPages} | Horário de Brasília` })
                .setTimestamp();
        };

        const getButtons = (pageNum) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pageNum === 0),
                new ButtonBuilder().setCustomId('next').setLabel('Próximo').setStyle(ButtonStyle.Secondary).setDisabled(pageNum === totalPages - 1)
            );
        };

        // ENVIANDO EMBED + ARQUIVO TXT JUNTOS
        await loadingMsg.edit({ 
            content: "✅ Ranking carregado com sucesso!", 
            embeds: [createEmbed(0)], 
            components: [getButtons(0)],
            files: [attachment] 
        });

        const collector = loadingMsg.createMessageComponentCollector({ idle: 120000 });

        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: '❌ Apenas quem usou o comando pode navegar.', ephemeral: true });

            if (i.customId === 'prev') page--;
            if (i.customId === 'next') page++;

            await i.update({ embeds: [createEmbed(page)], components: [getButtons(page)] });
        });

    } catch (error) {
        console.error(error);
        if (loadingMsg) loadingMsg.edit("❌ Erro ao processar ranking.");
    }
}

module.exports = { handleRankCommand };