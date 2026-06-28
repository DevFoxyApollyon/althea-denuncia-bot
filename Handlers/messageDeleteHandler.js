// messageDeleteHandler.js
const { EmbedBuilder, AttachmentBuilder, AuditLogEvent } = require('discord.js');
const Config = require('../models/Config');
const { getBrasiliaDate, formatTimeBR, formatDateBR } = require('../utils/dateUtils');

const MAX_FILE_SIZE_MB = 50;
const DOWNLOAD_TIMEOUT_MS = 5000;
const THREAD_CACHE = new Map();

function truncate(str, max = 1024) {
    if (!str) return '*Apenas mÃ­dia*';
    return str.length <= max ? str : str.slice(0, 1021) + '...';
}

function buildContentFile(message, author, dateStr) {
    const header = [
        'Mensagem deletada',
        `Autor: ${author.username} (${author.id})`,
        `Data: ${dateStr}`,
        `ID da mensagem: ${message.id}`,
        '',
        'â”€'.repeat(40),
        '',
    ].join('\n');

    const buffer = Buffer.from(header + (message.content || '(sem texto)'), 'utf-8');
    return new AttachmentBuilder(buffer, { name: `mensagem-${message.id}.txt` });
}

async function downloadAttachment(url, attachmentName) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length / 1024 / 1024 > MAX_FILE_SIZE_MB) return null;

        return new AttachmentBuilder(buffer, { name: attachmentName });
    } catch {
        clearTimeout(timeout);
        return null;
    }
}

async function sendWithRetry(sendFn, retries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await sendFn();
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, delayMs * attempt));
        }
    }
}

async function fetchDeletedBy(guild, messageAuthorId) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
        const entry = auditLogs.entries.find(e => e.target?.id === messageAuthorId);
        if (!entry) return null;
        return (Date.now() - entry.createdTimestamp) < 5000 ? entry.executor : null;
    } catch {
        return null;
    }
}

async function processAttachments(attachmentsArray) {
    const results = await Promise.allSettled(
        attachmentsArray.map(a => downloadAttachment(a.url, a.name))
    );

    const processed = [];
    const failed = [];

    results.forEach((result, i) => {
        const original = attachmentsArray[i];
        if (result.status === 'fulfilled' && result.value) {
            processed.push(result.value);
        } else {
            failed.push({ name: original.name, url: original.url });
        }
    });

    return { processed, failed };
}

async function sendToLogWithThread(logChannel, embed, attachments, threadName, authorId, isLong, contentFile) {
    const logMsg = await sendWithRetry(() =>
        logChannel.send({ embeds: [embed] })
    ).catch(err => {
        console.error('[messageDelete] Falha ao enviar no canal log:', err.message);
        return null;
    });

    if (!logMsg) return;

    const precisaTÃ³pico = attachments.length > 0 || isLong;
    if (!precisaTÃ³pico) return;

    try {
        let thread = null;
        const cachedThreadId = THREAD_CACHE.get(authorId);

        if (cachedThreadId) {
            thread = await logChannel.client.channels.fetch(cachedThreadId).catch(() => null);
            if (thread?.archived || thread?.locked) thread = null;
            if (!thread) THREAD_CACHE.delete(authorId);
        }

        if (!thread) {
            thread = await logMsg.startThread({
                name: threadName,
                autoArchiveDuration: 10080,
                reason: 'EvidÃªncias de deleÃ§Ã£o em denÃºncia',
            }).catch(() => null);
            if (!thread) return;
            THREAD_CACHE.set(authorId, thread.id);
        } else {
            await thread.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#2B2D31')
                        .setDescription(`ðŸ”— Nova deleÃ§Ã£o â€” [ver no log](${logMsg.url})`),
                ],
            });
        }

        if (isLong && contentFile) {
            await sendWithRetry(() =>
                thread.send({ content: `ðŸ“„ **ConteÃºdo completo**:`, files: [contentFile] })
            );
        }

        if (attachments.length > 0) {
            await sendWithRetry(() =>
                thread.send({ content: `âœ… **MÃ­dia recuperada**:`, files: attachments })
            );
        }
    } catch (err) {
        console.error('[messageDelete] Erro no tÃ³pico:', err.message);
    }
}

