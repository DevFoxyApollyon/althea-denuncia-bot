// utils/youtubeUtils.js

const fetch = require('node-fetch');
const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

// ─────────────────────────────────────────────────────────────────────────────
// GIFs de aviso — troque pelos seus links do Giphy (terminando em giphy.gif)
// NÃO use links do tipo media1.tenor.com/m/... (não funciona no Discord)
// ─────────────────────────────────────────────────────────────────────────────
const GIFS_YOUTUBE = {
  divulgacao: 'https://media.giphy.com/media/l1J9EdzfOSgfyueLm/giphy.gif', // aviso divulgação normal
  hl:         'https://media.giphy.com/media/3o7TKTDn976rzVgky4/giphy.gif', // aviso divulgação HL
};

// Tempo que o aviso fica no canal antes de ser deletado
const TEMPO_AVISO_CANAL = 10_000; // 10 segundos

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de YouTube
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai o ID do vídeo do YouTube de uma URL
 */
function extractYouTubeVideoId(url) {
  const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

/**
 * Busca o título do vídeo via oEmbed (sem precisar de API key)
 */
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

/**
 * Encontra todos os links do YouTube em um texto
 */
function findYouTubeLinks(text) {
  if (!text) return [];
  const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+)/gi;
  return text.match(ytRegex) || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Log de auditoria
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia log detalhado no canal de auditoria configurado
 */
async function sendLog(message, motivo, videoTitle) {
  try {
    // CORREÇÃO: o require do Config estava duplicado (importado no topo e dentro da função).
    // Agora está apenas no topo do arquivo, evitando require desnecessário a cada chamada.
    const Config = require('../models/Config');
    const configDoc = await Config.findOne({ guildId: message.guild.id });

    // Suporta tanto config.channels.log quanto config.channels.logs
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
        { name: 'Usuário',            value: `<@${message.author.id}>`,                        inline: true  },
        { name: 'ID do Usuário',      value: message.author.id,                                inline: true  },
        { name: 'Staff (Bot)',         value: `<@${message.client.user.id}>`,                   inline: true  },
        { name: 'Mensagem Original',  value: message.content?.slice(0, 1024) || 'N/A',         inline: false },
        { name: 'Data/Hora',          value: dateUtils.getBrasiliaDateTime(),                   inline: true  },
        { name: 'ID da Mensagem',     value: message.id,                                       inline: true  },
        { name: 'Canal',              value: `<#${message.channel.id}>`,                       inline: true  },
        { name: 'Servidor',           value: `${message.guild.name} (${message.guild.id})`,    inline: false },
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

// ─────────────────────────────────────────────────────────────────────────────
// Handlers de divulgação
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Divulgação indevida normal — aviso no canal (temporário) + log
 */
async function handleDivulgacaoIndevida(message, videoTitle) {
  await message.delete().catch(() => {});

  // Embed com GIF no canal (some após TEMPO_AVISO_CANAL)
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

/**
 * Divulgação indevida HL — aviso no canal (temporário) + DM com GIF + log
 */
async function handleHLDivulgacao(message, videoTitle) {
  await message.delete().catch(() => {});

  // Embed com GIF no canal (some após TEMPO_AVISO_CANAL)
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

  // DM com GIF (privado, fica salvo para o usuário)
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

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  extractYouTubeVideoId,
  fetchYouTubeTitle,
  findYouTubeLinks,
  handleDivulgacaoIndevida,
  handleHLDivulgacao,
};