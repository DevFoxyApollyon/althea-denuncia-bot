const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Config = require('../models/Config');
const { getBrasiliaDate, formatTimeBR, formatDateBR } = require('../utils/dateUtils');

const DEFAULT_CONFIG = {
    maxFileSizeMB: 50,
};

function truncate(str, max = 1024) {
    if (!str) return '*Apenas mídia*';
    return str.length <= max ? str : str.slice(0, 1021) + '...';
}

function buildContentFile(message, author, dateStr) {
    const header = `Mensagem deletada\nAutor: ${author.username} (${author.id})\nData: ${dateStr}\nID da mensagem: ${message.id}\n\n${'─'.repeat(40)}\n\n`;
    const buffer = Buffer.from(header + (message.content || '(sem texto)'), 'utf-8');
    return new AttachmentBuilder(buffer, { name: `mensagem-${message.id}.txt` });
}

async function downloadAttachment(url, attachmentName) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length / 1024 / 1024 > DEFAULT_CONFIG.maxFileSizeMB) return null;

        return new AttachmentBuilder(buffer, { name: attachmentName });
    } catch (error) {
        return null;
    }
}

async function handleDeletedMessage(message) {
    if (message.partial) {
        try { message = await message.fetch(); }
        catch { return; }
    }

    if (!message.guild || message.author?.bot) return;

    const isDenuncia = message.channel.name?.toLowerCase().includes('denúncia');
    if (!isDenuncia) return;

    try {
        const config = await Config.findOne({ guildId: message.guild.id });
        if (!config?.channels?.log) return;

        const logChannel = await message.client.channels.fetch(config.channels.log).catch(() => null);
        if (!logChannel) return;

        // Processamento de Anexos
        const processedAttachments = [];
        const attachmentsToProcess = Array.from(message.attachments.values());

        for (const attachment of attachmentsToProcess) {
            const file = await downloadAttachment(attachment.url, attachment.name);
            if (file) processedAttachments.push(file);
        }

        const now = getBrasiliaDate();
        const timeStr = formatTimeBR(now);
        const dateStr = `${formatDateBR(now)} ${timeStr}`;

        if (processedAttachments.length > 0) {
            const warningEmbed = new EmbedBuilder()
                .setColor('#FFAA00')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setDescription(`⚠️ **Uma mensagem com anexos foi deletada e recuperada pelo sistema.**`)
                .setFooter({ text: `As provas foram preservadas às ${timeStr}` });

            await message.channel.send({
                embeds: [warningEmbed],
                files: processedAttachments
            }).catch(() => console.log("Erro ao reenviar no canal original."));
        }

        const isLong = message.content && message.content.length > 1024;

        const mainEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
            .setTitle('🗑️ Mensagem Deletada em Denúncia')
            .addFields(
                { name: '👤 Autor', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
                { name: '⏰ Data/Hora', value: dateStr, inline: true },
                { name: '📍 Canal Original', value: `<#${message.channel.id}>`, inline: false },
                {
                    name: isLong ? '📝 Conteúdo (truncado — arquivo completo no tópico)' : '📝 Conteúdo',
                    value: truncate(message.content),
                    inline: false
                }
            )
            .setFooter({ text: `ID: ${message.id} • Hoje às ${timeStr}` });

        const logMsg = await logChannel.send({ embeds: [mainEmbed] });

        // --- 3. CRIAR TÓPICO ORGANIZADO NO LOG ---
        const precisaTópico = processedAttachments.length > 0 || isLong;

        if (precisaTópico) {
            try {
                const thread = await logMsg.startThread({
                    name: `📁 Evidências - ${message.author.username}`,
                    autoArchiveDuration: 1440,
                    reason: 'Organização de evidências deletadas'
                });

                if (isLong) {
                    const contentFile = buildContentFile(message, message.author, dateStr);
                    await thread.send({
                        content: '📄 **Conteúdo completo da mensagem:**',
                        files: [contentFile]
                    });
                }

                if (processedAttachments.length > 0) {
                    await thread.send({
                        content: `✅ **Arquivos recuperados da mensagem original:** \`${message.id}\``,
                        files: processedAttachments
                    });
                }

                const extraFields = [];
                if (isLong) extraFields.push({ name: '📄 Texto Completo', value: 'Arquivo `.txt` salvo no tópico abaixo.', inline: true });
                if (processedAttachments.length > 0) extraFields.push({ name: '📦 Mídia Preservada', value: `${processedAttachments.length} arquivo(s) salvos no tópico abaixo.`, inline: true });

                mainEmbed.addFields(...extraFields);
                await logMsg.edit({ embeds: [mainEmbed] });

            } catch (threadError) {
                console.error('Erro ao criar tópico no log de deleção:', threadError);
            }
        }

    } catch (error) {
        console.error('Erro crítico no Log de Deleção:', error);
    }
}

module.exports = { handleDeletedMessage };