async function handleThreadDeletion(message, { logChannelId, pcChannelId, mobileChannelId }, client) {
    const channel = message.channel;

    if (!channel.isThread()) return false;

    const isLogChild = channel.parentId === logChannelId;
    const isDenunciaChild = channel.parentId === pcChannelId || channel.parentId === mobileChannelId;

    if (!isLogChild && !isDenunciaChild) return false;

    const attachmentsArray = Array.from(message.attachments.values());
    const { processed } = await processAttachments(attachmentsArray);

    const now = getBrasiliaDate();
    const timeStr = formatTimeBR(now);
    const dateStr = `${formatDateBR(now)} ${timeStr}`;

    // Avisa no prÃ³prio tÃ³pico (sÃ³ embed, sem mÃ­dia)
    const warningEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: message.author?.username ?? 'Desconhecido',
            iconURL: message.author?.displayAvatarURL(),
        })
        .setTitle('ðŸš¨ Tentativa de Apagar Prova')
        .setDescription(
            `> â›” **Apagar mensagens neste tÃ³pico Ã© proibido.**\n` +
            `> A mensagem foi recuperada e registrada no canal de log.`
        )
        .addFields(
            { name: 'ðŸ‘¤ Autor',     value: message.author ? `<@${message.author.id}>\n\`${message.author.id}\`` : 'Desconhecido', inline: true },
            { name: 'â° Data/Hora', value: dateStr, inline: true },
            { name: 'ðŸ“ ConteÃºdo',  value: truncate(message.content), inline: false },
        )
        .setFooter({ text: `ID: ${message.id} â€¢ ${timeStr}` })
        .setTimestamp();

    const warningMsg = await sendWithRetry(() =>
        channel.send({ embeds: [warningEmbed] })
    ).catch(() => null);

    if (warningMsg && isDenunciaChild) {
        setTimeout(() => warningMsg.delete().catch(() => null), 5000);
    }

    // Loga no canal de log e cria tÃ³pico com a mÃ­dia lÃ¡
    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (logChannel) {
        const canalOrigem = isDenunciaChild ? channel.parentId : channel.id;

        const logEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({
                name: message.author?.username ?? 'Desconhecido',
                iconURL: message.author?.displayAvatarURL(),
            })
            .setTitle('ðŸš¨ Prova Apagada em TÃ³pico de DenÃºncia')
            .setDescription(
                `Mensagem deletada em <#${channel.id}>\n` +
                `Canal pai: <#${channel.parentId}>`
            )
            .addFields(
                { name: 'ðŸ‘¤ Autor',     value: message.author ? `<@${message.author.id}>\n\`${message.author.id}\`` : 'Desconhecido', inline: true },
                { name: 'â° Data/Hora', value: dateStr, inline: true },
                { name: 'ðŸ“Ž Anexos',    value: attachmentsArray.length > 0 ? `${attachmentsArray.length} arquivo(s) â€” ver tÃ³pico` : 'Nenhum', inline: true },
                { name: 'ðŸ“ ConteÃºdo',  value: truncate(message.content), inline: false },
            )
            .setFooter({ text: `ID da mensagem: ${message.id} â€¢ ${timeStr}` })
            .setTimestamp();

        const isLong = (message.content?.length ?? 0) > 1024;
        const contentFile = isLong ? buildContentFile(message, message.author ?? { username: 'desconhecido', id: '0' }, dateStr) : null;
        const threadName = `ðŸš¨ ${message.author?.username ?? 'desconhecido'} â€¢ canal ${canalOrigem}`;

        await sendToLogWithThread(logChannel, logEmbed, processed, threadName, message.author?.id ?? '0', isLong, contentFile);
    }

    return true;
}

