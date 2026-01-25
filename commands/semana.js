const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    AttachmentBuilder,
    MessageFlags 
} = require('discord.js');
const ModerationAction = require('../models/ModerationAction');
const Config = require('../models/Config');
const { toBrasiliaDate, formatDateBR, getWeekDates } = require('../utils/dateUtils'); 

const cache = new Map();
const CACHE_TTL = 300000; 

function getCache(key) {
    const item = cache.get(key);
    if (!item || Date.now() > item.expires) return null;
    return item.value;
}

function setCache(key, value) {
    cache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

function pad(n, w = 2) {
    return String(n).padStart(w, ' ');
}

async function getWeeklyStats(userId, guildId, weekStart, weekEnd, forceUpdate = false) {
    const cacheKey = `stats_${userId}_${guildId}_${weekStart.getTime()}`;
    if (!forceUpdate) {
        const cached = getCache(cacheKey);
        if (cached) return cached;
    }

    const stats = {
        total: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
        dias: {
            SEG: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            TER: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            QUA: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            QUI: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            SEX: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            SAB: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 },
            DOM: { analisadas: 0, recusadas: 0, aceitas: 0, reivindicadas: 0 }
        }
    };

    const acoes = await ModerationAction.find({
        moderatorId: userId,
        guildId: guildId, 
        timestamp: { $gte: weekStart, $lte: weekEnd }
    }).lean();

    const diasMap = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

    for (const acao of acoes) {
        const dataAcao = toBrasiliaDate(acao.timestamp);
        const dayName = diasMap[dataAcao.getDay()];
        
        let key = null;
        if (acao.action === 'aceita') key = 'aceitas';
        else if (acao.action === 'recusada') key = 'recusadas';
        else if (acao.action === 'analise') key = 'analisadas';
        else if (acao.action === 'reivindicacao') key = 'reivindicadas';
        
        if (key && stats.dias[dayName]) {
            stats.dias[dayName][key]++;
            stats.total[key]++;
        }
    }
    setCache(cacheKey, stats);
    return stats;
}

function buildTable(stats) {
    const order = ['SEG','TER','QUA','QUI','SEX','SAB','DOM'];
    const header = 'Contagem semanal    | SEG | TER | QUA | QUI | SEX | SAB | DOM |';
    const sep = '-----------------------------------------------------------';
    const rows = [
        { emoji: '✅', nome: 'Aceitas', key: 'aceitas' },
        { emoji: '❌', nome: 'Recusadas', key: 'recusadas' },
        { emoji: '🔍', nome: 'Análises', key: 'analisadas' },
        { emoji: '📝', nome: 'Reivindicadas', key: 'reivindicadas' }
    ];

    const formattedRows = rows.map(row => {
        const cols = order.map(d => pad(stats.dias[d][row.key], 2)).join(' | ');
        return `${pad(stats.total[row.key], 3)} ${row.emoji} ${row.nome.padEnd(15)}| ${cols} |`;
    });

    // CORREÇÃO: O rodapé da tabela agora mostra apenas o valor de Reivindicadas (194)
    return [header, sep, ...formattedRows, sep, `Total na Semana: ${stats.total.reivindicadas}`].join('\n');
}

async function handleSemanaCommand(message) {
    if (!message.guild) return;
    
    cache.clear();
    const loadingMessage = await message.channel.send('⏳ Gerando ranking semanal...');

    try {
        const config = await Config.findOne({ guildId: message.guild.id }).lean();
        if (!config) throw new Error('Configuração não encontrada.');
        
        const { weekStart, weekEnd } = getWeekDates();
        const periodStr = `${formatDateBR(weekStart)} a ${formatDateBR(weekEnd)}`;

        const activeModeratorIds = await ModerationAction.distinct('moderatorId', {
            guildId: message.guild.id,
            timestamp: { $gte: weekStart, $lte: weekEnd }
        });

        await message.guild.members.fetch();
        const allStats = await Promise.all(activeModeratorIds.map(async (userId) => {
            const member = message.guild.members.cache.get(userId);
            const stats = await getWeeklyStats(userId, message.guild.id, weekStart, weekEnd, true);
            
            // CORREÇÃO: O total usado para ordenar o ranking é apenas o da semana (Reivindicadas)
            const totalSemanal = stats.total.reivindicadas;
            
            return totalSemanal > 0 ? { 
                userId, 
                tag: member ? member.user.username : `Staff Fora (${userId})`, 
                stats, 
                total: totalSemanal 
            } : null;
        }));

        const sortedStats = allStats.filter(Boolean).sort((a, b) => b.total - a.total);
        if (sortedStats.length === 0) return loadingMessage.edit(`⚠️ Nenhuma ação encontrada neste servidor em ${periodStr}`);

        // Geração do arquivo TXT
        let txtContent = `RANKING STAFF - SERVIDOR: ${message.guild.name}\nPERIODO: ${periodStr}\n${'='.repeat(60)}\n\n`;
        sortedStats.forEach((s, i) => {
            txtContent += `${i+1}º ${s.tag} (ID: ${s.userId}) - Total Semanal: ${s.total}\n${buildTable(s.stats)}\n\n`;
        });
        const attachment = new AttachmentBuilder(Buffer.from(txtContent, 'utf-8'), { name: 'ranking_staff.txt' });

        const pageSize = 3;
        const totalPages = Math.ceil(sortedStats.length / pageSize);
        let currentPage = 0;

        const createContent = (page) => {
            const startIdx = page * pageSize;
            const currentGroup = sortedStats.slice(startIdx, startIdx + pageSize);
            let text = `🏆 **RANKING STAFF - ${periodStr}**\n*Servidor: ${message.guild.name}*\n\n`;
            currentGroup.forEach((admin, index) => {
                text += `**${startIdx + index + 1}º <@${admin.userId}>** (Total: ${admin.total})\n\`\`\`ansi\n${buildTable(admin.stats)}\n\`\`\`\n`;
            });
            text += `\n*Página ${page + 1} de ${totalPages}*`;
            return text;
        };

        const createButtons = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('first').setLabel('⏪').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(page === totalPages - 1),
                new ButtonBuilder().setCustomId('last').setLabel('⏩').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
            );
        };

        await loadingMessage.edit({
            content: createContent(currentPage),
            components: [createButtons(currentPage)],
            files: [attachment]
        });

        const collector = loadingMessage.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 600000 
        });
        
        collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) {
                return i.reply({ content: '❌ Sem permissão.', flags: [MessageFlags.Ephemeral] });
            }
            if (i.customId === 'prev') currentPage--;
            else if (i.customId === 'next') currentPage++;
            else if (i.customId === 'first') currentPage = 0;
            else if (i.customId === 'last') currentPage = totalPages - 1;
            
            await i.update({ content: createContent(currentPage), components: [createButtons(currentPage)] });
        });

        collector.on('end', () => {
            loadingMessage.edit({ components: [] }).catch(() => {});
        });

    } catch (error) {
        console.error(error);
        await loadingMessage.edit(`❌ Erro: ${error.message}`);
    }
}

module.exports = { handleSemanaCommand };