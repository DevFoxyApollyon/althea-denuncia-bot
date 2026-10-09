process.env.TZ = 'America/Sao_Paulo';
process.env.FORCE_COLOR = '3';
console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m');
require('dotenv').config();

const { 
    Client, 
    GatewayIntentBits, 
    ActivityType,
    version: discordVersion
} = require('discord.js');
const mongoose = require('mongoose');
const chalk = require('chalk'); 
const packageJson = require('./package.json');

const commands = require('./utils/commands');
const Config = require('./models/Config');
const Strike = require('./models/Strike');
const { advancedMonitor } = require('./utils/advancedMonitoring');
const { setupRankJobs } = require('./jobs/rankJobs');
const secondaryConnection = require('./utils/secondaryDb');
const { iniciarAutoFinalizador } = require('./jobs/autoFinalizador');
const { iniciarPoller } = require('./jobs/nicknamePoller');
const { iniciarLimpezaContasDuplicadas } = require('./jobs/Limparcontasduplicadas');
const { iniciarAvisoReivindicacao } = require('./jobs/avisoReivindicacao');
const { registerMemberEvents } = require('./Handlers/memberEvents');
const { registerMessageEvents } = require('./Handlers/messageEvents');
const { registerInteractionEvents } = require('./Handlers/interactionEvents');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
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

registerMemberEvents(client, log);
registerMessageEvents(client, { log, getConfig });
registerInteractionEvents(client, log);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        log.success('Database principal conectada.');

        async function limparStrikesAntigas() {
            try {
                const limite = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const resultado = await Strike.updateMany({}, {
                    $pull: {
                        strikes:      { timestamp: { $lt: limite } },
                        strikesLink:  { timestamp: { $lt: limite } },
                        strikesEmoji: { timestamp: { $lt: limite } },
                    }
                });
                if (resultado.modifiedCount > 0) {
                    log.info(`Limpeza de strikes: ${resultado.modifiedCount} documento(s) atualizado(s).`);
                }

                const remocao = await Strike.deleteMany({
                    updatedAt: { $lt: limite },
                });
                if (remocao.deletedCount > 0) {
                    log.info(`Limpeza de strikes: ${remocao.deletedCount} documento(s) sem atividade nas últimas 24h removido(s).`);
                }
            } catch (e) {
                log.error('Erro na limpeza de strikes: ' + e.message);
            }
        }

        limparStrikesAntigas();
        setInterval(limparStrikesAntigas, 60 * 60 * 1000);

        client.login(process.env.DISCORD_TOKEN).catch(err => log.error('Login falhou: ' + err.message));
    })
    .catch((err) => {
        log.error('Erro Database: ' + err.message);
        process.exit(1);
    });

client.once('clientReady', async (readyClient) => {
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
        console.log(chalk.cyan.bold('═'.repeat(60)));
    }, 5000);

    setupRankJobs(client);

    setTimeout(async () => {
        iniciarLimpezaContasDuplicadas();
        await iniciarPoller(client);
        console.log(chalk.cyan.bold('═'.repeat(60) + '\n'));
    }, 15_000);

    iniciarAutoFinalizador(client);
    iniciarAvisoReivindicacao(client);

    readyClient.user.setPresence({
        activities: [{
            name: "Foxyapollyon na Twitch",
            type: ActivityType.Streaming,
            url: "https://www.twitch.tv/foxyapollyon"
        }],
        status: 'online'
    });
});

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