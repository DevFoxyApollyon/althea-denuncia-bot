const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const RankService = require('../services/rankService');
const Config = require('../models/Config');
const Denuncia = require('../models/Denuncia');
const ModerationAction = require('../models/ModerationAction');
const { getBrasiliaDate, formatDateBR, formatTimeBR } = require('../utils/dateUtils');

function pad(n, w = 2) {
    return String(n).padStart(w, ' ');
}

function getMonthDates() {
    const now = getBrasiliaDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now);
    return { monthStart, monthEnd };
}

function buildTable(stats) {
    const order = ['SEG','TER','QUA','QUI','SEX','SAB','DOM'];
    const header = 'Contagem mensal    | SEG | TER | QUA | QUI | SEX | SAB | DOM |';
    const sep    = '-----------------------------------------------------------';

    const rows = [
        { emoji: '❌', nome: 'Recusadas', key: 'recusadas', total: stats.total.recusadas },
        { emoji: '✅', nome: 'Aceitas',   key: 'aceitas',   total: stats.total.aceitas },
        { emoji: '🔍', nome: 'Análises',  key: 'analisadas', total: stats.total.analisadas },
        { emoji: '📝', nome: 'Reivindicadas', key: 'reivindicadas', total: stats.total.reivindicadas }
    ];

    const formattedRows = rows.map(({ emoji, nome, key, total }) => {
        const cols = order.map(d => pad(stats.dias[d][key], 2)).join(' | ');
        return `${pad(total, 3)} ${emoji} ${nome.padEnd(15)} | ${cols} |`;
    });

    const totalAcoes = (stats.total.aceitas || 0) + (stats.total.recusadas || 0) + (stats.total.analisadas || 0);

    return [
        header,
        sep,
        ...formattedRows,
        sep,
        `Total: ${totalAcoes}`
    ].join('\n');
}

async function generateRankTxt(actions) {
    const { monthStart, monthEnd } = getMonthDates();
    const now = getBrasiliaDate();
    
    const content = [
        `🏆 RANKING MENSAL DE DENÚNCIAS`,
        `Período: ${formatDateBR(monthStart)} até ${formatDateBR(monthEnd)}`,
        `Gerado em: ${formatDateBR(now)} às ${formatTimeBR(now)} (Brasília)`,
        `\n=================================\n`
    ];

    actions.forEach((mod, index) => {
        const moderatorId = String(mod._id ?? mod.userId ?? mod.moderatorId ?? mod.id ?? '').trim();
        const mention = moderatorId ? ` <@${moderatorId}>` : '';
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
        content.push(`${medal} ${index + 1}º Lugar | ${mod.tag || '[Sem tag]'}${mention}`);

        if (mod.stats) {
            content.push('```');
            content.push(buildTable(mod.stats));
            content.push('```');
        } else {
            content.push(`📊 Total: ${mod.total}`);
            content.push(`📝 Reivindicadas: ${mod.reivindicacoes || 0}`);
            content.push(`✅ Aceitas: ${mod.aceitas}`);
            content.push(`❌ Recusadas: ${mod.recusadas}`);
            content.push(`🔎 Análises: ${mod.analises}`);
        }

        content.push(`=================================`);
    });

    return content.join('\n');
}

async function getDailyStats(guild) {
    try {
        const todayBrasilia = getBrasiliaDate();
        const startOfDayBrasilia = new Date(todayBrasilia.getFullYear(), todayBrasilia.getMonth(), todayBrasilia.getDate(), 0, 0, 0, 0);
        const tomorrowBrasilia = new Date(startOfDayBrasilia);
        tomorrowBrasilia.setDate(tomorrowBrasilia.getDate() + 1);

        const totalDenuncias = await Denuncia.countDocuments({
            guildId: guild.id,
            createdAt: { $gte: startOfDayBrasilia, $lt: tomorrowBrasilia }
        });

        const totalReivindicadas = await Denuncia.countDocuments({
            guildId: guild.id,
            createdAt: { $gte: startOfDayBrasilia, $lt: tomorrowBrasilia },
            claimedBy: { $ne: null }
        });

        return {
            total: totalDenuncias,
            reivindicadas: totalReivindicadas,
            pendentes: totalDenuncias - totalReivindicadas
        };
    } catch (error) {
        console.error(error);
        return { total: 0, reivindicadas: 0, pendentes: 0 };
    }
}