async function handleDeletedMessage(message) {
    if (!message.guild) return;

    if (message.partial) {
        try {
            message = await message.fetch();
        } catch {
            await notifyUncacheable(message);
            return;
        }
    }

    if (!message.author) return;
    if (message.author.bot) return;

    const config = await Config.findOne({ guildId: message.guild.id }).catch(() => null);
    if (!config) return;

    const { pc: pcChannelId, mobile: mobileChannelId, log: logChannelId } = config.channels ?? {};

    if (!logChannelId) return;

    const isThreadDeletion = await handleThreadDeletion(
        message,
        { logChannelId, pcChannelId, mobileChannelId },
        message.client
    );
    if (isThreadDeletion) return;

    const isDenunciaChannel =
        message.channel.id === pcChannelId ||
        message.channel.id === mobileChannelId;

    if (!isDenunciaChannel) return;

    const logChannel = await message.client.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel) return;

    const attachmentsArray = Array.from(message.attachments.values());
    const { processed: processedAttachments, failed: failedAttachmentUrls } = await processAttachments(attachmentsArray);

    const deletedBy = await fetchDeletedBy(message.guild, message.author.id);
    const isSelfDelete = !deletedBy || deletedBy.id === message.author.id;

    const now = getBrasiliaDate();
    const timeStr = formatTimeBR(now);
    const dateStr = `${formatDateBR(now)} ${timeStr}`;

    const isLong = (message.content?.length ?? 0) > 1024;
    const mentions = [...message.mentions.users.values()];
    const canalTipo = message.channel.id === pcChannelId ? 'ðŸ’» PC' : 'ðŸ“± Mobile';
    const embedColor = isSelfDelete ? '#FF0000' : '#FF6600';

    const mainEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${message.author.username} â€¢ ${canalTipo}`,
            iconURL: message.author.displayAvatarURL(),
        })
        .setTitle('ðŸ—‘ï¸ Mensagem Deletada em DenÃºncia')
        .setDescription(`Canal: <#${message.channel.id}> â€¢ \`${message.channel.id}\``)
        .addFields(
            { name: 'ðŸ‘¤ Autor',        value: `<@${message.author.id}>\n\`${message.author.id}\``, inline: true },
            { name: 'ðŸ—‘ï¸ Deletada por', value: isSelfDelete ? '**PrÃ³prio autor**' : `<@${deletedBy.id}>\n\`${deletedBy.id}\``, inline: true },
            { name: 'â° Data/Hora',    value: dateStr, inline: true },
            { name: 'ðŸ’¬ MenÃ§Ãµes',      value: mentions.length > 0 ? mentions.map(u => `<@${u.id}>`).join(', ') : 'Nenhuma', inline: true },
            { name: 'ðŸ“Ž Anexos',       value: attachmentsArray.length > 0 ? `${attachmentsArray.length} arquivo(s)${processedAttachments.length > 0 ? ' â€” ver tÃ³pico' : ''}` : 'Nenhum', inline: true },
            { name: 'â†©ï¸ Resposta a',   value: message.reference?.messageId ? `\`${message.reference.messageId}\`` : 'NÃ£o era resposta', inline: true },
            {
                name: isLong ? 'ðŸ“ ConteÃºdo (truncado â€” completo no tÃ³pico)' : 'ðŸ“ ConteÃºdo',
                value: truncate(message.content),
                inline: false,
            },
        )
        .setFooter({ text: `ID: ${message.id} â€¢ ${timeStr}` })
        .setTimestamp();

    if (failedAttachmentUrls.length > 0) {
        mainEmbed.addFields({
            name: 'âš ï¸ Anexos nÃ£o recuperados',
            value: failedAttachmentUrls.map(a => `â€¢ [${a.name}](${a.url})`).join('\n').slice(0, 1024),
            inline: false,
        });
    }

    const threadName = `ðŸ“ ${message.author.username} â€¢ canal ${message.channel.id}`;
    const contentFile = isLong ? buildContentFile(message, message.author, dateStr) : null;

    await sendToLogWithThread(logChannel, mainEmbed, processedAttachments, threadName, message.author.id, isLong, contentFile);
}

async function notifyUncacheable(partialMessage) {
    try {
        if (!partialMessage.guild) return;

        const config = await Config.findOne({ guildId: partialMessage.guild.id }).catch(() => null);
        if (!config?.channels?.log) return;

        const { pc: pcChannelId, mobile: mobileChannelId } = config.channels ?? {};
        const channelId = partialMessage.channelId ?? partialMessage.channel?.id;

        if (channelId !== pcChannelId && channelId !== mobileChannelId) return;

        const logChannel = await partialMessage.client.channels.fetch(config.channels.log).catch(() => null);
        if (!logChannel) return;

        const now = getBrasiliaDate();
        const timeStr = formatTimeBR(now);

        const embed = new EmbedBuilder()
            .setColor('#555555')
            .setTitle('ðŸ—‘ï¸ DeleÃ§Ã£o NÃ£o RecuperÃ¡vel')
            .setDescription(
                `Mensagem deletada em <#${channelId}> fora do cache.\n` +
                `*(enviada antes do Ãºltimo restart â€” conteÃºdo indisponÃ­vel)*`
            )
            .addFields(
                { name: 'ðŸ†” ID da mensagem', value: `\`${partialMessage.id}\``, inline: true },
                { name: 'ðŸ“ Canal',           value: channelId ? `<#${channelId}>` : 'N/A', inline: true },
            )
            .setFooter({ text: `Detectado Ã s ${timeStr}` })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[messageDelete] Erro ao notificar nÃ£o-cacheada:', err.message);
    }
}

module.exports = { handleDeletedMessage };