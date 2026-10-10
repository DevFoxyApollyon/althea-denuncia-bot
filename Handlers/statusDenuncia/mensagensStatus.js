// Respostas seguras e mensagens de status nos tópicos, logs e canal de análise.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getBrasiliaDate, formatTimeBR } = require('../../utils/dateUtils');
const { createCorrectionButtonRow } = require('../corrigirHandler');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

const _sendOnceLocks = new Set();

async function safeDefer(interaction, ephemeral = true) {
  try {
    if (!interaction?.isRepliable?.()) return false;
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: ephemeral ? [MessageFlags.Ephemeral] : [] });
    }
    return true;
  } catch (e) {
    if (e?.code === 10062) return false;
    return false;
  }
}

async function safeReplyOrEdit(interaction, payload) {
  try {
    if (!interaction?.isRepliable?.()) return null;
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (e) {
    if (e?.code === 10062) return null;
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply(payload);
      }
    } catch (_) {}
    return null;
  }
}

const STATUS_PATTERNS = [
  '🔎 Esta denúncia está em análise por',
  '✅ Denúncia aceita por',
  '❌ Denúncia recusada por',
];

const REANALISE_PATTERNS = [
  '📝 **Reanálise / Recurso**',
  '📝 Reanálise / Recurso',
  'Caso queira uma **reanálise**, abra um **ticket** no canal',
  'Caso queira uma reanálise, abra um ticket',
];

function isOurBotStatusMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return STATUS_PATTERNS.some((p) => content.includes(p));
}

function isOurBotAnaliseMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('🔎 Esta denúncia está em análise por');
}

function isOurBotAceitaMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('✅ Denúncia aceita por');
}

function isOurBotRecusadaMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return content.includes('❌ Denúncia recusada por');
}

function isOurBotReanaliseMessage(msg) {
  if (!msg?.author?.bot) return false;
  const content = String(msg.content || '');
  return REANALISE_PATTERNS.some((p) => content.includes(p));
}

async function sendOnce(channel, content) {
  if (!channel?.isTextBased?.()) return null;

  const contentKey = `${channel.id}:${String(content || '').trim().slice(0, 100)}`;

  if (_sendOnceLocks.has(contentKey)) {
    log.debug(`sendOnce bloqueado por lock em memória: ${contentKey}`);
    return null;
  }

  _sendOnceLocks.add(contentKey);

  try {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (messages) {
      const already = messages.find(
        (m) => m?.author?.bot && String(m.content || '').trim() === String(content || '').trim()
      );
      if (already) {
        log.debug(`Mensagem já existe, reutilizando: ${already.id}`);
        return already;
      }
    }
    return await channel.send(content);
  } catch (e) {
    log.error('Erro ao enviar mensagem:', e?.message);
    return null;
  } finally {
    setTimeout(() => _sendOnceLocks.delete(contentKey), 3000);
  }
}

async function cleanupStatusMessages(targetChannel, cleanupType = 'all') {
  if (!targetChannel?.isTextBased?.()) return;
  try {
    let lastId = null;
    for (let i = 0; i < 2; i++) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const messages = await targetChannel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;
      let toDelete;
      if (cleanupType === 'analise') {
        toDelete = messages.filter((msg) => isOurBotAnaliseMessage(msg));
      } else if (cleanupType === 'aceita') {
        toDelete = messages.filter((msg) => isOurBotAceitaMessage(msg));
      } else if (cleanupType === 'recusada') {
        toDelete = messages.filter((msg) => isOurBotRecusadaMessage(msg));
      } else if (cleanupType === 'reanalise') {
        toDelete = messages.filter((msg) => isOurBotReanaliseMessage(msg));
      } else {
        toDelete = messages.filter((msg) => isOurBotStatusMessage(msg) || isOurBotReanaliseMessage(msg));
      }
      for (const msg of toDelete.values()) {
        try {
          const fetched = await msg.fetch().catch(() => null);
          if (fetched) {
            await fetched.delete().catch((e) => {
              if (e?.code === 10008) {
                log.debug(`Mensagem já deletada: ${msg.id}`);
              } else {
                log.warn('Falha ao deletar mensagem', e?.message || e);
              }
            });
          } else {
            log.debug(`Mensagem não encontrada, ignorando: ${msg.id}`);
          }
        } catch (e) {
          if (e?.code === 10008 || e?.code === 50001) {
            log.debug(`Mensagem já deletada ou sem acesso: ${msg.id}`);
          } else {
            log.warn('Erro ao processar deleção', e?.message || e);
          }
        }
      }
      lastId = messages.last()?.id;
      if (!lastId) break;
    }
  } catch (error) {
    log.error('Erro ao limpar mensagens', error);
  }
}

