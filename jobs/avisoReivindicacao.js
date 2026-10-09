const Denuncia = require('../models/Denuncia');
const { EmbedBuilder } = require('discord.js');
const { getCachedConfig } = require('../utils/performance');
const { getBrasiliaDate } = require('../utils/dateUtils');
const { processarAnaliseAutomatica } = require('../Handlers/handlerStatusButton');

const CLAIM_WARNING_MS = 15 * 60 * 1000;
const AUTO_ANALYSIS_MS = 30 * 60 * 1000;
const WARNING_MESSAGE_TTL_MS = 10 * 60 * 1000;
const AUTO_ANALYSIS_MESSAGE_TTL_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

let running = false;
let interval = null;

async function fetchChannel(client, channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId) || client.channels.fetch(channelId).catch(() => null);
}

async function sendTemporaryWarning(channel, content, ttl = WARNING_MESSAGE_TTL_MS) {
  if (!channel?.isTextBased?.()) {
    throw new Error('Canal indisponível');
  }

  const message = await channel.send(content);
  setTimeout(() => {
    message.delete().catch((error) => {
      if (error?.code !== 10008) {
        console.error('[AvisoReivindicacao] Falha ao remover aviso:', error?.message);
      }
    });
  }, ttl);

  return message;
}

async function limparAvisosExpirados(client) {
  const agora = getBrasiliaDate();
  const avisos = await Denuncia.find({
    claimedWarningMessageId: { $nin: [null, ''] },
    claimedWarningExpiresAt: { $ne: null, $lte: agora },
  }).select({
    _id: 1,
    threadId: 1,
    claimedWarningMessageId: 1,
  }).limit(100).lean();

  for (const aviso of avisos) {
    const topic = await fetchChannel(client, aviso.threadId);
    const message = topic?.messages?.fetch
      ? await topic.messages.fetch(aviso.claimedWarningMessageId).catch(() => null)
      : null;

    if (message) {
      await message.delete().catch((error) => {
        if (error?.code !== 10008) {
          console.error('[AvisoReivindicacao] Falha ao remover aviso expirado:', error?.message);
        }
      });
    }

    await Denuncia.updateOne(
      { _id: aviso._id },
      { $unset: { claimedWarningMessageId: 1, claimedWarningExpiresAt: 1 } }
    );
  }
}

async function limparAvisosAnaliseExpirados(client) {
  const avisos = await Denuncia.find({
    autoAnalysisMessageId: { $nin: [null, ''] },
    autoAnalysisExpiresAt: { $ne: null, $lte: getBrasiliaDate() },
  }).select({
    _id: 1,
    threadId: 1,
    autoAnalysisMessageId: 1,
  }).limit(100).lean();

  for (const aviso of avisos) {
    const topic = await fetchChannel(client, aviso.threadId);
    const message = topic?.messages?.fetch
      ? await topic.messages.fetch(aviso.autoAnalysisMessageId).catch(() => null)
      : null;

    if (message) await message.delete().catch(() => {});
    await Denuncia.updateOne(
      { _id: aviso._id },
      { $unset: { autoAnalysisMessageId: 1, autoAnalysisExpiresAt: 1 } }
    );
  }
}