async function uploadRankToWebhook(rankText, guild) {
    try {
        const channel = guild.channels.cache.find(c => c.name === 'rankings-storage' || c.name === 'rankings');
        if (!channel) return null;
        
        const webhook = await channel.createWebhook({ name: 'Rankings Storage', avatar: guild.iconURL() });
        const message = await webhook.send({
            files: [{
                attachment: Buffer.from(rankText),
                name: `ranking_mensal_${formatDateBR(getBrasiliaDate()).replace(/\//g, '-')}.txt`
            }]
        });

        const fileUrl = message.attachments.first()?.url;
        await webhook.delete(); 
        return fileUrl;
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function generateRankEmbed(actions, guild, monthStart, monthEnd, now, fileUrl, config) {
    const top10 = actions.slice(0, 10);
    const dailyStats = await getDailyStats(guild);

    const rankContent = top10.map((mod, index) => {
        const moderatorId = String(mod._id ?? mod.userId ?? mod.moderatorId ?? mod.id ?? '').trim();
        const mention = moderatorId ? ` <@${moderatorId}>` : '';
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
        if (mod.stats) {
            return [
                `${medal} ${index + 1}º Lugar | ${mod.tag || '[Sem tag]'}${mention}`,
                '```ansi',
                buildTable(mod.stats),
                '```',
                `═══════════════════════════════`
            ].join('\n');
        } else {
            return [
                `${medal} ${index + 1}º Lugar | ${mod.tag || '[Sem tag]'}${mention}`,
                `📊 Total: ${mod.total}`,
                `📝 Reivindicadas: ${mod.reivindicacoes || 0}`,
                `✅ Aceitas: ${mod.aceitas} | ❌ Recusadas: ${mod.recusadas} | 🔎 Análises: ${mod.analises}`,
                `═══════════════════════════════`
            ].join('\n');
        }
    }).join('\n');

    const description = [
        `*Ranking mensal acumulado de ${formatDateBR(monthStart)} até ${formatDateBR(monthEnd)}*`,
        `*Atualizado em ${formatDateBR(now)} às ${formatTimeBR(now)}*\n`,
        `📫 **Denúncias hoje:** ${dailyStats.total}`,
        `📝 **Reivindicadas hoje:** ${dailyStats.reivindicadas}`,
        `📊 **Pendentes hoje:** ${dailyStats.pendentes}\n`,
        rankContent,
        `\n⚠️ Top 10 exibido. Total de participantes: ${actions.length}`
    ];

    if (fileUrl) {
        description.push(`\n📥 [Clique aqui para baixar o ranking completo](${fileUrl})`);
    }

    const adminRoleId = config?.responsavel_admin ?? config?.adminRole ?? config?.responsavelAdmin ?? null;
    if (adminRoleId) {
        description.unshift(`📣 Responsável: <@&${adminRoleId}>`);
    }

    return new EmbedBuilder()
        .setColor('#2F3136')
        .setTitle('🏆 Ranking Mensal de Denúncias')
        .setDescription(description.join('\n'))
        .setTimestamp(now)
        .setFooter({ text: 'Atualização diária automática', iconURL: guild.iconURL({ dynamic: true }) });
}

async function sendRankMessage(channel, embed, rankText, guild, config) {
    if (!channel) return;
    try {
        const adminRoleId = config?.responsavel_admin ?? config?.adminRole ?? config?.responsavelAdmin ?? null;
        const roleMention = adminRoleId ? ` <@&${adminRoleId}>` : '';

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('download_rank').setLabel('📥 Baixar Ranking').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('copy_rank').setLabel('📋 Copiar Ranking').setStyle(ButtonStyle.Primary)
        );

        const sent = await channel.send({
            content: `📊 **Relatório Mensal Acumulado**${roleMention}`,
            embeds: [embed],
            components: [row],
            files: [{
                attachment: Buffer.from(rankText),
                name: `ranking_mensal_${formatDateBR(getBrasiliaDate()).replace(/\//g, '-')}.txt`
            }],
            allowedMentions: { parse: ['users', 'roles'] }
        });

        const collector = sent.createMessageComponentCollector({ time: 15 * 60 * 1000 });
        collector.on('collect', async i => {
            if (i.customId === 'download_rank') {
                await i.reply({
                    files: [{ attachment: Buffer.from(rankText), name: `ranking_mensal.txt` }],
                    ephemeral: true
                });
            } else if (i.customId === 'copy_rank') {
                await i.reply({
                    content: '```' + rankText.slice(0, 1900) + '```',
                    ephemeral: true
                });
            }
        });
    } catch (error) {
        console.error(error);
    }
}

function setupRankJobs(client) {
    cron.schedule('55 23 * * *', async () => {
        try {
            const now = getBrasiliaDate();
            const { monthStart, monthEnd } = getMonthDates();
            const configs = await Config.find({});
            
            for (const config of configs) {
                if (!config.channels.log && !config.channels.topDaily) continue;

                const guild = await client.guilds.fetch(config.guildId).catch(() => null);
                if (!guild) continue;
                
                const logChannel = config.channels.log ? await guild.channels.fetch(config.channels.log).catch(() => null) : null;
                const topDailyChannel = config.channels.topDaily ? await guild.channels.fetch(config.channels.topDaily).catch(() => null) : null;

                const { actions: allActions } = await RankService.getRankData(guild, monthStart, monthEnd);
                
                const interactingModeratorIds = await ModerationAction.distinct('moderatorId', {
                    guildId: guild.id,
                    timestamp: { $gte: monthStart, $lte: monthEnd }
                }).catch(() => []);
                
                const interactingSet = new Set(interactingModeratorIds.map(String));
                const actions = (allActions || []).filter(mod => {
                    const mid = String(mod._id ?? mod.userId ?? mod.moderatorId ?? mod.id ?? '').trim();
                    return mid && interactingSet.has(mid);
                });
                
                for (const mod of actions) {
                    const moderatorId = mod._id || mod.userId; 
                    let member = guild.members.cache.get(moderatorId);
                    if (!member) {
                        try {
                            member = await guild.members.fetch({ user: moderatorId, cache: true });
                            mod.tag = member.user.tag;
                        } catch {
                            mod.tag = `[Ex-Membro: ${moderatorId}]`;
                        }
                    } else {
                        mod.tag = member.user.tag;
                    }
                }
                
                const rankText = await generateRankTxt(actions);
                const fileUrl = await uploadRankToWebhook(rankText, guild);
                const embed = await generateRankEmbed(actions, guild, monthStart, monthEnd, now, fileUrl, config);

                await sendRankMessage(logChannel, embed, rankText, guild, config);
                if (topDailyChannel) {
                    await sendRankMessage(topDailyChannel, embed, rankText, guild, config);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });
}

module.exports = { setupRankJobs };