// status.js
const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits,
    MessageFlags,
    version: djsVersion,
} = require('discord.js');
const os = require('os');
const { monitor } = require('../utils/monitoring');
const { advancedMonitor } = require('../utils/advancedMonitoring');
const { globalCache } = require('../utils/smartCache');

const MAX_RAM_MB        = 4096;
const PING_HISTORY_MAX  = 20;
const AUTO_REFRESH_MS   = 60_000;
const ALERT_PING_MS     = 300;
const ALERT_RAM_PCT     = 80;
const ALERT_DB_MS       = 500;

const pingHistory   = [];
const ramHistory    = [];
const peakStats     = { ram: 0, ramTime: null, ping: 0, pingTime: null };
const autoRefreshMap = new Map();

const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

const formatUptime = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
};

const getProgressBar = (current, max, size = 12) => {
    const pct    = Math.min((current / max) * 100, 100);
    const filled = Math.round((pct / 100) * size);
    const bar    = '█'.repeat(filled) + '░'.repeat(size - filled);
    const color  = pct >= 85 ? '🔴' : pct >= 60 ? '🟠' : '🟢';
    return `${color} \`${bar}\` **${pct.toFixed(1)}%**`;
};

const getStatusBadge = (ping, dbLatency, memPct) => {
    if (ping > 300 || dbLatency > 500 || memPct > 90) return { label: '🔴 CRÍTICO',    color: '#e74c3c' };
    if (ping > 150 || dbLatency > 250 || memPct > 70) return { label: '🟠 DEGRADADO', color: '#f39c12' };
    return { label: '🟢 OPERACIONAL', color: '#2ecc71' };
};

const getCpuUsage = () => {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
        for (const type in cpu.times) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
    });
    return Math.min(100 - (100 * totalIdle / totalTick), 100).toFixed(1);
};

function buildLatencyGraph(history) {
    if (!history.length) return '`Sem dados suficientes`';
    const max  = Math.max(...history);
    const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
    const graph = history.map(v => bars[Math.min(Math.floor((v / max) * (bars.length - 1)), bars.length - 1)]).join('');
    const last  = history[history.length - 1];
    return `\`${graph}\`  _último: **${last}ms**_`;
}

function recordMetrics(ping, ramMB) {
    const now = new Date();

    pingHistory.push(ping);
    if (pingHistory.length > PING_HISTORY_MAX) pingHistory.shift();

    ramHistory.push(Math.round(ramMB));
    if (ramHistory.length > PING_HISTORY_MAX) ramHistory.shift();

    if (ramMB > peakStats.ram) { peakStats.ram = ramMB; peakStats.ramTime = now; }
    if (ping > peakStats.ping) { peakStats.ping = ping; peakStats.pingTime = now; }
}

