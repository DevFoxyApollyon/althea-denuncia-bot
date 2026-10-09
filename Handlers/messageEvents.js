const {
    buscarCanal,
    registrarMensagens,
    registrarEspelho,
    atualizarMensagemEditada,
    marcarMensagemApagada
} = require('../utils/denunciaMensagens');
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
} = require('../utils/strikeWords');
const Denuncia = require('../models/Denuncia');
const Strike = require('../models/Strike');
const { handleYoutubeDenuncia } = require('../utils/youtubeUtils');
const { advancedMonitor } = require('../utils/advancedMonitoring');
const { usuarioAutorizadoNoTopico } = require('../utils/restricaoTopicos');
const { usuarioIsento } = require('../utils/usuariosIsentos');
const { handleRecusarPorMensagem } = require('./handlerStatusButton');
const { handleDeletedMessage } = require('./messageDeleteHandler');
const commands = require('../utils/commands');

function criarPayloadEspelho(message) {
    const dataHora = (message.createdAt || new Date()).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
    });
    return {
        content: [
            `Autor: ${message.author ? `<@${message.author.id}>` : 'Desconhecido'}`,
            `Data/Hora: ${dataHora}`,
            '',
            message.content || '*Apenas mídia*',
        ].join('\n'),
        embeds: (message.embeds || []).slice(0, 10),
        allowedMentions: { parse: [] },
    };
}

async function enviarAnexosEspelho(threadEspelho, message, log) {
    const anexos = Array.from(message.attachments?.values?.() || []);
    const tierBruto = threadEspelho.guild?.premiumTier;
    const tier = typeof tierBruto === 'number'
        ? tierBruto
        : { NONE: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 }[tierBruto] ?? 0;
    const limiteBase = tier >= 3 ? 100 : tier === 2 ? 50 : tier === 1 ? 10 : 10;
    const limiteUploadBytes = Math.max((limiteBase - 1) * 1024 * 1024, 1 * 1024 * 1024);

    for (const attachment of anexos) {
        const nome = attachment.name || `anexo-${attachment.id}`;

        if (attachment.size && attachment.size > limiteUploadBytes) {
            await threadEspelho.send({
                content: `📎 Arquivo de **${(attachment.size / 1024 / 1024).toFixed(1)} MB** excede o limite de **${limiteBase - 1} MB** deste servidor.\n${attachment.url}`,
                allowedMentions: { parse: [] },
            }).catch(error => log.warn(`Não foi possível enviar o link do anexo ${nome}: ${error.message}`));
            continue;
        }

        try {
            await threadEspelho.send({
                content: `📎 Arquivo: ${attachment.url}`,
                files: [{
                    attachment: attachment.url,
                    name: nome,
                }],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            if (/entity too large|payload too large|request entity too large/i.test(error.message)) {
                await threadEspelho.send({
                    content: `📎 Arquivo grande demais para anexar no espelho: **${nome}**\n${attachment.url}`,
                    allowedMentions: { parse: [] },
                }).catch(fallbackError => log.warn(`Não foi possível enviar o link do anexo ${nome}: ${fallbackError.message}`));
                continue;
            }
            log.warn(`Não foi possível espelhar o anexo ${nome}: ${error.message}`);
        }
    }
}

function registerMessageEvents(client, { log, getConfig }) {
    client.on('messageCreate', async message => {
        if (!message.guild) return;

        const config = await getConfig(message.guild.id) ?? {};

        if (message.channel.isThread?.()) {
            const denuncia = await Denuncia.findOne({
                guildId: message.guild.id,
                threadId: message.channel.id,
            }).select('guildId threadId messageId armazemThreadId registroThreadId dataExpiracao').lean();

            if (denuncia) {
                await registrarMensagens(denuncia, message)
                    .catch(error => log.warn('Não foi possível registrar mensagem da denúncia: ' + error.message));

                const mirrorThreadIds = [denuncia.armazemThreadId, denuncia.registroThreadId].filter(Boolean);
                const payload = criarPayloadEspelho(message);

                for (const mirrorThreadId of mirrorThreadIds) {
                    const threadEspelho = await buscarCanal(client, mirrorThreadId);
                    if (!threadEspelho?.isTextBased?.()) {
                        log.warn(`Thread espelho não encontrada: ${mirrorThreadId}`);
                        continue;
                    }
                    const mensagemEspelho = await threadEspelho.send(payload).catch(error => {
                        log.warn(`Não foi possível espelhar mensagem na thread ${mirrorThreadId}: ${error.message}`);
                        return null;
                    });
                    if (mensagemEspelho) {
                        await enviarAnexosEspelho(threadEspelho, message, log);
                        await registrarEspelho(denuncia, message.id, { threadId: mirrorThreadId, messageId: mensagemEspelho.id }).catch(error => log.warn(`Não foi possível salvar vínculo do espelho: ${error.message}`));
                    }
                }
            }
        }

        if (message.author.bot) return;

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
                    await handleRecusarPorMensagem(message, denuncia, config).catch(error => {
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
            advancedMonitor.recordError(error, `command:${commandName}`);
        }
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (!newMessage.guild) return;
        if (newMessage.channel.isThread?.()) {
            const mensagemAtualizada = newMessage.partial
                ? await newMessage.fetch().catch(() => newMessage)
                : newMessage;
            const espelhos = await atualizarMensagemEditada(newMessage.guild.id, newMessage.channel.id, mensagemAtualizada)
                .catch(error => {
                    log.warn('Não foi possível atualizar mensagem da denúncia: ' + error.message);
                    return null;
                });

            if (espelhos) {
                const payload = criarPayloadEspelho(mensagemAtualizada);

                for (const espelho of espelhos) {
                    const threadEspelho = await buscarCanal(client, espelho.threadId);
                    if (!threadEspelho?.isTextBased?.()) continue;
                    const mensagemEspelho = await threadEspelho.messages.fetch(espelho.messageId).catch(() => null);
                    if (!mensagemEspelho) continue;
                    await mensagemEspelho.edit(payload).catch(error =>
                        log.warn(`Não foi possível atualizar mensagem espelho ${espelho.messageId}: ${error.message}`)
                    );
                    await enviarAnexosEspelho(threadEspelho, mensagemAtualizada, log);
                }
            }
        }
        const config = await getConfig(newMessage.guild.id) ?? {};
        await verificaEdicao(oldMessage, newMessage, Strike, config);
    });

    client.on('messageDelete', async message => {
        try {
            if (message.guild && message.channel.isThread?.()) {
                await marcarMensagemApagada(message.guild.id, message.channel.id, message.id).catch(error => log.warn('Não foi possível marcar mensagem apagada da denúncia: ' + error.message));
            }
            await handleDeletedMessage(message);
        } catch (error) {
            log.error('messageDelete: ' + error.message);
        }
    });
}

module.exports = { registerMessageEvents };
