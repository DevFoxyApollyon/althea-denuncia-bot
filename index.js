process.env.TZ = 'America/Sao_Paulo';
process.env.FORCE_COLOR = '3';
console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m');
require('dotenv').config();

const { log } = require('./utils/logger');
const { validarEnv } = require('./utils/env');

// Precisa rodar antes dos demais requires: os models abrem conexões ao carregar.
if (!validarEnv(log)) process.exit(1);

const { 
    Client, 
    GatewayIntentBits, 
    ActivityType,
    version: discordVersion
} = require('discord.js');
const chalk = require('chalk'); 
const packageJson = require('./package.json');

const commands = require('./utils/commands');
const { getConfig } = require('./utils/configCache');
const { registrarComandosSlash, registrarComandosNoServidor } = require('./commands/slash');
const { advancedMonitor } = require('./utils/advancedMonitoring');
const { setupRankJobs } = require('./jobs/rankJobs');
const { primaryConnection, secondaryConnection } = require('./utils/persistencia');
const { adicionarMeses, prepararRetencaoNoBanco } = require('./utils/retencaoDados');
const Config = require('./models/Config');
const { iniciarAutoFinalizador } = require('./jobs/autoFinalizador');
const { iniciarPoller } = require('./jobs/nicknamePoller');
const { iniciarLimpezaContasDuplicadas } = require('./jobs/Limparcontasduplicadas');
const { iniciarAvisoReivindicacao } = require('./jobs/avisoReivindicacao');
const { registerMemberEvents } = require('./Handlers/memberEvents');
const { registerMessageEvents } = require('./Handlers/messageEvents');
const { registerInteractionEvents } = require('./Handlers/interactionEvents');
const { iniciarSite } = require('./site/servidor');

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

let servidorDoSite = null;

registerMemberEvents(client, log);
registerMessageEvents(client, { log, getConfig });
registerInteractionEvents(client, log);

Promise.all([primaryConnection.asPromise(), secondaryConnection.asPromise()])
    .then(async () => {
        await prepararRetencaoNoBanco(secondaryConnection.db);
        await Config.updateMany(
            { dataRetencaoAte: { $exists: false } },
            { $set: { dataRetencaoAte: adicionarMeses(new Date()) } }
        );
        await Config.createIndexes();
        log.success('Bancos principal e secundário conectados; retenção de seis meses configurada.');
        client.login(process.env.DISCORD_TOKEN).catch(err => log.error('Login falhou: ' + err.message));
    })
    .catch((err) => {
        log.error('Erro Database: ' + err.message);
        process.exit(1);
    });

client.once('ready', async (readyClient) => {
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

    const cmdList = Object.keys(commands).map(nome => '!' + nome).join(', ');
    log.info(`${chalk.bold('Comandos carregados:')} ${chalk.green(cmdList)}`);

    await registrarComandosSlash(readyClient, log);

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
    servidorDoSite = iniciarSite(client, log);

    readyClient.user.setPresence({
        activities: [{
            name: "Foxyapollyon na Twitch",
            type: ActivityType.Streaming,
            url: "https://www.twitch.tv/foxyapollyon"
        }],
        status: 'online'
    });
});

client.on('guildCreate', guild => {
    registrarComandosNoServidor(guild)
        .catch(err => log.warn(`Não foi possível registrar os comandos de barra em ${guild.name}: ${err.message}`));
});

client.on('error', err => log.error('Discord API Error: ' + err.message));

process.on('unhandledRejection', (reason) => {
    log.error('Rejeição não tratada: ' + (reason?.stack || reason));
    advancedMonitor.recordError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

// Depois de uma exceção não capturada o estado do processo não é confiável:
// encerra com código de erro e deixa a hospedagem reiniciar o bot limpo.
process.on('uncaughtException', (error) => {
    log.error('ERRO CRÍTICO (encerrando para reiniciar): ' + (error?.stack || error));
    gracefulShutdown('uncaughtException', 1);
});

let encerrando = false;

async function gracefulShutdown(signal, exitCode = 0) {
    if (encerrando) return;
    encerrando = true;

    // Se alguma conexão travar ao fechar, não deixa o processo pendurado.
    setTimeout(() => process.exit(exitCode), 10_000).unref();

    log.warn(`Sinal ${signal} recebido. Encerrando bot com segurança...`);
    try {
        servidorDoSite?.close();
        advancedMonitor.destroy();
        client.destroy();
        if (secondaryConnection.readyState === 1) {
            await secondaryConnection.close();
        }
        if (primaryConnection.readyState === 1) {
            await primaryConnection.close();
        }
        log.success('Bot encerrado com sucesso.');
    } catch (e) {
        log.error('Erro ao encerrar: ' + e.message);
    } finally {
        process.exit(exitCode);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = client;