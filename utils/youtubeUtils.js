const fetch = require('node-fetch');
const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');
const config = require('../models/Config');

/**
 * Extrai o ID do vídeo do YouTube de uma URL
 */
function extractYouTubeVideoId(url) {
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Busca título do vídeo no YouTube
 */
async function fetchYouTubeTitle(videoId) {
    try {
        const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const response = await fetch(oEmbedUrl);

        if (!response.ok) return null;

        const data = await response.json();
        return data.title || null;

    } catch (error) {
        console.error("Erro ao buscar título YouTube:", error);
        return null;
    }
}

/**
 * Encontra links do YouTube
 */
function findYouTubeLinks(text) {
    if (!text) return [];

    const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+)/gi;

    return text.match(ytRegex) || [];
}

/**
 * Log no canal
 */
async function sendLog(message, motivo, videoTitle) {

    const logChannelId = config?.channels?.log;
    if (!logChannelId) return;

    try {

        const logChannel = await message.guild.channels.fetch(logChannelId);

        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor('#ff3333')
            .setTitle('🚨 Log de Remoção de YouTube')
            .setAuthor({
                name: `${message.author.tag} (${message.author.id})`,
                iconURL: message.author.displayAvatarURL()
            })
            .setThumbnail(message.author.displayAvatarURL())
            .setDescription(
                `Mensagem removida no canal <#${message.channel.id}> (${message.channel.id})\n` +
                `[Ir para o canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})`
            )
            .addFields(
                { name: 'Usuário', value: `<@${message.author.id}>`, inline: true },
                { name: 'Staff (Bot)', value: `<@${message.client.user.id}>`, inline: true },
                { name: 'Motivo', value: `${motivo} (${videoTitle || 'vídeo'})`, inline: false },
                { name: 'Mensagem Original', value: message.content?.slice(0, 1024) || 'Mensagem não disponível', inline: false },
                { name: 'Data/Hora', value: dateUtils.getBrasiliaDateTime(), inline: true },
                { name: 'Mensagem ID', value: message.id, inline: true },
                { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }
            )
            .setFooter({
                text: `Servidor ID: ${message.guild.id}`
            })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });

    } catch (error) {

        console.error("Erro ao enviar log:", error);

    }
}

/**
 * Divulgação indevida normal
 */
async function handleDivulgacaoIndevida(message, videoTitle) {

    await message.delete().catch(() => {});

    await message.channel.send({
        content: `🚫 <@${message.author.id}> sua mensagem foi removida: divulgação indevida de conteúdo do YouTube (${videoTitle || 'vídeo'}).`,
        allowedMentions: { users: [message.author.id] }
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));

    await sendLog(
        message,
        "Divulgação indevida de conteúdo do YouTube",
        videoTitle
    );
}

/**
 * Vídeo HL
 */
async function handleHLDivulgacao(message, videoTitle) {

    await message.delete().catch(() => {});

    await message.author.send(
        `🚫 Sua mensagem foi removida por divulgação indevida de vídeo do YouTube: ${videoTitle || 'vídeo'}.`
    ).catch(() => {});

    await message.channel.send({
        content: `🚫 <@${message.author.id}> sua mensagem foi removida por divulgação indevida de vídeo do YouTube.`,
        allowedMentions: { users: [message.author.id] }
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));

    await sendLog(
        message,
        "Remoção de vídeo do YouTube com 'hl' no título",
        videoTitle
    );
}

module.exports = {
    extractYouTubeVideoId,
    fetchYouTubeTitle,
    findYouTubeLinks,
    handleDivulgacaoIndevida,
    handleHLDivulgacao
};