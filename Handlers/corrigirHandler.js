const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { getCachedConfig, getCachedDenuncia, invalidateCache } = require('../utils/performance');

const CORRIGIR_MODAL_PREFIX = 'corrigir_modal_aceite_';
const RESPONSE_DELETE_DELAY_MS = 5 * 1000;

function isResponsavelAdmin(interaction, config) {
  return Boolean(
    config?.roles?.responsavel_admin &&
    interaction.member?.roles?.cache.has(config.roles.responsavel_admin)
  );
}

function getPermissionError(config) {
  const cargo = config?.roles?.responsavel_admin
    ? `<@&${config.roles.responsavel_admin}>`
    : '`Responsável Admin não configurado`';
  return `❌ Você não tem permissão para corrigir denúncias. É necessário o cargo ${cargo}.`;
}

function getMessageId(customId) {
  return customId.replace(CORRIGIR_MODAL_PREFIX, '');
}

function createCorrectionButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('corrigir_denuncia_aceita')
      .setLabel('Corrigir dados')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createCorrectionModal(denuncia) {
  return new ModalBuilder()
    .setCustomId(`${CORRIGIR_MODAL_PREFIX}${denuncia.messageId}`)
    .setTitle('Corrigir denúncia aceita')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('acusadoId')
          .setLabel('ID do Acusado')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(denuncia.acusadoId || denuncia.acusado || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('motivoAceite')
          .setLabel('Motivo da Punição')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(denuncia.motivoAceite || denuncia.motivo || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dataPunicao')
          .setLabel('Data da Punição (DD/MM/YYYY)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(denuncia.dataPunicao || '')
      )
    );
}

async function respondAndDelete(interaction, payload) {
  const response = interaction.deferred || interaction.replied
    ? await interaction.editReply(payload)
    : await interaction.reply({ ...payload, flags: [MessageFlags.Ephemeral] });

  setTimeout(() => interaction.deleteReply().catch(() => {}), RESPONSE_DELETE_DELAY_MS);
  return response;
}

async function handleCorrigirDenunciaButton(interaction) {
  const config = await getCachedConfig(interaction.guild.id, Config);

  if (!isResponsavelAdmin(interaction, config)) {
    return respondAndDelete(interaction, { content: getPermissionError(config) });
  }

  const denuncia = await Denuncia.findOne({
    guildId: interaction.guild.id,
    threadId: interaction.channel.id
  });

  if (!denuncia) {
    return respondAndDelete(interaction, {
      content: '❌ Esta mensagem não está vinculada a uma denúncia.'
    });
  }

  if (denuncia.status !== 'aceita') {
    return respondAndDelete(interaction, {
      content: '❌ Apenas denúncias aceitas podem ser corrigidas.'
    });
  }

  await interaction.showModal(createCorrectionModal(denuncia));
}

async function handleSalvarCorrigirDenuncia(interaction) {
  const messageId = getMessageId(interaction.customId);
  const config = await getCachedConfig(interaction.guild.id, Config);

  if (!isResponsavelAdmin(interaction, config)) {
    return respondAndDelete(interaction, { content: getPermissionError(config) });
  }

  const acusadoId = interaction.fields.getTextInputValue('acusadoId').trim();
  const motivoAceite = interaction.fields.getTextInputValue('motivoAceite').trim();
  const dataPunicao = interaction.fields.getTextInputValue('dataPunicao').trim();
  const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;

  if (!dateRegex.test(dataPunicao)) {
    return respondAndDelete(interaction, {
      content: '❌ Formato de data inválido. Use DD/MM/YYYY.'
    });
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const denuncia = await getCachedDenuncia({ messageId }, Denuncia);

    if (!denuncia || denuncia.status !== 'aceita') {
      return respondAndDelete(interaction, {
        content: '❌ Apenas denúncias aceitas podem ser corrigidas.'
      });
    }

    if (!denuncia.logMessageId) {
      return respondAndDelete(interaction, {
        content: '❌ Esta denúncia não possui uma mensagem de log vinculada.'
      });
    }

    const staffId = interaction.user.id;
    denuncia.acusadoId = acusadoId;
    denuncia.motivoAceite = motivoAceite;
    denuncia.dataPunicao = dataPunicao;
    denuncia.ultimaEdicao = { staffId, data: new Date(), motivoEdicao: motivoAceite };
    if (!Array.isArray(denuncia.historico)) denuncia.historico = [];
    denuncia.historico.push({
      acao: 'correcao_aceite',
      staffId,
      data: new Date(),
      detalhes: { novo: { acusadoId, motivoAceite, dataPunicao } }
    });

    await denuncia.save();
    invalidateCache('denuncia', denuncia._id);

    let logEdited = false;
    let topicEdited = false;
    let logMsgURL = null;
    const errors = [];

    if (config?.channels?.logs) {
      const logChannel = await interaction.guild.channels.fetch(config.channels.logs).catch(() => null);
      if (logChannel) {
        const logMsg = await logChannel.messages.fetch(denuncia.logMessageId).catch(() => null);
        const denunciaURL = `https://discord.com/channels/${interaction.guild.id}/${denuncia.channelId}/${denuncia.messageId}`;
        const newContent = `➱ Denúncia aceita Acusado (${acusadoId}) tomará punição por (${motivoAceite}) Data ${dataPunicao} Link: ||${denunciaURL}||`;

        if (logMsg) {
          await logMsg.edit(newContent);
          logEdited = true;
          logMsgURL = `https://discord.com/channels/${interaction.guild.id}/${logChannel.id}/${denuncia.logMessageId}`;
        } else {
          errors.push('mensagem de log não encontrada');
        }
      } else {
        errors.push('canal de log não encontrado');
      }
    } else {
      errors.push('canal de log não configurado');
    }

    const topic = await interaction.guild.channels.fetch(denuncia.threadId).catch(() => null);
    if (topic) {
      const messages = await topic.messages.fetch({ limit: 50 });
      const acceptedMessage = messages.find(message =>
        message.author?.id === interaction.client.user.id &&
        message.content.startsWith('✅ Denúncia aceita por')
      );
      const denunciaURL = `https://discord.com/channels/${interaction.guild.id}/${denuncia.channelId}/${denuncia.messageId}`;
      const newContent = `✅ Denúncia aceita por <@${staffId}> (${acusadoId}) tomará punição por (${motivoAceite}) Data ${dataPunicao} Link: ${logMsgURL || denunciaURL}`;

      if (acceptedMessage) {
        await acceptedMessage.edit({ content: newContent, components: [createCorrectionButtonRow()] });
        topicEdited = true;
      } else {
        errors.push('mensagem de aceite não encontrada no tópico');
      }
    } else {
      errors.push('tópico não encontrado');
    }

    return respondAndDelete(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle(logEdited && topicEdited ? '✅ Denúncia corrigida' : '⚠️ Correção salva com ressalvas')
          .setDescription([
            'Os dados foram atualizados no banco de dados.',
            logEdited ? '✅ Canal de logs atualizado.' : '❌ O canal de logs não foi atualizado.',
            topicEdited ? '✅ Mensagem do tópico atualizada.' : '❌ Mensagem do tópico não foi atualizada.',
            errors.length ? `Detalhes: ${errors.join('; ')}` : ''
          ].filter(Boolean).join('\n'))
          .setColor(logEdited && topicEdited ? '#27ae60' : '#e67e22')
      ]
    });
  } catch (error) {
    console.error('Erro ao salvar correção da denúncia:', error);
    return respondAndDelete(interaction, { content: '❌ Erro ao corrigir a denúncia.' });
  }
}

module.exports = {
  handleCorrigirDenunciaButton,
  handleSalvarCorrigirDenuncia,
  createCorrectionButtonRow
};
