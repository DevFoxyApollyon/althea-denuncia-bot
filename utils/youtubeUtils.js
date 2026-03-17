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
    try {
        // Buscar config do banco de dados igual ao handler de deleção
        const Config = require('../models/Config');
        const configDoc = await Config.findOne({ guildId: message.guild.id });
        let logChannelId = null;
        if (configDoc && configDoc.channels && configDoc.channels.log) {
            logChannelId = configDoc.channels.log;
        } else if (configDoc && configDoc.channels && configDoc.channels.logs) {
            logChannelId = configDoc.channels.logs;
        }
        if (!logChannelId) {
            console.error("ID do canal de log de auditoria não encontrado no config.channels.log.");
            return;
        }

        const logChannel = await message.guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            console.error("Canal de log de auditoria não encontrado ou sem permissão.");
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#d7263d')
            .setTitle('🚨 Registro de Remoção de Mensagem do YouTube')
            .setAuthor({
                name: `${message.author.tag} (${message.author.id})`,
                iconURL: message.author.displayAvatarURL()
            })
            .setThumbnail(message.author.displayAvatarURL())
            .setDescription(
                `Uma mensagem foi removida no canal <#${message.channel.id}> (${message.channel.id})\n` +
                `[Acessar canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})\n\n` +
                `**Motivo:** ${motivo} (${videoTitle || 'vídeo'})`
            )
            .addFields(
                { name: 'Usuário', value: `<@${message.author.id}>`, inline: true },
                { name: 'ID do Usuário', value: message.author.id, inline: true },
                { name: 'Staff (Bot)', value: `<@${message.client.user.id}>`, inline: true },
                { name: 'Mensagem Original', value: message.content?.slice(0, 1024) || 'Mensagem não disponível', inline: false },
                { name: 'Data/Hora', value: dateUtils.getBrasiliaDateTime(), inline: true },
                { name: 'Mensagem ID', value: message.id, inline: true },
                { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Servidor', value: `${message.guild.name} (${message.guild.id})`, inline: false }
            )
            .setFooter({
                text: `Log de auditoria • Sistema Althea`,
                iconURL: message.client.user.displayAvatarURL()
            })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Erro ao enviar log de auditoria:", error);
    }
}

/**
 * Divulgação indevida normal
 */
async function handleDivulgacaoIndevida(message, videoTitle) {

    await message.delete().catch(() => {});

    // Enviar mensagem no canal como embed detalhado
    const embed = new EmbedBuilder()
        .setColor('#d7263d')
        .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
        .setDescription(
            `<@${message.author.id}>, sua mensagem foi removida por divulgação indevida de conteúdo do YouTube.`
        )
        .addFields(
            { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
            { name: 'Horário', value: dateUtils.getBrasiliaDateTime(), inline: true },
            { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }
        )
        .setFooter({ text: `Mensagem removida automaticamente • Sistema Althea` })
        .setTimestamp();

    await message.channel.send({
        embeds: [embed],
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

    // Enviar embed no PV detalhado
    const pvEmbed = new EmbedBuilder()
        .setColor('#d7263d')
        .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
        .setDescription(
            `Sua mensagem foi removida por divulgação indevida de vídeo do YouTube.`
        )
        .addFields(
            { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
            { name: 'Horário', value: dateUtils.getBrasiliaDateTime(), inline: true }
        )
        .setFooter({ text: `Mensagem removida automaticamente • Sistema Althea` })
        .setTimestamp();

    await message.author.send({ embeds: [pvEmbed] }).catch(() => {});

    // Enviar embed no canal detalhado
    const canalEmbed = new EmbedBuilder()
        .setColor('#d7263d')
        .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
        .setDescription(`<@${message.author.id}>, sua mensagem foi removida por divulgação indevida de vídeo do YouTube.`)
        .addFields(
            { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
            { name: 'Horário', value: dateUtils.getBrasiliaDateTime(), inline: true },
            { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }
        )
        .setFooter({ text: `Mensagem removida automaticamente • Sistema Althea` })
        .setTimestamp();

    await message.channel.send({
        embeds: [canalEmbed],
        allowedMentions: { users: [message.author.id] }
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));

    await sendLog(
        message,
        "Remoção de vídeo do YouTube",
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