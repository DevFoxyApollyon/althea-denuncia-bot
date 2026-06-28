// messageReactionHandler.js
const { EmbedBuilder } = require('discord.js');
const Config = require('../models/Config');

/**
 * Converte o horÃ¡rio atual para o fuso de BrasÃ­lia (UTC-3)
 * e retorna no formato YYYY-MM-DD HH:mm:ss
 * @returns {string} Data/hora formatada
 */
function getBrasiliaTime() {
  const date = new Date();
  const brasiliaDate = new Date(date.getTime() - (3 * 60 * 60 * 1000));
  return brasiliaDate.toISOString().replace('T', ' ').split('.')[0];
}

/**
 * Converte emoji para string compatÃ­vel com Discord
 * @param {MessageReaction} reaction - ReaÃ§Ã£o do Discord
 * @returns {string} String formatada do emoji
 */
function getEmojiString(reaction) {
  const emoji = reaction.emoji;
  if (emoji.id) return `<:${emoji.name}:${emoji.id}>`;
  return emoji.name;
}

/**
 * Retorna a URL do emoji customizado, se aplicÃ¡vel
 * @param {MessageReaction} reaction
 * @returns {string|null}
 */
function getEmojiURL(reaction) {
  const emoji = reaction.emoji;
  if (emoji.id) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
  }
  return null;
}

/**
 * Cria embed para log de reaÃ§Ãµes, incluindo anexos e embeds da mensagem original
 * @param {MessageReaction} reaction - ReaÃ§Ã£o do Discord
 * @param {User} user - UsuÃ¡rio que reagiu
 * @param {boolean} isAdd - true se adicionou, false se removeu
 * @returns {EmbedBuilder} Embed formatado
 */
function createReactionLogEmbed(reaction, user, isAdd) {
  const message = reaction.message;
  const emojiURL = getEmojiURL(reaction);

  const embed = new EmbedBuilder()
    .setColor(isAdd ? '#00FF00' : '#FF0000')
    .setTitle(`ðŸ”” Log de ReaÃ§Ã£o ${isAdd ? 'Adicionada' : 'Removida'}`)
    .addFields(
      {
        name: 'ðŸ‘¤ UsuÃ¡rio',
        value: `Nome: ${user.tag}\nDiscord: <@${user.id}>`,
        inline: false
      },
      {
        name: 'ðŸ“ Mensagem',
        value: message.content?.slice(0, 1024) || '[Sem conteÃºdo]',
        inline: false
      },
      {
        name: 'â„¹ï¸ InformaÃ§Ãµes Adicionais',
        value: [
          `Emoji: ${getEmojiString(reaction)}`,
          emojiURL ? `[Ver Emoji](${emojiURL})` : '',
          `Canal: <#${message.channel?.id}>`,
          `ID da Mensagem: \`${message.id}\``,
          `ID da ReaÃ§Ã£o: \`${reaction.emoji.id || reaction.emoji.name}\``,
          `Link da Mensagem: [Clique Aqui](${message.url})`
        ].filter(Boolean).join('\n'),
        inline: false
      }
    )
    .setFooter({
      text: getBrasiliaTime().split(' ')[1] // SÃ³ o horÃ¡rio, ex: "21:43:55"
    });

  // Anexos
  if (message.attachments?.size > 0) {
    embed.addFields({
      name: 'ðŸ“Ž Anexos',
      value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
      inline: false
    });
  }

  // Embeds (exibe tÃ­tulos ou URLs dos embeds da mensagem, se houver)
  if (message.embeds?.length > 0) {
    embed.addFields({
      name: 'ðŸ”— Embeds',
      value: message.embeds.map((e, i) => e.title ? `${i+1}: ${e.title}` : e.url ? `${i+1}: ${e.url}` : `${i+1}: [embed]`).join('\n'),
      inline: false
    });
  }

  // Imagem do emoji customizado como thumbnail
  if (emojiURL) embed.setThumbnail(emojiURL);

  return embed;
}

/**
 * Cria embed para log de remoÃ§Ã£o em massa de reaÃ§Ãµes
 * @param {Message} message
 * @returns {EmbedBuilder}
 */
function createReactionRemoveAllEmbed(message) {
  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('ðŸš« Todas as reaÃ§Ãµes removidas')
    .addFields(
      { name: 'ðŸ“ Mensagem', value: message.content?.slice(0, 1024) || '[Sem conteÃºdo]', inline: false },
      { name: 'ðŸ“„ ID da Mensagem', value: `\`${message.id}\``, inline: true },
      { name: 'ðŸ“º Canal', value: `<#${message.channel?.id}>`, inline: true },
      { name: 'ðŸ”— Link da Mensagem', value: `[Clique Aqui](${message.url})`, inline: false }
    )
    .setFooter({ text: getBrasiliaTime().split(' ')[1] }); // SÃ³ o horÃ¡rio

  if (message.attachments?.size > 0) {
    embed.addFields({
      name: 'ðŸ“Ž Anexos',
      value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
      inline: false
    });
  }
  if (message.embeds?.length > 0) {
    embed.addFields({
      name: 'ðŸ”— Embeds',
      value: message.embeds.map((e, i) => e.title ? `${i+1}: ${e.title}` : e.url ? `${i+1}: ${e.url}` : `${i+1}: [embed]`).join('\n'),
      inline: false
    });
  }

  return embed;
}

