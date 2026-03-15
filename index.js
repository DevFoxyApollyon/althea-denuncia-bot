process.env.TZ = 'America/Sao_Paulo';
process.env.FORCE_COLOR = '3';

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
require('dotenv').config();

// --- IMPORTAÇÕES DE HANDLERS ---
const interactionHandler = require('./Handlers/interactionHandler');
const { handleDeletedMessage } = require('./Handlers/messageDeleteHandler');
const { 
    handleReactionAdd, 
    handleReactionRemove, 
    handleReactionRemoveAll 
} = require('./Handlers/messageReactionHandler');

// --- CARREGAMENTO DE COMANDOS (Via Utils) ---
const commands = require('./utils/commands');

// --- SERVIÇOS ---
const { advancedMonitor } = require('./utils/advancedMonitoring');
const { setupRankJobs } = require('./jobs/rankJobs');

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
    info: (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[SUCESSO]')} ${msg}`),
    warn: (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[AVISO]')} ${msg}`),
    error: (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[ERRO]')} ${msg}`),
    system: (msg) => console.log(`${chalk.magenta('⚙')} ${chalk.gray('[SISTEMA]')} ${msg}`)
};

// --- INICIALIZAÇÃO DA DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        log.success('Database conectada.');
        client.login(process.env.DISCORD_TOKEN).catch(err => log.error('Login falhou: ' + err.message));
        setupRankJobs(client);
    })
    .catch((err) => {
        log.error('Erro Database: ' + err.message);
        process.exit(1);
    });

// --- EVENTO READY ---
client.once('clientReady', (readyClient) => {
    console.log(chalk.cyan.bold('\n' + '═'.repeat(60)));
    log.system(`BOT ONLINE: ${chalk.white.bold(readyClient.user.tag)}`);
    
    // 1. Informações do Sistema
    log.info(`${chalk.bold('Versão do Bot:')} ${chalk.green(packageJson.version)}`);
    log.info(`${chalk.bold('Node.js:')} ${chalk.green(process.version)}`);
    log.info(`${chalk.bold('Discord.js:')} ${chalk.green(`v${discordVersion}`)}`);
    
    // 2. Informações de Performance
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const uptime = Math.floor(process.uptime() / 60);
    log.info(`${chalk.bold('Memória utilizada:')} ${chalk.green(memoryUsage)} MB`);
    log.info(`${chalk.bold('Uptime:')} ${chalk.green(uptime > 0 ? uptime + 'min' : '< 1min')}`);
    
    // 3. Latência (com validação)
    const ping = readyClient.ws.ping > 0 ? readyClient.ws.ping : 'calculando...';
    log.info(`${chalk.bold('Latência:')} ${chalk.white.bold(ping)}${typeof ping === 'number' ? 'ms' : ''}`);
    
    // 4. Listagem de Comandos Carregados
    const cmdList = Object.keys(commands).join(', ');
    log.info(`${chalk.bold('Comandos carregados:')} ${chalk.green(cmdList)}`);

    // 5. Informações dos Servidores
    let totalMembers = 0;
    readyClient.guilds.cache.forEach(guild => {
        totalMembers += guild.memberCount || 0;
    });
    
    log.info(`${chalk.bold('Servidores ativos (' + readyClient.guilds.cache.size + '):')}`);
    readyClient.guilds.cache.forEach(guild => {
        console.log(`${chalk.gray('  > ')}${chalk.white(guild.name)} ${chalk.gray('ID: ' + guild.id)} ${chalk.gray('| ' + (guild.memberCount || 0) + ' membros')}`);
    });
    
    log.info(`${chalk.bold('Total de membros:')} ${chalk.green(totalMembers)}`);
    
    console.log(chalk.cyan.bold('═'.repeat(60) + '\n'));

    readyClient.user.setPresence({
        activities: [{
            name: "Foxyapollyon na Twitch",
            type: ActivityType.Streaming,
            url: "https://www.twitch.tv/foxyapollyon"
        }],
        status: 'online'
    });
});

// --- EXECUÇÃO DE COMANDOS ---

const { extractYouTubeVideoId, fetchYouTubeTitle, findYouTubeLinks } = require('./utils/youtubeUtils');
const Strike = require('./models/Strike');
const { contemPalavraProibida, contemMarcacaoAdmin, processaStrike } = require('./utils/strikeWords');
const Config = require('./models/Config');

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // --- SISTEMA DE STRIKES AUTOMÁTICO ---
    const config = await Config.findOne({ guildId: message.guild.id });
    if (contemPalavraProibida(message.content) || await contemMarcacaoAdmin(message, config)) {
        await processaStrike(message, Strike, config);
        return;
    }
// Limpeza automática de strikes antigos (opcional, pode ser agendada)
setInterval(async () => {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await Strike.updateMany({}, { $pull: { strikes: { timestamp: { $lt: limite } } } });
}, 60 * 60 * 1000); // a cada 1h

    // --- FILTRO: Deletar mensagem com link do YouTube cujo título contenha 'hl' em tópicos de denúncia ---
    const isDenuncia = message.channel?.name?.toLowerCase().includes('denúncia');
    if (isDenuncia && message.content) {
        const links = findYouTubeLinks(message.content);
        if (links.length > 0) {
            for (const link of links) {
                const videoId = extractYouTubeVideoId(link);
                if (videoId) {
                    const title = await fetchYouTubeTitle(videoId);
                    if (title && title.toLowerCase().includes('hl')) {
                        await message.delete().catch(() => {});
                        return;
                    }
                }
            }
        }
    }

    // --- Comandos normais ---
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const commandFn = commands[commandName];

    if (!commandFn) return;

    try {
        const startTime = Date.now();
        await commandFn(message, args);

        const duration = Date.now() - startTime;
        //log.info(`Exec: !${commandName} | Guild: ${message.guild.name} | ${duration}ms`);
        
        if (advancedMonitor?.recordCommand) {
            advancedMonitor.recordCommand(commandName, duration, true, message.author.id);
        }
    } catch (error) {
        log.error(`Erro no comando !${commandName}: ${error.message}`);
    }
});

// --- INTERAÇÕES (BOTÕES/MODAIS) ---
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
        log.error(`Erro na interação (${interaction.customId}): ${error.message}`);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Erro interno.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
        }
    }
});

// --- OUTROS EVENTOS ---
client.on('messageDelete', async (msg) => {
    try { await handleDeletedMessage(msg); } catch (e) { }
});

client.on('messageReactionAdd', handleReactionAdd);
client.on('messageReactionRemove', handleReactionRemove);
client.on('messageReactionRemoveAll', handleReactionRemoveAll);

// --- GESTÃO DE ERROS ---
client.on('error', err => log.error('Discord API Error: ' + err.message));
process.on('unhandledRejection', (reason) => log.error('Rejeição: ' + reason));
process.on('uncaughtException', (error) => log.error('ERRO CRÍTICO: ' + error.stack));

module.exports = client;