function createStatusEmbed(client) {
    const mem       = process.memoryUsage();
    const uptime    = process.uptime();
    const dbLatency = monitor.getMetrics().dbLatency || 0;
    const wsPing    = client.ws.ping;
    const memUsedMB = parseFloat(formatMB(mem.rss));
    const memPct    = (memUsedMB / MAX_RAM_MB) * 100;
    const cpuPct    = parseFloat(getCpuUsage());
    const report    = advancedMonitor.generateDetailedReport();
    const errors    = monitor.generateReport().summary.errors;
    const cache     = globalCache.getStats();

    recordMetrics(wsPing, memUsedMB);

    const { label: statusLabel, color: statusColor } = getStatusBadge(wsPing, dbLatency, memPct);

    const totalGuilds   = client.guilds.cache.size;
    const totalMembers  = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
    const totalChannels = client.guilds.cache.reduce((acc, g) => acc + g.channels.cache.size, 0);

    const peakRamStr  = peakStats.ramTime
        ? `\`${peakStats.ram.toFixed(1)} MB\` Ã s ${peakStats.ramTime.toLocaleTimeString('pt-BR')}`
        : '`Sem dados`';
    const peakPingStr = peakStats.pingTime
        ? `\`${peakStats.ping}ms\` Ã s ${peakStats.pingTime.toLocaleTimeString('pt-BR')}`
        : '`Sem dados`';

    return new EmbedBuilder()
        .setAuthor({ 
            name: `${client.user.username} — Painel Administrativo`, 
            iconURL: client.user.displayAvatarURL({ dynamic: true }) 
        })
        .setColor(statusColor)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`## ${statusLabel}\n> Diagnóstico completo em tempo real.\n\u200B`)
        .addFields(
            {
                name: '🌐 Rede & API',
                value: `**WebSocket:** \`${wsPing}ms\`\n` +
                       `**Database:** \`${dbLatency}ms\`\n` +
                       `**Servidores:** \`${totalGuilds}\`\n` +
                       `**Membros:** \`${totalMembers.toLocaleString('pt-BR')}\`\n` +
                       `**Canais:** \`${totalChannels}\``,
                inline: true
            },
            {
                name: '⚙️ Runtime',
                value: `**Node.js:** \`${process.version}\`\n` +
                       `**Discord.js:** \`v${djsVersion}\`\n` +
                       `**PID:** \`${process.pid}\`\n` +
                       `**Plataforma:** \`${os.type()} ${os.arch()}\`\n` +
                       `**Uptime:** \`${formatUptime(uptime)}\``,
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false },
            {
                name: '🧠 Memória RAM',
                value: `${getProgressBar(memUsedMB, MAX_RAM_MB)}\n` +
                       `**Usada:** \`${memUsedMB} MB\` / \`${MAX_RAM_MB} MB\`\n` +
                       `**Heap:** \`${formatMB(mem.heapUsed)} MB\` usado de \`${formatMB(mem.heapTotal)} MB\`\n` +
                       `**Externo:** \`${formatMB(mem.external)} MB\`\n` +
                       `**Pico da sessão:** ${peakRamStr}`,
                inline: false
            },
            {
                name: '🔥 CPU',
                value: `${getProgressBar(cpuPct, 100)}\n` +
                       `**Load:** \`${os.loadavg().map(l => l.toFixed(2)).join(' | ')}\` (1m / 5m / 15m)\n` +
                       `**Cores:** \`${os.cpus().length}x\` ${os.cpus()[0].model.split('@')[0].trim()}`,
                inline: false
            },
            {
                name: '📈 Histórico de Latência (WebSocket)',
                value: buildLatencyGraph(pingHistory) + `\n**Pico da sessão:** ${peakPingStr}`,
                inline: false
            },
            {
                name: '🗃️ Cache',
                value: `**Objetos:** \`${cache.size ?? 'N/A'}\`\n` +
                       `**Hit Rate:** \`${cache.hitRate ?? 'N/A'}\`\n` +
                       `**Tamanho:** \`${cache.memoryUsage ?? 'N/A'}\``,
                inline: true
            },
            {
                name: '⚡ Performance',
                value: `**Cmds/Sessão:** \`${report.totalCommands || 0}\`\n` +
                       `**Interações:** \`${report.totalInteractions || 0}\`\n` +
                       `**Erros:** \`${errors || 0}\``,
                inline: true
            },
        )
        .setFooter({ text: `Atualizado automaticamente a cada 60s •` })
        .setTimestamp();
}

function createStatusButtons(restarting = false) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_status').setLabel('Atualizar').setEmoji('🔄').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('status_ping_test').setLabel('Teste de Ping').setEmoji('📶').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('status_cache_clear').setLabel('Limpar Cache').setEmoji('🧹').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('status_toggle_autorefresh').setLabel('Auto-Refresh').setEmoji('⏱️').setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('status_restart_confirm')
                .setLabel(restarting ? 'Confirmar Reinício' : 'Reiniciar Bot')
                .setEmoji(restarting ? '⚠️' : '🔁')
                .setStyle(restarting ? ButtonStyle.Danger : ButtonStyle.Secondary),
        )
    ];
}

async function checkAndSendAlerts(client, logChannelId, adminRoleId) {
    if (!logChannelId) return;

    const mem     = process.memoryUsage();
    const memPct  = (parseFloat(formatMB(mem.rss)) / MAX_RAM_MB) * 100;
    const wsPing  = client.ws.ping;
    const dbLat   = monitor.getMetrics().dbLatency || 0;

    const alertas = [];
    if (wsPing > ALERT_PING_MS)  alertas.push(`🔴 **Ping alto:** \`${wsPing}ms\` (limite: ${ALERT_PING_MS}ms)`);
    if (memPct > ALERT_RAM_PCT)  alertas.push(`🔴 **RAM crítica:** \`${memPct.toFixed(1)}%\` de ${MAX_RAM_MB}MB`);
    if (dbLat > ALERT_DB_MS)     alertas.push(`🔴 **Database lenta:** \`${dbLat}ms\` (limite: ${ALERT_DB_MS}ms)`);

    if (!alertas.length) return;

    const logChannel = client.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('🚨 Alerta de Sistema')
        .setDescription(alertas.join('\n'))
        .setTimestamp();

    await logChannel.send({
        content: adminRoleId ? `<@&${adminRoleId}>` : undefined,
        embeds: [embed]
    }).catch(() => {});
}