async function verificarReivindicacoesSemAnalise(client) {
  if (running) return;
  running = true;

  try {
    await limparAvisosExpirados(client);
    await limparAvisosAnaliseExpirados(client);

    const limite = new Date(Date.now() - CLAIM_WARNING_MS);
    const candidatas = await Denuncia.find({
      status: 'reivindicacao',
      claimedBy: { $nin: [null, ''] },
      claimedAt: { $ne: null, $lte: limite },
      claimedReminderSentAt: null,
    }).select({
      _id: 1,
      guildId: 1,
      threadId: 1,
      channelId: 1,
      messageId: 1,
      claimedBy: 1,
      claimedAt: 1,
      acusado: 1,
      motivo: 1,
    }).limit(50).lean();

    for (const candidata of candidatas) {
      const marcada = await Denuncia.findOneAndUpdate(
        {
          _id: candidata._id,
          status: 'reivindicacao',
          claimedReminderSentAt: null,
        },
        { $set: { claimedReminderSentAt: getBrasiliaDate() } },
        { new: true }
      ).lean();

      if (!marcada) continue;

      const guild = client.guilds.cache.get(candidata.guildId);
      const config = await getCachedConfig(candidata.guildId);
      const topic = await fetchChannel(client, candidata.threadId);
      const logsChannel = await fetchChannel(client, config?.channels?.log);
      const claimedStaff = await client.users.fetch(candidata.claimedBy).catch(() => null);
      const staffMention = `<@${candidata.claimedBy}>`;
      const topicMention = `<#${candidata.threadId}>`;
      const reportLink = guild
        ? `https://discord.com/channels/${candidata.guildId}/${candidata.channelId}/${candidata.messageId}`
        : '';

      const claimedAt = candidata.claimedAt
        ? new Date(candidata.claimedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : 'Não informado';
      const topicEmbed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('⚠️ Denúncia aguardando análise')
        .setDescription(`${staffMention}, esta denúncia foi reivindicada há mais de **15 minutos** e ainda não foi colocada em análise.`)
        .addFields(
          { name: 'Responsável', value: staffMention, inline: true },
          { name: 'Reivindicada em', value: claimedAt, inline: true },
          { name: 'Próxima ação', value: 'Verifique o caso e coloque a denúncia em análise.', inline: false },
        )
        .setFooter({ text: 'Este aviso será removido automaticamente em 10 minutos.' })
        .setTimestamp();

      const logEmbed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('⚠️ Denúncia sem resposta')
        .setDescription('Uma denúncia foi reivindicada, mas continua sem análise após 15 minutos.')
        .addFields(
          { name: 'Responsável', value: staffMention, inline: true },
          { name: 'Tópico', value: topicMention, inline: true },
          { name: 'Acusado', value: candidata.acusado || 'Não informado', inline: true },
          { name: 'Motivo', value: String(candidata.motivo || 'Não informado').slice(0, 1024), inline: false },
          { name: 'Reivindicada em', value: claimedAt, inline: true },
          { name: 'Acessar denúncia', value: reportLink ? `[Abrir denúncia](${reportLink})` : 'Link indisponível', inline: true },
        )
        .setFooter({ text: 'Registro de acompanhamento da moderação.' })
        .setTimestamp();

      const dmEmbed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('⚠️ Denúncia aguardando sua análise')
        .setDescription('Você reivindicou esta denúncia há mais de **15 minutos**, mas ela ainda não foi colocada em análise.')
        .addFields(
          { name: 'Acusado', value: candidata.acusado || 'Não informado', inline: true },
          { name: 'Reivindicada em', value: claimedAt, inline: true },
          { name: 'Motivo', value: String(candidata.motivo || 'Não informado').slice(0, 1024), inline: false },
          { name: 'Acessar denúncia', value: reportLink ? `[Abrir denúncia](${reportLink})` : 'Link indisponível', inline: false },
        )
        .setFooter({ text: 'Verifique o caso e coloque a denúncia em análise.' })
        .setTimestamp();

      const results = await Promise.allSettled([
        sendTemporaryWarning(topic, {
          embeds: [topicEmbed],
          allowedMentions: { users: [candidata.claimedBy] },
        }),
        logsChannel?.isTextBased?.()
          ? logsChannel.send({ embeds: [logEmbed] })
          : Promise.reject(new Error('Canal de logs indisponível')),
        claimedStaff
          ? claimedStaff.send({ embeds: [dmEmbed] })
          : Promise.reject(new Error('Administrador reivindicante indisponível')),
      ]);

      const topicResult = results[0];
      if (topicResult.status === 'fulfilled') {
        await Denuncia.updateOne(
          { _id: candidata._id },
          {
            $set: {
              claimedWarningMessageId: topicResult.value.id,
              claimedWarningExpiresAt: new Date(Date.now() + WARNING_MESSAGE_TTL_MS),
            },
          }
        );
      }

      if (results.some((result) => result.status === 'rejected')) {
        console.error(`[AvisoReivindicacao] Falha ao enviar alerta da denúncia ${candidata._id}`);
      }
    }

    await colocarReivindicacoesEmAnalise(client);
  } catch (error) {
    console.error('[AvisoReivindicacao] Erro ao verificar reivindicações:', error);
  } finally {
    running = false;
  }
}

async function colocarReivindicacoesEmAnalise(client) {
  const limite = new Date(Date.now() - AUTO_ANALYSIS_MS);
  const candidatas = await Denuncia.find({
    status: 'reivindicacao',
    claimedBy: { $nin: [null, ''] },
    claimedAt: { $ne: null, $lte: limite },
    autoAnalysisAt: null,
  }).select({
    _id: 1,
    guildId: 1,
    threadId: 1,
    channelId: 1,
    messageId: 1,
    claimedBy: 1,
    claimedAt: 1,
    acusado: 1,
    motivo: 1,
  }).limit(50).lean();

  for (const candidata of candidatas) {
    const agora = getBrasiliaDate();
    const reservada = await Denuncia.findOneAndUpdate(
      {
        _id: candidata._id,
        status: 'reivindicacao',
        autoAnalysisAt: null,
      },
      {
        $set: { autoAnalysisAt: agora },
      },
      { new: true }
    );

    if (!reservada) continue;

    const config = await getCachedConfig(candidata.guildId);
    const topic = await fetchChannel(client, candidata.threadId);
    const staffMention = `<@${candidata.claimedBy}>`;
    const topicMention = `<#${candidata.threadId}>`;
    const claimedAt = candidata.claimedAt
      ? new Date(candidata.claimedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'Não informado';

    const processada = await processarAnaliseAutomatica(client, reservada.toObject(), config);
    if (!processada) {
      await Denuncia.updateOne({ _id: candidata._id }, { $unset: { autoAnalysisAt: 1 } });
      continue;
    }

    const analysisEmbed = new EmbedBuilder()
      .setColor('#3498DB')
      .setTitle('🔎 Denúncia colocada em análise automaticamente')
      .setDescription(`A denúncia ficou mais de **30 minutos** sem análise após ser reivindicada. Ela foi encaminhada automaticamente para análise de ${staffMention}.`)
      .addFields(
        { name: 'Responsável', value: staffMention, inline: true },
        { name: 'Tópico', value: topicMention, inline: true },
        { name: 'Acusado', value: candidata.acusado || 'Não informado', inline: true },
        { name: 'Reivindicada em', value: claimedAt, inline: true },
        { name: 'Ação', value: 'O fluxo normal do botão de análise foi executado.', inline: true },
      )
      .setFooter({ text: 'Status alterado automaticamente pelo sistema.' })
      .setTimestamp();

    const analysisMessage = topic?.isTextBased?.()
      ? await sendTemporaryWarning(topic, {
        embeds: [analysisEmbed],
        allowedMentions: { users: [candidata.claimedBy] },
      }, AUTO_ANALYSIS_MESSAGE_TTL_MS).catch(() => null)
      : null;

    if (analysisMessage) {
      await Denuncia.updateOne(
        { _id: candidata._id },
        {
          $set: {
            autoAnalysisMessageId: analysisMessage.id,
            autoAnalysisExpiresAt: new Date(Date.now() + AUTO_ANALYSIS_MESSAGE_TTL_MS),
          },
        }
      );
    }
  }
}

function iniciarAvisoReivindicacao(client) {
  if (interval) return;

  setTimeout(() => verificarReivindicacoesSemAnalise(client), CHECK_INTERVAL_MS);
  interval = setInterval(() => verificarReivindicacoesSemAnalise(client), CHECK_INTERVAL_MS);
}

module.exports = { iniciarAvisoReivindicacao, verificarReivindicacoesSemAnalise };
