const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    version: djsVersion,
    WebhookClient 
} = require('discord.js');
const os = require('os');
const { monitor } = require('../utils/monitoring');
const { advancedMonitor } = require('../utils/advancedMonitoring');
const { globalCache } = require('../utils/smartCache');

// --- AUXILIARES ---
const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const getProgressBar = (current, max) => {
    const size = 12;
    const progress = Math.min(Math.round((current / max) * size), size);
    return `\`${'■'.repeat(progress)}${'□'.repeat(size - progress)}\` ${Math.round((current / max) * 100)}%`;
};

/**
 * Gera a Embed com layout estilo Dashboard
 */
function createStatusEmbed(client) {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const cpuLoad = os.loadavg()[0].toFixed(2);
    const dbLatency = monitor.getMetrics().dbLatency || 0;

    // Definição de cor dinâmica baseada na saúde do sistema
    let statusColor = '#2f3136'; // Cor padrão escura
    if (dbLatency > 300 || client.ws.ping > 200) statusColor = '#f1c40f'; // Alerta
    if (mem.rss / 1024 / 1024 > 3500) statusColor = '#e74c3c'; // Crítico

    const embed = new EmbedBuilder()
        .setAuthor({ 
            name: `Painel Administrativo • ${client.user.username}`, 
            iconURL: client.user.displayAvatarURL({ dynamic: true }) 
        })
        .setColor(statusColor)
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(`### 🛰️ Diagnóstico de Rede e API\n` +
            `**Latência WebSocket:** \`${client.ws.ping}ms\`\n` +
            `**Latência Database:** \`${dbLatency}ms\`\n` +
            `**Conexões Ativas:** \`${client.guilds.cache.size} Servidores\``)
        .addFields(
            { 
                name: '💻 Infraestrutura do Host', 
                value: `**Sistema:** \`${os.type()} ${os.arch()}\`\n` +
                       `**Processador:** \`${os.cpus()[0].model.split(' ')[0]}\`\n` +
                       `**Load Average:** \`${cpuLoad}%\``, 
                inline: true 
            },
            { 
                name: '🔋 Disponibilidade', 
                value: `**Uptime Bot:** \`${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\`\n` +
                       `**Node.js:** \`${process.version}\`\n` +
                       `**D.js:** \`v${djsVersion}\``, 
                inline: true 
            },
            { 
                name: '🧠 Gerenciamento de Memória', 
                value: `**Uso de RAM (RSS):**\n${getProgressBar(formatMB(mem.rss), 4096)}\n` +
                       `**Heap Utilizado:** \`${formatMB(mem.heapUsed)} MB\``, 
                inline: false 
            },
            { 
                name: '📦 Cache & Performance', 
                value: `**Objetos em Cache:** \`${globalCache.getStats().size}\`\n` +
                       `**Comandos/Hora:** \`${advancedMonitor.generateDetailedReport().totalCommands || 0}\``, 
                inline: true 
            },
            { 
                name: '🛡️ Integridade', 
                value: `**Erros (Sessão):** \`${monitor.generateReport().summary.errors}\`\n` +
                       `**Status:** \`OPERACIONAL\``, 
                inline: true 
            }
        )
        .setFooter({ text: `Última varredura às` })
        .setTimestamp();

    return embed;
}

async function handleStatusCommand(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('refresh_status')
            .setLabel('Atualizar Dashboard')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary)
    );

    await message.reply({ embeds: [createStatusEmbed(message.client)], components: [row] });
}

async function handleStatusButtons(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'refresh_status') return;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Acesso negado.', ephemeral: true });
    }

    // Feedback visual imediato
    await interaction.deferUpdate();
    
    // Atualiza a embed com novos dados
    await interaction.editReply({ 
        embeds: [createStatusEmbed(interaction.client)] 
    });
}

module.exports = { handleStatusCommand, handleStatusButtons };