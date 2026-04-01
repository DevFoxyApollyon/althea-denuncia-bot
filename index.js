process.env.TZ = 'America/Sao_Paulo';
process.env.FORCE_COLOR = '3';
require('dotenv').config();

const { 
    Client, 
    GatewayIntentBits, 
    MessageFlags, 
    ActivityType,
    Collection,
    version: discordVersion
} = require('discord.js');
const mongoose = require('mongoose');
const chalk = require('chalk'); 
const packageJson = require('./package.json');

const interactionHandler = require('./Handlers/interactionHandler');
const { handleDeletedMessage } = require('./Handlers/messageDeleteHandler');
const { handleReactionAdd, handleReactionRemove, handleReactionRemoveAll } = require('./Handlers/messageReactionHandler');
const commands = require('./utils/commands');
const Config = require('./models/Config');
const { contemPalavraProibida, contemMarcacaoAdmin, processaStrike } = require('./utils/strikeWords');
const Strike = require('./models/Strike');
const { extractYouTubeVideoId, fetchYouTubeTitle, findYouTubeLinks, handleHLDivulgacao } = require('./utils/youtubeUtils');
const { advancedMonitor } = require('./utils/advancedMonitoring');
const { setupRankJobs } = require('./jobs/rankJobs');
const secondaryConnection = require('./utils/secondaryDb');
const { syncUserOnNicknameChange } = require('./utils/userSyncAndNotify');
const { iniciarAutoFinalizador } = require('./jobs/autoFinalizador');
const { iniciarPoller } = require('./jobs/nicknamePoller');
const Usuarios = require('./models/Usuario');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    sweepers: {
        messages: { interval: 3600, lifetime: 1800 } 
    }
});

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[SUCESSO]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[AVISO]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[ERRO]')} ${msg}`),
    system:  (msg) => console.log(`${chalk.magenta('⚙')} ${chalk.gray('[SISTEMA]')} ${msg}`)
};

const configCache = new Map();
const CONFIG_CACHE_LIMIT = 100;

async function getConfig(guildId) {
    if (configCache.has(guildId)) return configCache.get(guildId);

    const config = await Config.findOne({ guildId });

    if (configCache.size >= CONFIG_CACHE_LIMIT) {
        const firstKey = configCache.keys().next().value;
        configCache.delete(firstKey);
    }

    configCache.set(guildId, config);
    setTimeout(() => configCache.delete(guildId), 5 * 60 * 1000); 
    return config;
}

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        await syncUserOnNicknameChange(oldMember, newMember);

        if (oldMember.nickname !== newMember.nickname) {
            const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: 24 });
            const entry = auditLogs.entries.first();

            if (!entry) return;
            if (Date.now() - entry.createdTimestamp > 3000) return;
            if (entry.executor?.id !== process.env.BOT_ALVO_ID) return;

            await Usuarios.findOneAndUpdate(
                {
                    guildId: newMember.guild.id,
                    userId:  newMember.user.id,
                },
                {
                    $set: {
                        username:  newMember.user.username,
                        nickname:  newMember.nickname,
                        updatedAt: new Date(),
                    },
                },
                { upsert: true, new: true }
            );

            log.success(
                `${chalk.white(newMember.user.username)} ${chalk.gray(`(${newMember.user.id})`)} — nickname registrado em tempo real: ` +
                `${chalk.red(oldMember.nickname ?? 'nenhum')} ${chalk.gray('→')} ${chalk.green(newMember.nickname ?? 'nenhum')} ${chalk.gray(`| ${newMember.guild.name}`)}`
            );
        }
    } catch (e) {
        if (e.code === 50278) return; 
        log.warn('Erro ao sincronizar nickname: ' + e.message);
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        const usuario = await Usuarios.findOne({
            guildId: member.guild.id,
            userId:  member.user.id,
        });

        if (!usuario?.nickname) return;

        await member.setNickname(usuario.nickname, 'Nickname restaurado automaticamente');

        log.success(
            `${chalk.white(member.user.username)} ${chalk.gray(`(${member.user.id})`)} — nickname restaurado: ${chalk.green(usuario.nickname)} ${chalk.gray(`| ${member.guild.name}`)}`
        );
    } catch (e) {
        if (e.code === 50013) {
            log.warn(`Sem permissão para restaurar nickname de ${member.user.username} em ${member.guild.name}`);
            return;
        }
        log.error(`Erro ao restaurar nickname: ${e.message}`);
    }
});

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        log.success('Database principal conectada.');

        if (secondaryConnection.readyState === 1) {
            log.success('Database secundária já conectada.');
        }

        setInterval(async () => {
            try {
                const limite = new Date(Date.now() - 24 * 60 * 60 * 1000);
                await Strike.updateMany({}, { $pull: { strikes: { timestamp: { $lt: limite } } } });
            } catch (e) {
                log.error('Erro na limpeza de strikes: ' + e.message);
            }
        }, 60 * 60 * 1000);

        client.login(process.env.DISCORD_TOKEN).catch(err => log.error('Login falhou: ' + err.message));
    })
    .catch((err) => {
        log.error('Erro Database: ' + err.message);
        process.exit(1);
    });

