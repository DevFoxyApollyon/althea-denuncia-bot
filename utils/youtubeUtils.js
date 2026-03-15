const fetch = require('node-fetch');

/**
 * Extrai o ID do vídeo do YouTube de uma URL.
 * Aceita links dos formatos: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
 */
function extractYouTubeVideoId(url) {
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Busca o título do vídeo do YouTube usando o endpoint oEmbed (não precisa de API key)
 */
async function fetchYouTubeTitle(videoId) {
    try {
        const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const response = await fetch(oEmbedUrl);
        if (!response.ok) return null;
        const data = await response.json();
        return data.title || null;
    } catch (e) {
        return null;
    }
}

/**
 * Encontra todos os links do YouTube em um texto.
 * Retorna um array de links encontrados ou []
 */
function findYouTubeLinks(text) {
    if (!text) return [];
    const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+)/gi;
    return text.match(ytRegex) || [];
}

const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

async function handleDivulgacaoIndevida(message, videoTitle) {
    // Deleta a mensagem
    await message.delete().catch(() => {});
    // Envia aviso no canal
    await message.channel.send({
        content: `🚫 <@${message.author.id}> sua mensagem foi removida: divulgação indevida de conteúdo do YouTube (${videoTitle || 'vídeo'}).`,
        allowedMentions: { users: [message.author.id] }
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));

    // Log de auditoria (embed)
    const config = message.client.config || (message.guild && message.guild.config);
    const logChannelId = config?.channels?.log;
    if (logChannelId) {
        const logChannel = message.guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setColor('#ff3333')
                .setTitle('🚨 Log de Remoção de YouTube')
                .setTimestamp()
                .addFields(
                    { name: 'Usuário', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
                    { name: 'ID do Usuário', value: message.author.id, inline: true },
                    { name: 'Staff', value: `<@${message.client.user.id}> (${message.client.user.tag})`, inline: true },
                    { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Motivo', value: `Divulgação indevida de conteúdo do YouTube (${videoTitle || 'vídeo'})`, inline: false },
                    { name: 'Mensagem', value: message.content || 'Mensagem não disponível', inline: false },
                    { name: 'Data/Hora', value: dateUtils.getBrasiliaDateTime(), inline: true }
                );
            await logChannel.send({ embeds: [embed] }).catch(() => {});
        }
    }
}

async function handleHLDivulgacao(message, videoTitle) {
    // Deleta a mensagem
    await message.delete().catch(() => {});
    // Envia DM para o usuário
    await message.author.send(
        `🚫 Sua mensagem foi removida por divulgação indevida de vídeo do YouTube: ${videoTitle || 'vídeo'}.`
    ).catch(() => {});

    // Log de auditoria (embed)
    const config = message.client.config || (message.guild && message.guild.config);
    const logChannelId = config?.channels?.log;
    if (logChannelId) {
        const logChannel = message.guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setColor('#ff3333')
                .setTitle('🚨 Log de Remoção de YouTube (HL)')
                .setTimestamp()
                .addFields(
                    { name: 'Usuário', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
                    { name: 'ID do Usuário', value: message.author.id, inline: true },
                    { name: 'Staff', value: `<@${message.client.user.id}> (${message.client.user.tag})`, inline: true },
                    { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Motivo', value: `Remoção de vídeo do YouTube com 'hl' no título (${videoTitle || 'vídeo'})`, inline: false },
                    { name: 'Mensagem', value: message.content || 'Mensagem não disponível', inline: false },
                    { name: 'Data/Hora', value: dateUtils.getBrasiliaDateTime(), inline: true }
                );
            await logChannel.send({ embeds: [embed] }).catch(() => {});
        }
    }
}

module.exports = {
    extractYouTubeVideoId,
    fetchYouTubeTitle,
    findYouTubeLinks,
    handleDivulgacaoIndevida,
    handleHLDivulgacao
};
