process.env.TZ = 'America/Sao_Paulo';
process.env.FORCE_COLOR = '3';
console.log('\x1b[36m' + '═'.repeat(60) + '\x1b[0m');
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
const commands = require('./utils/commands');
const Config = require('./models/Config');
const Denuncia = require('./models/Denuncia');
const {
    contemPalavraProibida,
    contemMarcacaoAdmin,
    contemLinkProibido,
    contemEmojiFigurinhaOuGif,
    ehMensagemEncaminhada,
    processaStrike,
    processaStrikeLink,
    processaStrikeEmoji,
    verificaEdicao,
    podeFalarSemBloqueio
} = require('./utils/strikeWords');
const Strike = require('./models/Strike');
const { handleYoutubeDenuncia } = require('./utils/youtubeUtils');
const { advancedMonitor } = require('./utils/advancedMonitoring');
const { setupRankJobs } = require('./jobs/rankJobs');
const secondaryConnection = require('./utils/secondaryDb');
const { syncUserOnNicknameChange } = require('./utils/userSyncAndNotify');
const { iniciarAutoFinalizador } = require('./jobs/autoFinalizador');
const { iniciarPoller } = require('./jobs/nicknamePoller');
const { iniciarLimpezaContasDuplicadas } = require('./jobs/Limparcontasduplicadas');
const Usuarios = require('./models/Usuario');
const { limparMenusOrfaos } = require('./utils/feedback');
const { extrairContaDoNickname } = require('./utils/nickUtils');
const { usuarioAutorizadoNoTopico } = require('./utils/restricaoTopicos');
const { usuarioIsento } = require('./utils/usuariosIsentos');
const { handleRecusarPorMensagem } = require('./Handlers/handlerStatusButton');
const { serializarMensagem, buscarCanal } = require('./utils/denunciaMensagens');

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

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        await syncUserOnNicknameChange(oldMember, newMember);

        if (oldMember.nickname === newMember.nickname) return;

        let entry = null;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            await new Promise(r => setTimeout(r, 1000 * (tentativa + 1)));

            const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 5, type: 24 });

            entry = auditLogs.entries.find(e =>
                e.target?.id === newMember.user.id &&
                e.executor?.id === process.env.BOT_ALVO_ID &&
                Date.now() - e.createdTimestamp < 15000
            );

            if (entry) break;
        }

        if (!entry) return;

        const nickAtual     = newMember.nickname || newMember.user.username;
        const contaExtraida = extrairContaDoNickname(nickAtual);

        const setPayload = {
            username:  newMember.user.username,
            nickname:  newMember.nickname,
            updatedAt: new Date(),
        };
        if (contaExtraida) setPayload.conta = contaExtraida;

        await Usuarios.findOneAndUpdate(
            { guildId: newMember.guild.id, userId: newMember.user.id },
            { $set: setPayload },
            { upsert: true, new: true }
        );

        log.success(
            `${chalk.white(newMember.user.username)} ${chalk.gray(`(${newMember.user.id})`)} — nickname registrado: ` +
            `${chalk.red(oldMember.nickname ?? 'nenhum')} ${chalk.gray('→')} ${chalk.green(newMember.nickname ?? 'nenhum')}` +
            (contaExtraida ? chalk.gray(` | conta: ${contaExtraida}`) : '') +
            chalk.gray(` | ${newMember.guild.name}`)
        );

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
        await limparMenusOrfaos(client).catch(err => log.error('limparMenusOrfaos: ' + err.message));
        await iniciarPoller(client);
        console.log(chalk.cyan.bold('═'.repeat(60) + '\n'));
    }, 15_000);

    iniciarAutoFinalizador(client);

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
    if (!message.guild) return;

    if (message.channel.isThread?.()) {
        await Denuncia.updateOne(
            { guildId: message.guild.id, threadId: message.channel.id },
            { $push: { mensagens: serializarMensagem(message) } }
        ).catch(error => log.warn('Não foi possível registrar mensagem da denúncia: ' + error.message));
    }

    if (message.author.bot) return;

    const config = await getConfig(message.guild.id) ?? {};

    if (message.channel.isThread?.() && message.attachments.size > 0 && config.channels?.databaseprovas) {
        const denuncia = await Denuncia.findOne({
            guildId: message.guild.id,
            threadId: message.channel.id,
        }).select('_id messageId');
        const canalProvas = await buscarCanal(client, config.channels.databaseprovas);

        if (denuncia && canalProvas?.isTextBased?.()) {
            const anexos = Array.from(message.attachments.values());
            const copia = await canalProvas.send({
                content: [
                    `🗃️ **Provas arquivadas**`,
                    `Denúncia: \`${denuncia.messageId}\``,
                    `Autor: <@${message.author.id}>`,
                    `Origem: ${message.url}`,
                ].join('\n'),
                files: anexos.map(attachment => ({
                    attachment: attachment.url,
                    name: attachment.name || `prova-${attachment.id}`,
                })),
                allowedMentions: { parse: [] },
            }).catch(error => {
                log.warn('Não foi possível salvar prova no canal databaseprovas: ' + error.message);
                return null;
            });

            if (copia) {
                const anexosSalvos = Array.from(copia.attachments.values()).map(attachment => ({
                    id: attachment.id,
                    nome: attachment.name || '',
                    url: attachment.url || '',
                    tipo: attachment.contentType || '',
                    tamanho: attachment.size ?? null,
                }));
                await Denuncia.updateOne(
                    { _id: denuncia._id, 'mensagens.mensagemId': message.id },
                    { $set: { 'mensagens.$.anexos': anexosSalvos } }
                ).catch(error => log.warn('Não foi possível registrar URLs das provas arquivadas: ' + error.message));
            }
        }
    }

    if (
        message.channel.isThread?.() &&
        ['recusado', 'recusada'].includes(message.content.trim().toLowerCase())
    ) {
        const responsavelAdmin = config.roles?.responsavel_admin;
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const podeRecusar = await usuarioIsento(message.author.id) ||
            Boolean(responsavelAdmin && member?.roles.cache.has(responsavelAdmin));

        if (podeRecusar) {
            const denuncia = await Denuncia.findOne({
                guildId: message.guild.id,
                threadId: message.channel.id,
                status: { $nin: ['aceita', 'recusada'] }
            });

            if (denuncia) {
                await handleRecusarPorMensagem(message, denuncia, config).catch((error) => {
                    log.error('Erro ao recusar denúncia por palavra-chave: ' + error.message);
                });
                await message.delete().catch(() => {});
                return;
            }
        }
    }

    const semBloqueio = await podeFalarSemBloqueio(message, config);

    if (!semBloqueio && message.channel.isThread?.()) {
        const parentId = message.channel.parentId;
        const ehTopicoDenuncia = parentId && (parentId === config?.channels?.pc || parentId === config?.channels?.mobile);

        if (ehTopicoDenuncia) {
            const ehAdministrador = config?.roles?.administrador
                ? message.member?.roles.cache.has(config.roles.administrador)
                : false;
            const ehResponsavelAdmin = config?.roles?.responsavel_admin
                ? message.member?.roles.cache.has(config.roles.responsavel_admin)
                : false;
            const ehStaff = ehAdministrador || ehResponsavelAdmin;

            if (!ehStaff) {
                const autorizado = await usuarioAutorizadoNoTopico(message.channel.id, message.author.id);
                if (!autorizado) {
                    await message.delete().catch(() => {});
                    const aviso = await message.channel.send({
                        content: `<@${message.author.id}> Este tópico é restrito ao denunciante e ao(s) acusado(s). Sua mensagem foi removida.`,
                    }).catch(() => null);
                    if (aviso) setTimeout(() => aviso.delete().catch(() => {}), 5000);
                    return;
                }
            }
        }
    }

        if (!semBloqueio && (contemLinkProibido(message.content) || ehMensagemEncaminhada(message))) {
        await processaStrikeLink(message, Strike, config);
        return;
    }

        if (!semBloqueio && contemEmojiFigurinhaOuGif(message)) {
        await processaStrikeEmoji(message, Strike, config);
        return;
    }

        if (!semBloqueio && (contemPalavraProibida(message.content) || await contemMarcacaoAdmin(message, config))) {
        await processaStrike(message, Strike, config);
        return;
    }

    if (await handleYoutubeDenuncia(message)) return;

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

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    if (newMessage.channel.isThread?.()) {
        await Denuncia.updateOne(
            { guildId: newMessage.guild.id, threadId: newMessage.channel.id, 'mensagens.mensagemId': newMessage.id },
            { $set: {
                'mensagens.$.conteudo': newMessage.content || '',
                'mensagens.$.editadaEm': new Date(),
                'mensagens.$.embeds': (newMessage.embeds || []).map(embed =>
                    typeof embed.toJSON === 'function' ? embed.toJSON() : embed
                )
            } }
        ).catch(error => log.warn('Não foi possível atualizar mensagem da denúncia: ' + error.message));
    }
    const config = await getConfig(newMessage.guild.id) ?? {};
    await verificaEdicao(oldMessage, newMessage, Strike, config);
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

    if (msg.guild) {
        const config = await Config.findOne({ guildId: msg.guild.id });
    }

    try {
        if (msg.guild && msg.channel.isThread?.()) {
            await Denuncia.updateOne(
                { guildId: msg.guild.id, threadId: msg.channel.id, 'mensagens.mensagemId': msg.id },
                { $set: { 'mensagens.$.apagadaEm': new Date() } }
            ).catch(error => log.warn('Não foi possível marcar mensagem apagada da denúncia: ' + error.message));
        }
        await handleDeletedMessage(msg);
    } catch (e) {
        log.error('messageDelete: ' + e.message);
    }
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