client.once('clientReady', (readyClient) => {
    console.log(chalk.cyan.bold('\n' + '═'.repeat(60)));
    log.system(`BOT ONLINE: ${chalk.white.bold(readyClient.user.username)}`);

    log.info(`${chalk.bold('Versão do Bot:')} ${chalk.green(packageJson.version)}`);
    log.info(`${chalk.bold('Node.js:')} ${chalk.green(process.version)}`);
    log.info(`${chalk.bold('Discord.js:')} ${chalk.green(`v${discordVersion}`)}`);

    const env = process.env.NODE_ENV ?? 'development';
    log.info(`${chalk.bold('Ambiente:')} ${chalk.green(env)}`);
    if (env !== 'production') log.warn('Bot rodando em modo DESENVOLVIMENTO.');

    log.info(`${chalk.bold('Iniciado em:')} ${chalk.green(new Date().toLocaleString('pt-BR'))}`);

    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const uptime = Math.floor(process.uptime() / 60);
    log.info(`${chalk.bold('Memória utilizada:')} ${chalk.green(memoryUsage)} MB`);
    log.info(`${chalk.bold('Uptime:')} ${chalk.green(uptime > 0 ? uptime + 'min' : '< 1min')}`);

    const cmdList = Object.keys(commands).join(', ');
    log.info(`${chalk.bold('Comandos carregados:')} ${chalk.green(cmdList)}`);

    let totalMembers = 0;
    readyClient.guilds.cache.forEach(guild => {
        totalMembers += guild.memberCount || 0;
    });

    log.info(`${chalk.bold('Servidores ativos (' + readyClient.guilds.cache.size + '):')}`);
    readyClient.guilds.cache.forEach(guild => {
        console.log(`${chalk.gray('  > ')}${chalk.white(guild.name)} ${chalk.gray('ID: ' + guild.id)} ${chalk.gray('| ' + (guild.memberCount || 0) + ' membros')}`);
    });

    log.info(`${chalk.bold('Total de membros:')} ${chalk.green(totalMembers)}`);

    setTimeout(() => {
        const ping = readyClient.ws.ping;
        log.info(`${chalk.bold('Latência WebSocket:')} ${chalk.white.bold(ping)}ms`);
        console.log(chalk.cyan.bold('═'.repeat(60) + '\n'));
    }, 5000);

    setupRankJobs(client);
    iniciarAutoFinalizador(client);
    iniciarPoller(client);

    readyClient.user.setPresence({
        activities: [{
            name: "Foxyapollyon na Twitch",
            type: ActivityType.Streaming,
            url: "https://www.twitch.tv/foxyapollyon"
        }],
        status: 'online'
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const config = await getConfig(message.guild.id) ?? {};
    if (contemPalavraProibida(message.content) || await contemMarcacaoAdmin(message, config)) {
        await processaStrike(message, Strike, config);
        return;
    }

    const isDenuncia = message.channel?.name?.toLowerCase().includes('denúncia');
    if (isDenuncia && message.content) {
        const ytRegex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+/gi;
        const links = message.content.match(ytRegex) || [];
        if (links.length > 0) {
            for (const link of links) {
                const videoId = extractYouTubeVideoId(link);
                let title = null;
                if (videoId) {
                    title = await fetchYouTubeTitle(videoId);
                }
                if ((title && title.toLowerCase().includes('hl')) || !title) {
                    await handleHLDivulgacao(message, title || 'Link inválido ou indevido');
                    return;
                }
            }
        }
    }

    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const commandFn = commands[commandName];

    if (!commandFn) return;

    try {
        const startTime = Date.now();
        await commandFn(message, args);

        const duration = Date.now() - startTime;
        if (advancedMonitor?.recordCommand) {
            advancedMonitor.recordCommand(commandName, duration, true, message.author.id);
        }
    } catch (error) {
        log.error(`Erro no comando !${commandName}: ${error.message}`);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        const startTime = Date.now();
        await interactionHandler(interaction);

        if (advancedMonitor?.recordInteraction) {
            const duration = Date.now() - startTime;
            const type = interaction.isButton() ? 'BUTTON' : interaction.isModalSubmit() ? 'MODAL' : 'SELECT';
            advancedMonitor.recordInteraction(type, duration, true);
        }
    } catch (error) {
        if (error.code === 50278) return;
        if (error.code === 10062) return; 

        log.error(`Erro na interação (${interaction?.customId ?? 'desconhecido'}): ${error.message}`);

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Erro interno.', flags: [MessageFlags.Ephemeral] });
            }
        } catch (_) {}
    }
});

client.on('messageDelete', async (msg) => {
    try { await handleDeletedMessage(msg); } catch (e) { log.error('messageDelete: ' + e.message); }
});

client.on('messageReactionAdd', handleReactionAdd);
client.on('messageReactionRemove', handleReactionRemove);
client.on('messageReactionRemoveAll', handleReactionRemoveAll);

client.on('error', err => log.error('Discord API Error: ' + err.message));

process.on('unhandledRejection', (reason) => {
    log.error('Rejeição não tratada: ' + (reason?.stack || reason));
});

process.on('uncaughtException', (error) => {
    log.error('ERRO CRÍTICO: ' + error.stack);
});

async function gracefulShutdown(signal) {
    log.warn(`Sinal ${signal} recebido. Encerrando bot com segurança...`);
    try {
        advancedMonitor.destroy();
        client.destroy();
        await mongoose.connection.close();
        if (secondaryConnection.readyState === 1) {
            await secondaryConnection.close();
        }
        log.success('Bot encerrado com sucesso.');
    } catch (e) {
        log.error('Erro ao encerrar: ' + e.message);
    } finally {
        process.exit(0);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = client;