const statusConfig = {
  aceitar: { emoji: '✅', message: 'Denúncia aceita', color: '#00FF00' },
  recusar: { emoji: '❌', message: 'Denúncia recusada', color: '#FF0000' },
  analiser: { emoji: '🔎', message: 'Denúncia em análise', color: '#FFA500' },
  reivindicar: { emoji: '📝', message: 'Denúncia reivindicada', color: '#1E90FF' },
};

function createStatusMessage(type, user, data = {}) {
  const denunciaData = data.denuncia || {};
  const logUrl = data.logMessage
    ? `https://discord.com/channels/${data.guildId}/${data.logChannelId}/${data.logMessage.id}`
    : data.logMessageId && data.guildId && data.logChannelId
    ? `https://discord.com/channels/${data.guildId}/${data.logChannelId}/${data.logMessageId}`
    : '';
  switch (type) {
    case 'analise':
      return `🔎 Esta denúncia está em análise por ${user} Acusado: (${denunciaData.acusado || 'Não informado'}) Motivo: (${denunciaData.motivo || 'Não informado'}) Link: ${logUrl}`;
    case 'aceita':
      return `✅ Denúncia aceita por ${user} Acusado: (${data.acusadoId}) Tomará punição por (${data.motivo}) Data ${data.dataPunicao} Link: ${logUrl}`;
    case 'recusada':
      return `❌ Denúncia recusada por ${user}`;
    default:
      return '';
  }
}

function createLogsMessage(type, user, data = {}) {
  const denunciaData = data.denuncia || {};
  switch (type) {
    case 'analise':
      return `🔎 Esta denúncia está em análise por ${user} Acusado: (${denunciaData.acusado || 'Não informado'}) Motivo: (${denunciaData.motivo || 'Não informado'}) Link: ${data.messageUrl}`;
    case 'aceita':
      return `➱ Denúncia aceita Acusado (${data.acusadoId}) tomará punição por (${data.motivo}) Data ${data.dataPunicao} Link:|| ${data.messageUrl} ||`;
    case 'recusada':
      return `❌ Denúncia recusada por ${user}`;
    default:
      return '';
  }
}

function createLogActionRow(denunciaMessageId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`log_aceitar_${denunciaMessageId}`)
      .setLabel('Aceitar')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`log_recusar_${denunciaMessageId}`)
      .setLabel('Recusar')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function createAnalysisUpdateMessage(type, data = {}) {
  const denunciaData = data.denuncia || {};
  const link = data.messageUrl || '';
  if (type === 'aceita') {
    const acusado = data.acusadoId || denunciaData.acusado || 'Não informado';
    return `✅ Denúncia contra (${acusado}) foi aceita. Link: ${link}`;
  }
  if (type === 'recusada') {
    const acusado = denunciaData.acusado || 'Não informado';
    return `❌ Denúncia contra (${acusado}) foi recusada. Link: ${link}`;
  }
  return '';
}

async function fetchLogMessage(logsChannel, logMessageId) {
  if (!logsChannel || !logMessageId) return null;
  try {
    return await logsChannel.messages.fetch(logMessageId);
  } catch {
    return null;
  }
}

async function fetchAnalysisMessage(analysisChannel, analysisMessageId) {
  if (!analysisChannel || !analysisMessageId) return null;
  try {
    return await analysisChannel.messages.fetch(analysisMessageId);
  } catch {
    return null;
  }
}

async function sendReanaliseNotice(channel) {
  try {
    if (!channel?.guild) return;
    await cleanupStatusMessages(channel, 'reanalise');
    const ticketChannel = channel.guild.channels.cache.find(
      (c) =>
        c?.isTextBased?.() &&
        typeof c.name === 'string' &&
        c.name.toLowerCase().includes('abrir-ticket')
    );
    const ticketMention = ticketChannel ? `<#${ticketChannel.id}>` : '`abrir-ticket`';
    await sendOnce(
      channel,
      `📝 **Reanálise / Recurso**\n` +
        `Caso queira uma **reanálise**, abra um **ticket** no canal ${ticketMention}.`
    );
  } catch (e) {
    log.warn('Falha ao enviar aviso de reanálise', e);
  }
}

