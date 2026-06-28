const { EmbedBuilder } = require('discord.js');
const Config = require('../models/Config');

function getBrasiliaTime() {
  const date = new Date();
  const brasiliaDate = new Date(date.getTime() - (3 * 60 * 60 * 1000));
  return brasiliaDate.toISOString().replace('T', ' ').split('.')[0];
}

function getEmojiString(reaction) {
  const emoji = reaction.emoji;
  if (emoji.id) return `<:${emoji.name}:${emoji.id}>`;
  return emoji.name;
}

function getEmojiURL(reaction) {
  const emoji = reaction.emoji;
  if (emoji.id) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
  }
  return null;
}

function createReactionLogEmbed(reaction, user, isAdd) {
  const message = reaction.message;
  const emojiURL = getEmojiURL(reaction);

  const embed = new EmbedBuilder()
    .setColor(isAdd ? '#00FF00' : '#FF0000')
    .setTitle(`🔔 Log de Reação ${isAdd ? 'Adicionada' : 'Removida'}`)
    .addFields(
      {
        name: '👤 Usuário',
        value: `Nome: ${user.tag}\nDiscord: <@${user.id}>`,
        inline: false
      },
      {
        name: '📝 Mensagem',
        value: message.content?.slice(0, 1024) || '[Sem conteúdo]',
        inline: false
      },
      {
        name: 'ℹ️ Informações Adicionais',
        value: [
          `Emoji: ${getEmojiString(reaction)}`,
          emojiURL ? `[Ver Emoji](${emojiURL})` : '',
          `Canal: <#${message.channel?.id}>`,
          `ID da Mensagem: \`${message.id}\``,
          `ID da Reação: \`${reaction.emoji.id || reaction.emoji.name}\``,
          `Link da Mensagem: [Clique Aqui](${message.url})`
        ].filter(Boolean).join('\n'),
        inline: false
      }
    )
    .setFooter({
      text: getBrasiliaTime().split(' ')[1]
    });

  if (message.attachments?.size > 0) {
    embed.addFields({
      name: '📎 Anexos',
      value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
      inline: false
    });
  }

  if (message.embeds?.length > 0) {
    embed.addFields({
      name: '🔗 Embeds',
      value: message.embeds.map((e, i) => e.title ? `${i+1}: ${e.title}` : e.url ? `${i+1}: ${e.url}` : `${i+1}: [embed]`).join('\n'),
      inline: false
    });
  }

  if (emojiURL) embed.setThumbnail(emojiURL);

  return embed;
}

function createReactionRemoveAllEmbed(message) {
  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('🚫 Todas as reações removidas')
    .addFields(
      { name: '📝 Mensagem', value: message.content?.slice(0, 1024) || '[Sem conteúdo]', inline: false },
      { name: '📄 ID da Mensagem', value: `\`${message.id}\``, inline: true },
      { name: '📺 Canal', value: `<#${message.channel?.id}>`, inline: true },
      { name: '🔗 Link da Mensagem', value: `[Clique Aqui](${message.url})`, inline: false }
    )
    .setFooter({ text: getBrasiliaTime().split(' ')[1] }); 

  if (message.attachments?.size > 0) {
    embed.addFields({
      name: '📎 Anexos',
      value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
      inline: false
    });
  }
  if (message.embeds?.length > 0) {
    embed.addFields({
      name: '🔗 Embeds',
      value: message.embeds.map((e, i) => e.title ? `${i+1}: ${e.title}` : e.url ? `${i+1}: ${e.url}` : `${i+1}: [embed]`).join('\n'),
      inline: false
    });
  }

  return embed;
}

async function safeFetchReaction(reaction, user, action) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      if (error.code === 10008) {
        console.warn(`⚠️ Mensagem já deletada ou inacessível ao processar ${action} de reação. Ignorando.`);
      } else {
        console.error(`❌ Erro ao buscar reação (${action}):`, error);
      }
      return false;
    }
  }
  return true;
}

async function handleReactionAdd(reaction, user) {
  try {
    if (user.bot) return;

    if (!(await safeFetchReaction(reaction, user, 'adição'))) return;

    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`⚠️ Canal de log (${config.channels.log}) não encontrado para o servidor ${guildId}.`);
      return;
    }

    const logEmbed = createReactionLogEmbed(reaction, user, true);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('❌ Erro ao processar reação adicionada:', error);
    console.error('Detalhes:', {
      guildId: reaction.message?.guild?.id,
      channelId: reaction.message?.channel?.id,
      messageId: reaction.message?.id,
      userId: user?.id,
      timestamp: getBrasiliaTime()
    });
  }
}


async function handleReactionRemove(reaction, user) {
  try {
    if (user.bot) return;

    if (!(await safeFetchReaction(reaction, user, 'remoção'))) return;

    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`⚠️ Canal de log (${config.channels.log}) não encontrado para o servidor ${guildId}.`);
      return;
    }

    const logEmbed = createReactionLogEmbed(reaction, user, false);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('❌ Erro ao processar remoção de reação:', error);
    console.error('Detalhes:', {
      guildId: reaction.message?.guild?.id,
      channelId: reaction.message?.channel?.id,
      messageId: reaction.message?.id,
      userId: user?.id,
      timestamp: getBrasiliaTime()
    });
  }
}

async function handleReactionRemoveAll(message) {
  try {
    if (!message.author || message.author.id !== message.client.user?.id) return;

    const guildId = message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = message.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`⚠️ Canal de log (${config.channels.log}) não encontrado para o servidor ${guildId}.`);
      return;
    }

    const logEmbed = createReactionRemoveAllEmbed(message);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('❌ Erro ao processar remoção de todas as reações:', error);
    console.error('Detalhes:', {
      guildId: message.guild?.id,
      channelId: message.channel?.id,
      messageId: message.id,
      timestamp: getBrasiliaTime()
    });
  }
}

module.exports = {
  handleReactionAdd,
  handleReactionRemove,
  handleReactionRemoveAll
};