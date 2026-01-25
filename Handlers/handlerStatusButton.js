// /Handlers/handlerStatusButton.js

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { LogManager } = require('./LogManager');
const ModerationAction = require('../models/ModerationAction');
const { getBrasiliaDate, formatTimeBR } = require('../utils/dateUtils');

// ✅ LOG CENTRALIZADO
const { Logger } = require('../utils/logger');
const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

/** =========================
 *  SAFE INTERACTION HELPERS
 *  ========================= */
async function safeDefer(interaction, ephemeral = true) {
  try {
    if (!interaction?.isRepliable?.()) return false;
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral });
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

/** =========================
 *  DUPLICATE / CLEANUP HELPERS
 *  ========================= */

// Padrões de mensagens do bot que precisam ser únicas (e apagar antigas)
const STATUS_PATTERNS = [
  '🔎 Esta denúncia está em análise por',
  '✅ Denúncia aceita por',
  '❌ Denúncia recusada por',
];

const REANALISE_PATTERNS = [
  '📌 **Reanálise / Recurso**',
  '📌 Reanálise / Recurso',
  'Caso queira uma **reanálise**, abra um **ticket** no canal',
  'Caso queira uma reanalise, abra um ticket', 
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

// Evita enviar o mesmo conteúdo duas vezes (caso o handler dispare duplicado)
async function sendOnce(channel, content) {
  if (!channel?.isTextBased?.()) return null;

  try {
    const last = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (last) {
      const already = last.find(
        (m) => m?.author?.bot && String(m.content || '').trim() === String(content || '').trim()
      );
      if (already) {
        log.debug(`Mensagem já existe, reutilizando: ${already.id}`);
        return already;
      }
    }
  } catch (e) {
    log.debug('Erro ao buscar mensagens anteriores:', e?.message);
  }

  try {
    return await channel.send(content);
  } catch (e) {
    log.error('Erro ao enviar mensagem:', e?.message);
    return null;
  }
}

// Apaga mensagens antigas (status + reanálise) no(s) canal(is) alvo(s)
async function cleanupStatusMessages(targetChannel, cleanupType = 'all') {
  if (!targetChannel?.isTextBased?.()) return;

  try {
    let lastId = null;

    // varre um histórico razoável (até ~200 msgs) pra limpar duplicadas
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
          // Verifica se a mensagem ainda existe antes de deletar
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

/** =========================
 *  STATUS CONFIG
 *  ========================= */
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
    : (data.logMessageId && data.guildId && data.logChannelId)
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
      return `➱ Denúncia aceita Acusado (${data.acusadoId}) tomará punição por (${data.motivo}) Data ${data.dataPunicao} Link: ${data.messageUrl}`;
    case 'recusada':
      return `❌ Denúncia recusada por ${user}`;
    default:
      return '';
  }
}

async function fetchLogMessage(logsChannel, logMessageId) {
  if (!logsChannel || !logMessageId) return null;
  try {
    return await logsChannel.messages.fetch(logMessageId);
  } catch {
    return null;
  }
}

// ✅ avisa reanálise e MARCA o canal pelo ID (<#id>)
// (e limpa avisos antigos antes de enviar)
async function sendReanaliseNotice(channel) {
  try {
    if (!channel?.guild) return;

    // Limpa APENAS mensagens de reanálise antigas
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
      `📌 **Reanálise / Recurso**\n` +
        `Caso queira uma **reanálise**, abra um **ticket** no canal ${ticketMention}.`
    );
  } catch (e) {
    log.warn('Falha ao enviar aviso de reanálise', e);
  }
}