async function manageStatusMessages(channel, newStatus, user, data = {}) {
  let discordLogMessage = null;
  let discordAnalysisMessage = null;
  try {
    const logsChannel = data.logsChannel;
    const logMessageId = data.logMessageId;
    if (logsChannel && logMessageId) {
      discordLogMessage = await fetchLogMessage(logsChannel, logMessageId);
    }

    let statusChannel = channel;
    let analysisChannel = null;
    if (data.analysisChannelId && channel.guild) {
      analysisChannel = await channel.guild.channels.fetch(data.analysisChannelId).catch(() => null);
      if (analysisChannel?.isTextBased?.()) statusChannel = analysisChannel;
    }

    if (analysisChannel && data.analysisMessageId) {
      discordAnalysisMessage = await fetchAnalysisMessage(analysisChannel, data.analysisMessageId);
    }

    if (newStatus === 'analise') {
      await cleanupStatusMessages(channel, 'aceita');
      await cleanupStatusMessages(channel, 'recusada');
      let newLogMessageId = null;
      if (logsChannel) {
        if (discordLogMessage) {
          await discordLogMessage.edit(createLogsMessage(newStatus, user, { ...data, denuncia: data.denuncia }));
          newLogMessageId = discordLogMessage.id;
        } else {
          discordLogMessage = await logsChannel.send(createLogsMessage(newStatus, user, { ...data, denuncia: data.denuncia }));
          newLogMessageId = discordLogMessage.id;
        }
      }
      const analysisMessageContent =
        `🔎 Esta denúncia está em análise por ${user} ` +
        `Acusado: (${data.denuncia?.acusado || 'Não informado'}) ` +
        `Motivo: (${data.denuncia?.motivo || 'Não informado'}) ` +
        `Link: ${data.messageUrl}`;
      discordAnalysisMessage = await sendOnce(statusChannel, analysisMessageContent);
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: newLogMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      if (channel.id !== statusChannel.id) {
        await sendOnce(channel, statusMsgContent);
      }
      return { logMessage: discordLogMessage, analysisMessage: discordAnalysisMessage };
    }

    if (newStatus === 'aceita') {
      await cleanupStatusMessages(channel, 'recusada');
      await cleanupStatusMessages(channel, 'analise');
      if (logsChannel) {
        const logsContent = createLogsMessage(newStatus, user, data);
        try {
          if (discordLogMessage) {
            await discordLogMessage.edit({ content: logsContent, components: [createLogActionRow(data.denuncia?.messageId || data.messageUrl)] });
          } else {
            discordLogMessage = await logsChannel.send({
              content: logsContent,
              components: [createLogActionRow(data.denuncia?.messageId || data.messageUrl)]
            });
          }
        } catch (logError) {
          log.error(`[${formatTimeBR(getBrasiliaDate())}] Erro ao enviar/editar mensagem de log`, logError);
        }
      }
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: discordLogMessage ? discordLogMessage.id : data.logMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      const statusMessage = await sendOnce(channel, statusMsgContent);
      if (statusMessage) {
        const correctionRow = createCorrectionButtonRow();
        await statusMessage.edit({ content: statusMsgContent, components: [correctionRow] }).catch((error) =>
          log.warn('Falha ao adicionar botão de correção à mensagem aceita', error?.message)
        );
      }

      if (discordAnalysisMessage) {
        const analysisUpdateContent = createAnalysisUpdateMessage('aceita', data);
        await discordAnalysisMessage.edit(analysisUpdateContent).catch((e) =>
          log.warn('Falha ao editar mensagem de análise (aceita)', e?.message)
        );
      }

      return { logMessage: discordLogMessage, analysisMessage: discordAnalysisMessage };
    }

    if (newStatus === 'recusada') {
      await cleanupStatusMessages(channel, 'aceita');
      await cleanupStatusMessages(channel, 'analise');
      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: discordLogMessage ? discordLogMessage.id : data.logMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });
      const sentStatusMessage = await sendOnce(channel, statusMsgContent);
      if (sentStatusMessage) {
        await sentStatusMessage.edit({ components: [] }).catch(() => {});
      }
      if (discordLogMessage) {
        await discordLogMessage.delete().catch((e) => log.warn('Falha ao deletar mensagem de log', e));
        discordLogMessage = null;
      }

      if (discordAnalysisMessage) {
        const analysisUpdateContent = createAnalysisUpdateMessage('recusada', data);
        await discordAnalysisMessage.edit(analysisUpdateContent).catch((e) =>
          log.warn('Falha ao editar mensagem de análise (recusada)', e?.message)
        );
      }

      return { logMessage: null, analysisMessage: discordAnalysisMessage };
    }
  } catch (error) {
    log.error('Erro ao gerenciar mensagens de status', error);
  }
  return { logMessage: discordLogMessage, analysisMessage: discordAnalysisMessage };
}

module.exports = {
  safeDefer,
  safeReplyOrEdit,
  sendOnce,
  statusConfig,
  sendReanaliseNotice,
  manageStatusMessages,
};
