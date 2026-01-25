const { EmbedBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const Config = require('../models/Config');
const { getBrasiliaDate, formatTimeBR, formatDateBR } = require('../utils/dateUtils'); 

const DEFAULT_CONFIG = {
    maxFileSizeMB: 50, 
};

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
    if (!message || message.partial || message.author?.bot || !message.guild) return;

    // Filtro para atuar apenas em canais/tópicos de denúncia
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

        // --- 1. REENVIO NO CANAL ORIGINAL (TÓPICO DA DENÚNCIA) ---
        if (processedAttachments.length > 0) {
            const warningEmbed = new EmbedBuilder()
                .setColor('#FFAA00')
                .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
                .setDescription(`⚠️ **Uma mensagem com anexos foi deletada e recuperada pelo sistema.**`)
                .setFooter({ text: `As provas foram preservadas às ${timeStr}` });

            await message.channel.send({ 
                embeds: [warningEmbed], 
                files: processedAttachments 
            }).catch(() => console.log("Erro ao reenviar no canal original."));
        }

        // --- 2. LOG PARA A STAFF ---
        const mainEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTitle('🗑️ Mensagem Deletada em Denúncia')
            .addFields(
                { name: '👤 Autor', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
                { name: '⏰ Data/Hora', value: `${formatDateBR(now)} ${timeStr}`, inline: true },
                { name: '📍 Canal Original', value: `<#${message.channel.id}>`, inline: false },
                { name: '📝 Conteúdo', value: message.content || '*Apenas mídia*', inline: false }
            )
            .setFooter({ text: `ID: ${message.id} • Hoje às ${timeStr}` });

        const logMsg = await logChannel.send({ embeds: [mainEmbed] });

        // --- 3. CRIAR TÓPICO ORGANIZADO NO LOG ---
        if (processedAttachments.length > 0) {
            const thread = await logMsg.startThread({
                name: `📁 Mídias - ${message.author.username}`,
                autoArchiveDuration: 1440,
                reason: 'Organização de evidências deletadas'
            });

            await thread.send({ 
                content: `✅ **Arquivos recuperados da mensagem original:** \`${message.id}\``,
                files: processedAttachments 
            });

            mainEmbed.addFields({ 
                name: '📦 Mídia Preservada', 
                value: `As ${processedAttachments.length} imagem(s) foram re-enviadas no tópico da denúncia e salvas no log abaixo.`, 
                inline: false 
            });
            
            await logMsg.edit({ embeds: [mainEmbed] });
        }

    } catch (error) {
        console.error('Erro crítico no Log de Deleção:', error);
    }
}

module.exports = { handleDeletedMessage };