async function handleStatusCommand(message, config) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const msg = await message.reply({
        embeds: [createStatusEmbed(message.client)],
        components: createStatusButtons()
    });

    if (config?.channels?.log || config?.roles?.responsavel_admin) {
        await checkAndSendAlerts(message.client, config?.channels?.log, config?.roles?.responsavel_admin);
    }

    return msg;
}

const restartConfirmPending = new Set();

async function handleStatusButtons(interaction, config) {
    if (!interaction.isButton()) return;

    const validIds = [
        'refresh_status', 'status_ping_test', 'status_cache_clear',
        'status_toggle_autorefresh', 'status_restart_confirm'
    ];
    if (!validIds.includes(interaction.customId)) return;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Acesso negado.', flags: [MessageFlags.Ephemeral] });
    }

    const { customId, client, message } = interaction;

    if (customId === 'refresh_status') {
        await interaction.deferUpdate();
        await interaction.editReply({ embeds: [createStatusEmbed(client)], components: createStatusButtons() });
        return;
    }

    if (customId === 'status_ping_test') {
        const start     = Date.now();
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const roundtrip = Date.now() - start;
        const wsPing    = client.ws.ping;
        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📶 Teste de Ping')
            .addFields(
                { name: 'WebSocket',     value: `\`${wsPing}ms\``,     inline: true },
                { name: 'Roundtrip API', value: `\`${roundtrip}ms\``,  inline: true },
                { name: 'Qualidade',     value: wsPing < 100 ? '🟢 Excelente' : wsPing < 200 ? '🟠 Boa' : '🔴 Alta latência', inline: true }
            )
            .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
    }

    if (customId === 'status_cache_clear') {
        await interaction.deferUpdate();
        try {
            globalCache.clear?.();
            await interaction.editReply({ embeds: [createStatusEmbed(client)], components: createStatusButtons() });
            await interaction.followUp({ content: '✅ Cache limpo com sucesso.', flags: [MessageFlags.Ephemeral] });
        } catch {
            await interaction.followUp({ content: '❌ Erro ao limpar o cache.', flags: [MessageFlags.Ephemeral] });
        }
        return;
    }

    if (customId === 'status_toggle_autorefresh') {
        await interaction.deferUpdate();
        const msgId = message.id;

        if (autoRefreshMap.has(msgId)) {
            clearInterval(autoRefreshMap.get(msgId));
            autoRefreshMap.delete(msgId);
            await interaction.followUp({ content: '⏹️ Auto-refresh **desativado**.', flags: [MessageFlags.Ephemeral] });
        } else {
            const interval = setInterval(async () => {
                try {
                    await message.edit({ embeds: [createStatusEmbed(client)], components: createStatusButtons() });
                    if (config?.channels?.log) {
                        await checkAndSendAlerts(client, config.channels.log, config?.roles?.responsavel_admin);
                    }
                } catch {
                    clearInterval(interval);
                    autoRefreshMap.delete(msgId);
                }
            }, AUTO_REFRESH_MS);

            autoRefreshMap.set(msgId, interval);
            await interaction.followUp({ content: `⏱️ Auto-refresh **ativado** — atualiza a cada ${AUTO_REFRESH_MS / 1000}s.`, flags: [MessageFlags.Ephemeral] });
        }
        return;
    }

    if (customId === 'status_restart_confirm') {
        const userId = interaction.user.id;

        if (!restartConfirmPending.has(userId)) {
            restartConfirmPending.add(userId);
            setTimeout(() => restartConfirmPending.delete(userId), 10_000);
            await interaction.deferUpdate();
            await interaction.editReply({ embeds: [createStatusEmbed(client)], components: createStatusButtons(true) });
            await interaction.followUp({
                content: '⚠️ Clique em **Confirmar Reinício** novamente em até 10 segundos para reiniciar o bot.',
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            restartConfirmPending.delete(userId);
            await interaction.reply({ content: '🔁 Reiniciando o bot...', flags: [MessageFlags.Ephemeral] });
            setTimeout(() => process.exit(0), 1500);
        }
    }
}

module.exports = { handleStatusCommand, handleStatusButtons, checkAndSendAlerts };