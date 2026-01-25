const { EmbedBuilder } = require('discord.js');
const Config = require('../models/Config');

/**
 * Converte o horário atual para o fuso de Brasília (UTC-3)
 * e retorna no formato YYYY-MM-DD HH:mm:ss
 * @returns {string} Data/hora formatada
 */
function getBrasiliaTime() {
  const date = new Date();
  const brasiliaDate = new Date(date.getTime() - (3 * 60 * 60 * 1000));
  return brasiliaDate.toISOString().replace('T', ' ').split('.')[0];
}

/**
 * Converte emoji para string compatível com Discord
 * @param {MessageReaction} reaction - Reação do Discord
 * @returns {string} String formatada do emoji
 */
function getEmojiString(reaction) {
  const emoji = reaction.emoji;
  if (emoji.id) return `<:${emoji.name}:${emoji.id}>`;
  return emoji.name;
}

/**
 * Retorna a URL do emoji customizado, se aplicável
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
 * Cria embed para log de reações, incluindo anexos e embeds da mensagem original
 * @param {MessageReaction} reaction - Reação do Discord
 * @param {User} user - Usuário que reagiu
 * @param {boolean} isAdd - true se adicionou, false se removeu
 * @returns {EmbedBuilder} Embed formatado
 */
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
      text: getBrasiliaTime().split(' ')[1] // Só o horário, ex: "21:43:55"
    });

  // Anexos
  if (message.attachments?.size > 0) {
    embed.addFields({
      name: '📎 Anexos',
      value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
      inline: false
    });
  }

  // Embeds (exibe títulos ou URLs dos embeds da mensagem, se houver)
  if (message.embeds?.length > 0) {
    embed.addFields({
      name: '🔗 Embeds',
      value: message.embeds.map((e, i) => e.title ? `${i+1}: ${e.title}` : e.url ? `${i+1}: ${e.url}` : `${i+1}: [embed]`).join('\n'),
      inline: false
    });
  }

  // Imagem do emoji customizado como thumbnail
  if (emojiURL) embed.setThumbnail(emojiURL);

  return embed;
}

/**
 * Cria embed para log de remoção em massa de reações
 * @param {Message} message
 * @returns {EmbedBuilder}
 */
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
    .setFooter({ text: getBrasiliaTime().split(' ')[1] }); // Só o horário

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

/**
 * Utilitário: busca/fetch reação se partial, com tratamento para erro 10008 (Mensagem desconhecida)
 * @returns {boolean} true se buscou e está ok, false se não é possível continuar (mensagem deletada, etc)
 */
async function safeFetchReaction(reaction, user, action) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      if (error.code === 10008) {
        // Mensagem foi deletada ou não é mais acessível; caso comum, não é bug
        console.warn(`⚠️ Mensagem já deletada ou inacessível ao processar ${action} de reação. Ignorando.`);
      } else {
        // Outros erros: log completo
        console.error(`❌ Erro ao buscar reação (${action}):`, error);
      }
      return false;
    }
  }
  return true;
}

/**
 * Processa reações adicionadas em mensagens
 * @param {MessageReaction} reaction - Reação adicionada
 * @param {User} user - Usuário que adicionou a reação
 */
async function handleReactionAdd(reaction, user) {
  try {
    // Ignora reações de bots
    if (user.bot) return;

    // Busca/fetch seguro
    if (!(await safeFetchReaction(reaction, user, 'adição'))) return;

    // Só processa reações em mensagens do próprio bot
    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    // Busca canal de logs nas configurações
    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`⚠️ Canal de log (${config.channels.log}) não encontrado para o servidor ${guildId}.`);
      return;
    }

    // Cria e envia embed de log
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

/**
 * Processa reações removidas de mensagens
 * @param {MessageReaction} reaction - Reação removida
 * @param {User} user - Usuário que removeu a reação
 */
async function handleReactionRemove(reaction, user) {
  try {
    // Ignora reações de bots
    if (user.bot) return;

    // Busca/fetch seguro
    if (!(await safeFetchReaction(reaction, user, 'remoção'))) return;

    // Só processa reações em mensagens do próprio bot
    if (!reaction.message?.author || reaction.message.author.id !== reaction.client.user?.id) return;

    // Busca canal de logs nas configurações
    const guildId = reaction.message.guild?.id;
    if (!guildId) return;
    const config = await Config.findOne({ guildId });
    if (!config?.channels?.log) return;

    const logChannel = reaction.client.channels.cache.get(config.channels.log);
    if (!logChannel) {
      console.warn(`⚠️ Canal de log (${config.channels.log}) não encontrado para o servidor ${guildId}.`);
      return;
    }

    // Cria e envia embed de log
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

/**
 * Processa remoção de todas as reações de uma mensagem (ex: por moderador, menu do Discord)
 * @param {Message} message - Mensagem de onde todas as reações foram removidas
 */
async function handleReactionRemoveAll(message) {
  try {
    // Só processa mensagens do próprio bot (opcional)
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