/**
 * UtilitÃ¡rio: busca/fetch reaÃ§Ã£o se partial, com tratamento para erro 10008 (Mensagem desconhecida)
 * @returns {boolean} true se buscou e estÃ¡ ok, false se nÃ£o Ã© possÃ­vel continuar (mensagem deletada, etc)
 */
async function safeFetchReaction(reaction, user, action) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      if (error.code === 10008) {
        // Mensagem foi deletada ou nÃ£o Ã© mais acessÃ­vel; caso comum, nÃ£o Ã© bug
        console.warn(`âš ï¸ Mensagem jÃ¡ deletada ou inacessÃ­vel ao processar ${action} de reaÃ§Ã£o. Ignorando.`);
      } else {
        // Outros erros: log completo
        console.error(`âŒ Erro ao buscar reaÃ§Ã£o (${action}):`, error);
      }
      return false;
    }
  }
  return true;
}

/**
 * Processa reaÃ§Ãµes adicionadas em mensagens
 * @param {MessageReaction} reaction - ReaÃ§Ã£o adicionada
 * @param {User} user - UsuÃ¡rio que adicionou a reaÃ§Ã£o
 */
async function handleReactionAdd(reaction, user) {
  try {
    // Ignora reaÃ§Ãµes de bots
    if (user.bot) return;

    // Busca/fetch seguro
    if (!(await safeFetchReaction(reaction, user, 'adiÃ§Ã£o'))) return;

    // SÃ³ processa reaÃ§Ãµes em mensagens do prÃ³prio bot
    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    // Busca canal de logs nas configuraÃ§Ãµes
    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`âš ï¸ Canal de log (${config.channels.log}) nÃ£o encontrado para o servidor ${guildId}.`);
      return;
    }

    // Cria e envia embed de log
    const logEmbed = createReactionLogEmbed(reaction, user, true);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('âŒ Erro ao processar reaÃ§Ã£o adicionada:', error);
    console.error('Detalhes:', {
      guildId: reaction.message?.guild?.id,
      channelId: reaction.message?.channel?.id,
      messageId: reaction.message?.id,
      userId: user?.id,
      timestamp: getBrasiliaTime()
    });
  }
}

/**
 * Processa reaÃ§Ãµes removidas de mensagens
 * @param {MessageReaction} reaction - ReaÃ§Ã£o removida
 * @param {User} user - UsuÃ¡rio que removeu a reaÃ§Ã£o
 */
async function handleReactionRemove(reaction, user) {
  try {
    // Ignora reaÃ§Ãµes de bots
    if (user.bot) return;

    // Busca/fetch seguro
    if (!(await safeFetchReaction(reaction, user, 'remoÃ§Ã£o'))) return;

    // SÃ³ processa reaÃ§Ãµes em mensagens do prÃ³prio bot
    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    // Busca canal de logs nas configuraÃ§Ãµes
    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`âš ï¸ Canal de log (${config.channels.log}) nÃ£o encontrado para o servidor ${guildId}.`);
      return;
    }

    // Cria e envia embed de log
    const logEmbed = createReactionLogEmbed(reaction, user, false);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('âŒ Erro ao processar remoÃ§Ã£o de reaÃ§Ã£o:', error);
    console.error('Detalhes:', {
      guildId: reaction.message?.guild?.id,
      channelId: reaction.message?.channel?.id,
      messageId: reaction.message?.id,
      userId: user?.id,
      timestamp: getBrasiliaTime()
    });
  }
}

/**
 * Processa remoÃ§Ã£o de todas as reaÃ§Ãµes de uma mensagem (ex: por moderador, menu do Discord)
 * @param {Message} message - Mensagem de onde todas as reaÃ§Ãµes foram removidas
 */
async function handleReactionRemoveAll(message) {
  try {
    // SÃ³ processa mensagens do prÃ³prio bot (opcional)
    if (!message.author || message.author.id !== message.client.user?.id) return;

    const guildId = message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = message.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`âš ï¸ Canal de log (${config.channels.log}) nÃ£o encontrado para o servidor ${guildId}.`);
      return;
    }

    const logEmbed = createReactionRemoveAllEmbed(message);
    await logChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('âŒ Erro ao processar remoÃ§Ã£o de todas as reaÃ§Ãµes:', error);
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