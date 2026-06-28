const fetch = require('node-fetch');
const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

const GIFS_YOUTUBE = {
  divulgacao: 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYzF2b3lld3FiM2h2dTBmYnk0NXlqYmZmcHZwNHhpY3BiNHE3YTAzZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GpyS1lJXJYupG/giphy.gif',
  hl: 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYzF2b3lld3FiM2h2dTBmYnk0NXlqYmZmcHZwNHhpY3BiNHE3YTAzZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GpyS1lJXJYupG/giphy.gif',
};

const TEMPO_AVISO_CANAL = 10_000;

function extractYouTubeVideoId(url) {
  const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

async function fetchYouTubeTitle(videoId) {
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oEmbedUrl);
    if (!response.ok) return null;
    const data = await response.json();
    return data.title || null;
  } catch (error) {
    console.error('Erro ao buscar título do YouTube:', error);
    return null;
  }
}

function findYouTubeLinks(text) {
  if (!text) return [];
  const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+)/gi;
  const links = text.match(ytRegex) || [];
  return links.filter(link => !link.includes('youtube.com/clip/'));
}

async function sendLog(message, motivo, videoTitle) {
  try {
    const Config = require('../models/Config');
    const configDoc = await Config.findOne({ guildId: message.guild.id });

    const logChannelId = configDoc?.channels?.log || configDoc?.channels?.logs || null;

    if (!logChannelId) {
      console.error('Canal de log não encontrado em config.channels.log / config.channels.logs');
      return;
    }

    const logChannel = await message.guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel) {
      console.error('Canal de log não encontrado ou sem permissão de acesso.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#d7263d')
      .setTitle('🚨 Registro de Remoção de Mensagem do YouTube')
      .setAuthor({
        name: `${message.author.tag} (${message.author.id})`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setThumbnail(message.author.displayAvatarURL())
      .setDescription(
        `Mensagem removida no canal <#${message.channel.id}>\n` +
        `[Acessar canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})\n\n` +
        `**Motivo:** ${motivo}${videoTitle ? ` — *${videoTitle}*` : ''}`
      )
      .addFields(
        { name: 'Usuário',           value: `<@${message.author.id}>`,                        inline: true  },
        { name: 'ID do Usuário',     value: message.author.id,                                inline: true  },
        { name: 'Staff (Bot)',        value: `<@${message.client.user.id}>`,                   inline: true  },
        { name: 'Mensagem Original', value: message.content?.slice(0, 1024) || 'N/A',         inline: false },
        { name: 'Data/Hora',         value: dateUtils.getBrasiliaDateTime(),                   inline: true  },
        { name: 'ID da Mensagem',    value: message.id,                                       inline: true  },
        { name: 'Canal',             value: `<#${message.channel.id}>`,                       inline: true  },
        { name: 'Servidor',          value: `${message.guild.name} (${message.guild.id})`,    inline: false },
      )
      .setFooter({
        text: 'Log de auditoria • Sistema Althea',
        iconURL: message.client.user.displayAvatarURL(),
      })
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Erro ao enviar log de auditoria:', error);
  }
}

async function handleDivulgacaoIndevida(message, videoTitle) {
  await message.delete().catch(() => {});

  const embedCanal = new EmbedBuilder()
    .setColor('#d7263d')
    .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
    .setDescription(
      `<@${message.author.id}>, sua mensagem foi removida por divulgação indevida de conteúdo do YouTube.`
    )
    .setImage(GIFS_YOUTUBE.divulgacao)
    .addFields(
      { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
      { name: 'Horário',         value: dateUtils.getBrasiliaDateTime(),   inline: true  },
      { name: 'Canal',           value: `<#${message.channel.id}>`,        inline: true  },
    )
    .setFooter({ text: 'Mensagem removida automaticamente • Sistema Althea' })
    .setTimestamp();

  await message.channel.send({
    embeds: [embedCanal],
    allowedMentions: { users: [message.author.id] },
  }).then(msg => setTimeout(() => msg.delete().catch(() => {}), TEMPO_AVISO_CANAL))
    .catch(() => {});

  await sendLog(message, 'Divulgação indevida de conteúdo do YouTube', videoTitle);
}

async function handleHLDivulgacao(message, videoTitle) {
  await message.delete().catch(() => {});

  const embedCanal = new EmbedBuilder()
    .setColor('#d7263d')
    .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
    .setDescription(
      `<@${message.author.id}>, sua mensagem foi removida por divulgação indevida de vídeo do YouTube.`
    )
    .setImage(GIFS_YOUTUBE.hl)
    .addFields(
      { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
      { name: 'Horário',         value: dateUtils.getBrasiliaDateTime(),   inline: true  },
      { name: 'Canal',           value: `<#${message.channel.id}>`,        inline: true  },
    )
    .setFooter({ text: 'Mensagem removida automaticamente • Sistema Althea' })
    .setTimestamp();

  await message.channel.send({
    embeds: [embedCanal],
    allowedMentions: { users: [message.author.id] },
  }).then(msg => setTimeout(() => msg.delete().catch(() => {}), TEMPO_AVISO_CANAL))
    .catch(() => {});

  const embedDM = new EmbedBuilder()
    .setColor('#d7263d')
    .setTitle('🚫 Divulgação Indevida de Conteúdo do YouTube')
    .setDescription('Sua mensagem foi removida por divulgação indevida de vídeo do YouTube.')
    .setImage(GIFS_YOUTUBE.hl)
    .addFields(
      { name: 'Título do Vídeo', value: videoTitle || 'Não identificado', inline: false },
      { name: 'Servidor',        value: message.guild.name,               inline: true  },
      { name: 'Horário',         value: dateUtils.getBrasiliaDateTime(),   inline: true  },
    )
    .setFooter({ text: 'Mensagem removida automaticamente • Sistema Althea' })
    .setTimestamp();

  await message.author.send({ embeds: [embedDM] }).catch(() => {});

  await sendLog(message, 'Remoção de vídeo do YouTube (HL)', videoTitle);
}

async function handleYoutubeDenuncia(message) {
  const isDenuncia = message.channel?.name?.toLowerCase().includes('denúncia');
  if (!isDenuncia || !message.content) return false;

  const links = findYouTubeLinks(message.content);
  if (links.length === 0) return false;

  for (const link of links) {
    const videoId = extractYouTubeVideoId(link);
    let title = null;
    if (videoId) title = await fetchYouTubeTitle(videoId);

    if ((title && title.toLowerCase().includes('hl')) || !title) {
      await handleHLDivulgacao(message, title || 'Link inválido ou indevido');
      return true;
    }
  }

  return false;
}

module.exports = {
  extractYouTubeVideoId,
  fetchYouTubeTitle,
  findYouTubeLinks,
  handleDivulgacaoIndevida,
  handleHLDivulgacao,
  handleYoutubeDenuncia,
};