async function manageStatusMessages(channel, newStatus, user, data = {}) {
  let discordLogMessage = null;

  try {
    const logsChannel = data.logsChannel;
    const logMessageId = data.logMessageId;

    // tenta recuperar mensagem de log existente
    if (logsChannel && logMessageId) {
      discordLogMessage = await fetchLogMessage(logsChannel, logMessageId);
    }

    // Decide canal alvo pra mensagem “em análise”
    let statusChannel = channel;
    if (data.analysisChannelId && channel.guild) {
      const analysisChannel = await channel.guild.channels.fetch(data.analysisChannelId).catch(() => null);
      if (analysisChannel?.isTextBased?.()) statusChannel = analysisChannel;
    }


    /** =========================
     *  ANALISE
     *  ========================= */
    if (newStatus === 'analise') {
      // Limpa mensagens de aceita e recusada anteriores
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

      // envia só uma vez no canal de análise (ou no próprio thread se não tiver canal de análise)
      await sendOnce(statusChannel, analysisMessageContent);

      const statusMsgContent = createStatusMessage(newStatus, user, {
        ...data,
        logMessage: discordLogMessage,
        logMessageId: newLogMessageId,
        guildId: channel.guild.id,
        logChannelId: logsChannel ? logsChannel.id : null,
        denuncia: data.denuncia,
      });

      // se o canal de análise for diferente, manda também no thread (uma vez)
      if (channel.id !== statusChannel.id) {
        await sendOnce(channel, statusMsgContent);
      }

      return discordLogMessage;
    }

    /** =========================
     *  ACEITA
     *  ========================= */
    if (newStatus === 'aceita') {
      // Limpa mensagens de recusa e análise anteriores
      await cleanupStatusMessages(channel, 'recusada');
      await cleanupStatusMessages(channel, 'analise');

      if (logsChannel) {
        const logsContent = createLogsMessage(newStatus, user, data);

        try {
          if (discordLogMessage) {
            await discordLogMessage.edit(logsContent);
          } else {
            discordLogMessage = await logsChannel.send(logsContent);
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

      await sendOnce(channel, statusMsgContent);
      return discordLogMessage;
    }

    /** =========================
     *  RECUSADA
     *  ========================= */
    if (newStatus === 'recusada') {
      // Limpa mensagens de aceita e análise anteriores
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

      await sendOnce(channel, statusMsgContent);

      if (discordLogMessage) {
        await discordLogMessage.delete().catch((e) => log.warn('Falha ao deletar mensagem de log', e));
        discordLogMessage = null;
      }

      return null;
    }
  } catch (error) {
    log.error('Erro ao gerenciar mensagens de status', error);
  }

  return discordLogMessage;
}

async function updateDenunciaStatus(denunciaId, {
  status,
  staffId,
  motivoEdicao,
  acusadoId,
  motivoAceite,
  dataPunicao,
  logMessageId,
}) {
  const now = new Date();
  const updateFields = {
    status,
    staffId,
    acusadoId,
    motivoAceite,
    dataPunicao,
    'ultimaEdicao.staffId': staffId,
    'ultimaEdicao.data': now,
    'ultimaEdicao.motivoEdicao': motivoEdicao,
    dataAtualizacao: now,
  };

  if (logMessageId !== undefined) {
    updateFields.logMessageId = logMessageId;
  }

  return await Denuncia.findByIdAndUpdate(denunciaId, updateFields, { new: true });
}

async function canModifyReport(interaction, denuncia, config) {
  const isResponsavelAdmin =
    config?.roles?.responsavel_admin &&
    interaction.member.roles.cache.has(config.roles.responsavel_admin);

  if (isResponsavelAdmin) return true;
  if (denuncia.claimedBy === interaction.user.id) return true;
  return false;
}

async function handleStatusButton(interaction, status) {
  try {
    if (!interaction.isRepliable()) return;

    // Verifica se não está em cooldown (duplo clique)
    if (!interaction.deferrable && interaction.deferred) {
      return;
    }

    // ✅ Não defer antes de showModal (aceitar abre modal)
    const willOpenModal = status === 'aceitar';
    if (!willOpenModal) {
      await safeDefer(interaction, true);
    }

    const hasPermission = await checkModPermission(interaction, !willOpenModal);
    if (!hasPermission) return;

    const denuncia = await Denuncia.findOne({ threadId: interaction.channel.id }).sort({ createdAt: -1 });
    if (!denuncia) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Não foi possível encontrar uma denúncia neste canal.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const config = await Config.findOne({ guildId: interaction.guild.id });

    const statusMap = {
      aceitar: 'aceita',
      recusar: 'recusada',
      analiser: 'analise',
      reivindicar: 'reivindicacao',
    };
    const normalizedStatus = statusMap[status] || status;

    const isResponsavelAdmin =
      config?.roles?.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);

    if (denuncia.status === normalizedStatus) {
      if (normalizedStatus === 'analise') {
        const isClaimer = denuncia.claimedBy === interaction.user.id;
        if (!isClaimer && !isResponsavelAdmin) {
          await safeReplyOrEdit(interaction, {
            content: '❌ Apenas quem reivindicou ou responsáveis admin podem colocar em análise.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
      } else {
        await safeReplyOrEdit(interaction, {
          content: `❌ Esta denúncia já está ${statusConfig[status]?.message.toLowerCase() || normalizedStatus}.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
    }

    const hasAdminRole =
      config?.roles?.administrador &&
      interaction.member.roles.cache.has(config.roles.administrador);

    if (hasAdminRole && !isResponsavelAdmin) {
      const previousAction = await ModerationAction.findOne({
        moderatorId: interaction.user.id,
        denunciaId: denuncia._id,
        action: { $ne: 'reivindicacao' },
      }).lean();

      if (previousAction) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Administradores só podem interagir uma vez com os botões após reivindicar esta denúncia.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
    }

    const canModify = await canModifyReport(interaction, denuncia, config);
    if (!canModify) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Apenas quem reivindicou a denúncia ou responsáveis admin podem modificá-la.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if ((status === 'aceitar' || status === 'recusar') && denuncia.claimedBy !== interaction.user.id && !isResponsavelAdmin) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Apenas quem reivindicou ou responsáveis admin podem aceitar/recusar denúncias.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (status === 'analiser' && denuncia.claimedBy !== interaction.user.id && !isResponsavelAdmin) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Apenas quem reivindicou a denúncia ou responsáveis admin podem colocá-la em análise.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const messageUrl = interaction.message.url;
    const logsChannel = config?.channels?.logs ? interaction.client.channels.cache.get(config.channels.logs) : null;

    if (status === 'analiser') {
      await handleAnalise(interaction, denuncia, config, messageUrl, logsChannel);
    } else if (status === 'aceitar') {
      await handleAceitar(interaction, denuncia, messageUrl);
    } else if (status === 'recusar') {
      await handleRecusar(interaction, denuncia, config, messageUrl, logsChannel);
    }
  } catch (error) {
    log.error('Erro ao processar status', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao processar o status.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleAnalise(interaction, denuncia, config, messageUrl, logsChannel) {
  try {
    await safeDefer(interaction, true);

    // Responde imediatamente para evitar timeout
    await safeReplyOrEdit(interaction, { content: '⏳ Processando...' });

    // Executa tudo em paralelo (sem bloquear a resposta)
    const discordLogMessage = await manageStatusMessages(interaction.channel, 'analise', interaction.user, {
      messageUrl,
      logChannelId: config.channels.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      analysisChannelId: config.channels.analysis,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'analise', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'analise',
      staffId: interaction.user.id,
      motivoEdicao: 'Em análise',
      logMessageId: discordLogMessage ? discordLogMessage.id : denuncia.logMessageId || null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('analise', interaction.user, interaction.channel.id);

    if (config.channels.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    // Atualiza a resposta anterior
    await safeReplyOrEdit(interaction, { content: '🔎 Denúncia marcada como em análise!' });
  } catch (error) {
    log.error('Erro ao manejar análise', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao marcar a denúncia como em análise.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

let denunciasMap = new Map();

async function handleAceitar(interaction, denuncia, messageUrl) {
  try {
    denunciasMap.set(interaction.user.id, { denuncia, messageUrl });

    const dataBrasilia = getBrasiliaDate();
    const day = String(dataBrasilia.getDate()).padStart(2, '0');
    const month = String(dataBrasilia.getMonth() + 1).padStart(2, '0');
    const year = dataBrasilia.getFullYear();
    const dataAtual = `${day}/${month}/${year}`;

    const modal = new ModalBuilder()
      .setCustomId('punishment_modal')
      .setTitle('Aplicar Punição');

    const acusadoId = new TextInputBuilder()
      .setCustomId('acusadoId')
      .setLabel('ID do Acusado')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Digite o ID do acusado');

    const motivo = new TextInputBuilder()
      .setCustomId('motivo')
      .setLabel('Motivo da Punição')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Digite o motivo da punição...')
      .setMaxLength(1000);

    const data = new TextInputBuilder()
      .setCustomId('data')
      .setLabel('Data da Punição')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('DD/MM/YYYY')
      .setValue(dataAtual);

    modal.addComponents(
      new ActionRowBuilder().addComponents(acusadoId),
      new ActionRowBuilder().addComponents(motivo),
      new ActionRowBuilder().addComponents(data)
    );

    try {
      await interaction.showModal(modal);
    } catch (error) {
      if (error.code === 'InteractionAlreadyReplied') {
        denunciasMap.delete(interaction.user.id);
      }
      if (error?.code === 10062) {
        denunciasMap.delete(interaction.user.id);
      }
    }
  } catch (error) {
    log.error('Erro ao manejar aceitação', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao aceitar a denúncia.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleRecusar(interaction, denuncia, config, messageUrl, logsChannel) {
  try {
    await safeDefer(interaction, true);

    // Responde imediatamente para evitar timeout
    await safeReplyOrEdit(interaction, { content: '⏳ Processando...' });

    // Se tiver log antigo, apaga (pra não sobrar no canal de logs)
    if (denuncia.logMessageId && logsChannel) {
      try {
        const existingLogMessage = await logsChannel.messages.fetch(denuncia.logMessageId).catch(() => null);
        if (existingLogMessage) {
          await existingLogMessage.delete().catch((e) => {
            // 10008 = Unknown Message, 50001 = Missing Access, 500 = Internal Server Error
            if (e?.code === 10008 || e?.code === 50001) {
              log.debug('Mensagem de log já deletada ou sem acesso');
            } else if (e?.status === 500) {
              log.debug('Servidor Discord temporariamente indisponível, ignorando');
            } else {
              log.warn('Erro ao deletar mensagem de log', e?.message || e);
            }
          });
        }
      } catch (error) {
        if (error?.code !== 10008 && error?.status !== 500) {
          log.warn('Erro ao buscar/deletar mensagem de log', error?.message || error);
        }
      }
    }

    await manageStatusMessages(interaction.channel, 'recusada', interaction.user, {
      messageUrl,
      logChannelId: config.channels.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: null,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'recusada', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'recusada',
      staffId: interaction.user.id,
      motivoEdicao: 'Denúncia recusada',
      acusadoId: null,
      motivoAceite: null,
      dataPunicao: null,
      logMessageId: null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('recusada', interaction.user, interaction.channel.id);

    if (config.channels.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    // DM denunciante
    try {
      const userId = denuncia.criadoPor;
      if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink = messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          await denunciante.send(
            `Sua denúncia foi recusada pela equipe.\n` +
              `Link da denúncia: ${denunciaLink}\n\n` +
              `Se você acredita que sua denúncia foi analisada de forma errada, procure um responsável por denúncias no servidor.\n` +
              `Denúncias podem ser reanalisadas por um responsável, caso haja justificativa.`
          );
        }
      } else {
        log.warn('Não foi possível enviar DM: criadoPor da denúncia é inválido', { userId });
      }
    } catch (dmError) {
      if (dmError?.code !== 50007) log.error('Erro ao enviar DM para o denunciante', dmError);
    }

    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.recusar.emoji} Denúncia recusada com sucesso!`,
    });

    // ✅ aviso único (e mensagens antigas de reanálise/status já serão limpas no manageStatusMessages)
    await sendReanaliseNotice(interaction.channel);
  } catch (error) {
    log.error('Erro ao manejar recusa', error);
    await safeReplyOrEdit(interaction, { content: '❌ Ocorreu um erro ao recusar a denúncia.', flags: [MessageFlags.Ephemeral] });
  }
}

async function handlePunishmentModal(interaction) {
  try {
    if (!interaction.isModalSubmit()) return;
    await safeDefer(interaction, true);

    // Responde imediatamente para evitar timeout
    await safeReplyOrEdit(interaction, { content: '⏳ Processando aceitação...' });

    const denunciaData = denunciasMap.get(interaction.user.id);
    if (!denunciaData) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Dados da denúncia não encontrados. Tente novamente.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const { denuncia, messageUrl } = denunciaData;
    const acusadoId = interaction.fields.getTextInputValue('acusadoId');
    const motivo = interaction.fields.getTextInputValue('motivo');
    const dataPunicao = interaction.fields.getTextInputValue('data');

    const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    if (!dateRegex.test(dataPunicao)) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Formato de data inválido. Use o formato: DD/MM/YYYY',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const config = await Config.findOne({ guildId: interaction.guild.id });
    const logsChannel = config?.channels?.logs ? interaction.client.channels.cache.get(config.channels.logs) : null;

    const logMessage = await manageStatusMessages(interaction.channel, 'aceita', interaction.user, {
      acusadoId,
      motivo,
      dataPunicao,
      messageUrl,
      logChannelId: config?.channels?.logs,
      logsChannel,
      previousStatus: denuncia.status,
      logMessageId: denuncia.logMessageId,
      denuncia,
    });

    await registrarAcaoModerador(interaction.user.id, 'aceita', denuncia._id, interaction.guild.id);
    await updateDenunciaStatus(denuncia._id, {
      status: 'aceita',
      staffId: interaction.user.id,
      motivoEdicao: motivo,
      acusadoId,
      motivoAceite: motivo,
      dataPunicao,
      logMessageId: logMessage ? logMessage.id : denuncia.logMessageId || null,
    });

    const logManager = new LogManager(interaction.client, config);
    const logEmbed = await logManager.createLogEmbed('aceita', interaction.user, interaction.channel.id);

    if (config?.channels?.log) {
      const logChannel = interaction.client.channels.cache.get(config.channels.log);
      if (logChannel) await logChannel.send({ embeds: [logEmbed] });
    }

    // DM denunciante
    try {
      const userId = denuncia.criadoPor;
      if (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') {
        const denunciante = await interaction.client.users.fetch(userId);
        if (denunciante) {
          const denunciaLink = messageUrl || `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          await denunciante.send(
            `Sua denúncia foi aceita pela equipe!\n` +
              `Link da denúncia: ${denunciaLink}\n` +
              `ID do acusado: ${acusadoId}\n` +
              `Motivo: ${motivo}\n` +
              `Data da punição: ${dataPunicao}\n\n` +
              `Se você acredita que sua denúncia foi analisada de forma errada, procure um responsável por denúncias no servidor.\n` +
              `Denúncias podem ser reanalisadas por um responsável, caso haja justificativa.`
          );
        }
      } else {
        log.warn('Não foi possível enviar DM: criadoPor da denúncia é inválido', { userId });
      }
    } catch (dmError) {
      if (dmError?.code !== 50007) log.error('Erro ao enviar DM para o denunciante', dmError);
    }

    // Atualiza resposta
    await safeReplyOrEdit(interaction, {
      content: `${statusConfig.aceitar.emoji} Denúncia aceita com sucesso!`,
    });

    // ✅ aviso único (e mensagens antigas de reanálise/status já serão limpas no manageStatusMessages)
    await sendReanaliseNotice(interaction.channel);

    denunciasMap.delete(interaction.user.id);
  } catch (error) {
    log.error(`[${formatTimeBR(getBrasiliaDate())}] Erro ao processar punição`, error);
    await safeReplyOrEdit(interaction, { content: '❌ Ocorreu um erro ao processar a punição.', flags: [MessageFlags.Ephemeral] });
    denunciasMap.delete(interaction.user.id);
  }
}

async function checkModPermission(interaction, isDeferred = false) {
  try {
    const config = await Config.findOne({ guildId: interaction.guild.id });
    if (!config) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Configurações do servidor não encontradas.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }

    if (!config.roles?.administrador && !config.roles?.responsavel_admin) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Cargos de administração não configurados.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }

    const hasAdminRole = config.roles.administrador &&
      interaction.member.roles.cache.has(config.roles.administrador);

    const hasResponsavelRole = config.roles.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);

    if (!hasAdminRole && !hasResponsavelRole) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Você precisa ter o cargo de administrador ou responsável admin para realizar esta ação.',
        ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
      });
      return false;
    }

    return true;
  } catch (error) {
    log.error('Erro ao verificar permissão', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Erro ao verificar permissões.',
      ...(isDeferred ? {} : { flags: [MessageFlags.Ephemeral] }),
    });
    return false;
  }
}

async function registrarAcaoModerador(moderadorId, acao, denunciaId, guildId) {
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const actionMap = {
      reivindicar: 'reivindicacao',
      aceitar: 'aceita',
      recusar: 'recusada',
      analiser: 'analise',
      analise: 'analise',
    };

    const mappedAction = actionMap[acao] || acao;

    const novaAcao = new ModerationAction({
      moderatorId: moderadorId,
      action: mappedAction,
      denunciaId: denunciaId,
      guildId: guildId,
      weekOf: weekStart,
      weekNumber: ModerationAction.getCurrentWeekNumber(),
      timestamp: now,
    });

    return await novaAcao.save();
  } catch (error) {
    log.error('Erro ao registrar ação', error);
    log.error('Detalhes do erro', { message: error.message, code: error.code, stack: error.stack });
    throw error;
  }
}

async function handleClaimButton(interaction) {
  try {
    if (!interaction.isRepliable()) return;

    await safeDefer(interaction, true);

    const hasPermission = await checkModPermission(interaction, true);
    if (!hasPermission) return;

    const denuncia = await Denuncia.findOne({ threadId: interaction.channel.id }).sort({ createdAt: -1 });
    if (!denuncia) {
      await safeReplyOrEdit(interaction, { content: '❌ Não foi possível encontrar uma denúncia neste canal.' });
      return;
    }

    if (denuncia.claimedBy) {
      if (denuncia.claimedBy === interaction.user.id) {
        await safeReplyOrEdit(interaction, { content: '❌ Você já reivindicou esta denúncia.' });
        return;
      }

      const config = await Config.findOne({ guildId: interaction.guild.id });
      const hasResponsavelRole =
        config?.roles?.responsavel_admin &&
        interaction.member.roles.cache.has(config.roles.responsavel_admin);

      if (!hasResponsavelRole) {
        const claimer = await interaction.client.users.fetch(denuncia.claimedBy);
        await safeReplyOrEdit(interaction, { content: `❌ Esta denúncia já foi reivindicada por ${claimer.tag}` });
        return;
      }
    }

    await Denuncia.findByIdAndUpdate(denuncia._id, {
      claimedBy: interaction.user.id,
      claimedAt: new Date(),
    });

    await registrarAcaoModerador(interaction.user.id, 'reivindicar', denuncia._id, interaction.guild.id);

    const claimMessage = `📝 O administrador ${interaction.user} reivindicou esta denúncia e estará analisando.`;
    await sendOnce(interaction.channel, claimMessage);

    try {
      await interaction.channel.setName(`📝│${interaction.channel.name.replace(/^(📝|❌|✅|🔎)│/, '')}`);
    } catch (error) {
      log.error('Erro ao atualizar nome do canal', error);
    }

    await safeReplyOrEdit(interaction, { content: '✅ Você reivindicou esta denúncia com sucesso!' });
  } catch (error) {
    log.error('Erro ao reivindicar denúncia', error);
    await safeReplyOrEdit(interaction, { content: '❌ Ocorreu um erro ao reivindicar a denúncia.', flags: [MessageFlags.Ephemeral] });
  }
}

module.exports = {
  handleStatusButton,
  handlePunishmentModal,
  denunciasMap,
  handleClaimButton,
};
