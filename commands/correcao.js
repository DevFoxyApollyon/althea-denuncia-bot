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

async function handleCorrecaoCommand(message) {
  const embed = new EmbedBuilder()
    .setTitle('🛠️ Correção de cadeia staff')
    .setDescription(
      'Utilize este painel para **corrigir dados de uma denúncia já aceita**.\n\n' +
      'Você precisará informar o **ID da mensagem de log da cadeia staff**.\n\n' +
      'Clique no botão abaixo para iniciar o processo.'
    )
    .setColor('#5865F2')
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/1828/1828911.png')
    .addFields(
      { name: 'Como usar:', value: '1️⃣ Clique em **Iniciar correção**\n2️⃣ Informe o ID da mensagem da cadeia staff\n3️⃣ Siga as instruções para editar os dados' },
      { name: 'Atenção:', value: 'Apenas membros autorizados podem corrigir denúncias.' }
    )
    .setFooter({ text: 'Sistema de Correção', iconURL: message.client.user.displayAvatarURL() });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_input_id_log_aceite')
      .setLabel('Iniciar correção')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝')
  );

  const sentMsg = await message.reply({ embeds: [embed], components: [row] });
  setTimeout(() => {
    sentMsg.delete().catch(() => {});
  }, 5 * 60 * 1000);
}

async function handleInputIdLogAceite(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_logmessageid_para_correcao_aceite')
    .setTitle('Correção de Cadeia')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('logMessageId')
          .setLabel('ID da mensagem da cadeia staff')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function handleModalLogMessageIdCorrecaoAceite(interaction) {
  const logMessageId = interaction.fields.getTextInputValue('logMessageId').trim();
  const denuncia = await getCachedDenuncia({ logMessageId: logMessageId }, Denuncia);

  if (!denuncia) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription("❌ Não foi encontrada nenhuma cadeia staff para essa ID.")
          .setColor("#e74c3c"),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`salvar_correcao_aceite_${denuncia.messageId}`)
      .setLabel('Editar Cadeia')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📋 Denúncia localizada!')
        .setColor('#57F287')
        .addFields(
          { name: '🆔 ID da denúncia', value: `\`${denuncia.messageId}\``, inline: false },
          { name: '👤 Acusado', value: `${denuncia.acusadoId || denuncia.acusado || 'N/A'}`, inline: true },
          { name: '📄 Motivo', value: `${denuncia.motivoAceite || denuncia.motivo || 'N/A'}`, inline: true },
          { name: '📅 Data', value: `${denuncia.dataPunicao || 'N/A'}`, inline: true }
        )
        .setDescription('Clique no botão abaixo para corrigir os dados da denúncia.')
        .setFooter({ text: 'Sistema de Correção', iconURL: interaction.client.user.displayAvatarURL() })
    ],
    components: [row],
    flags: [MessageFlags.Ephemeral]
  });
  
  setTimeout(() => {
    interaction.fetchReply().then(msg => msg.delete().catch(() => {}));
  }, 5 * 60 * 1000);
}

async function handleEditarAceiteModal(interaction) {
  try {
    const messageId = interaction.customId.replace('salvar_correcao_aceite_', '');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirmar_correcao_aceite_${messageId}`)
        .setLabel('Confirmar')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: '⚠️ Tem certeza que deseja editar a denúncia? Isso atualizará a mensagem de log.',
      components: [row],
      flags: [MessageFlags.Ephemeral]
    });
  } catch (err) {
    console.error(err);
    if (!interaction.replied) {
        await interaction.reply({ content: '❌ Erro ao abrir confirmação.', flags: [MessageFlags.Ephemeral] });
    }
  }
}

async function handleConfirmarCorrecaoAceite(interaction) {
  try {
    const messageId = interaction.customId.replace('confirmar_correcao_aceite_', '');
    const denuncia = await getCachedDenuncia({ messageId }, Denuncia);

    if (!denuncia) {
      return await interaction.reply({ content: '❌ Denúncia não encontrada.', flags: [MessageFlags.Ephemeral] });
    }

    const modal = new ModalBuilder()
      .setCustomId(`salvar_correcao_aceite_${denuncia.messageId}`)
      .setTitle('Corrigir dados')
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
    await interaction.showModal(modal);
  } catch (err) {
    console.error(err);
  }
}

async function handleSalvarCorrecaoAceite(interaction) {
  const messageId = interaction.customId.replace('salvar_correcao_aceite_', '');
  const acusadoId = interaction.fields.getTextInputValue('acusadoId');
  const motivoAceite = interaction.fields.getTextInputValue('motivoAceite');
  const dataPunicao = interaction.fields.getTextInputValue('dataPunicao');
  const staffId = interaction.user.id;

  const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
  if (!dateRegex.test(dataPunicao)) {
    return await interaction.reply({
      content: '❌ Formato de data inválido. Use DD/MM/YYYY',
      flags: [MessageFlags.Ephemeral]
    });
  }

  const denuncia = await getCachedDenuncia({ messageId }, Denuncia);

  if (!denuncia || !denuncia.logMessageId) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setDescription('❌ Mensagem da cadeia staff não encontrada.').setColor('#e74c3c')],
      flags: [MessageFlags.Ephemeral]
    });
  }

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

  let editSuccess = false, logMsgURL = null, errorMsg = '';
  const config = await getCachedConfig(interaction.guild.id, Config);

  if (config?.channels?.logs) {
    const logChannel = await interaction.guild.channels.fetch(config.channels.logs).catch(() => null);
    if (logChannel) {
      try {
        const logMsg = await logChannel.messages.fetch(denuncia.logMessageId).catch(() => null);
        const denunciaChannelId = denuncia.channelId || config.channels.denuncias || interaction.channel.id;
        const denunciaURL = `https://discord.com/channels/${interaction.guild.id}/${denunciaChannelId}/${denuncia.messageId}`;
        const newContent = `➥ Denúncia aceita Acusado (${acusadoId}) tomará punição por (${motivoAceite}) Data ${dataPunicao} Link: ${denunciaURL}`;

        if (logMsg) {
          await logMsg.edit(newContent);
          editSuccess = true;
          logMsgURL = `https://discord.com/channels/${interaction.guild.id}/${logChannel.id}/${denuncia.logMessageId}`;
        } else {
          errorMsg = 'Mensagem de log não encontrada!';
        }

        const threadId = denuncia.threadId || denuncia.channelId;
        const denunciaChannel = await interaction.guild.channels.fetch(threadId).catch(() => null);
        if (denunciaChannel) {
          const msgs = await denunciaChannel.messages.fetch({ limit: 20 });
          const aceiteMsg = msgs.find(m => m.content.startsWith('✅ Denúncia aceita por'));
          const staffMention = `<@${staffId}>`;
          const novaMsg = `✅ Denúncia aceita por ${staffMention} (${acusadoId}) Tomará punição por (${motivoAceite}) Data ${dataPunicao} Link: ${logMsgURL}`;
          
          if (aceiteMsg) {
            await aceiteMsg.edit(novaMsg);
          } else {
            await denunciaChannel.send(novaMsg);
          }
        }
      } catch (e) {
        errorMsg = 'Erro: ' + e.message;
      }
    } else {
      errorMsg = 'Canal de log não encontrado!';
    }
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(editSuccess ? '✅ Cadeia corrigida com sucesso' : '⚠️ Cadeia corrigida, log não atualizado')
        .setDescription(editSuccess && logMsgURL
          ? `Dados atualizados e log editado!\n[🔗 Ver mensagem de log](${logMsgURL})`
          : `Dados atualizados no banco, mas log falhou.\n\nDetalhe: ${errorMsg}`)
        .setColor(editSuccess ? '#27ae60' : '#e67e22')
    ],
    flags: [MessageFlags.Ephemeral]
  });
}

module.exports = {
  handleCorrecaoCommand,
  handleInputIdLogAceite,
  handleModalLogMessageIdCorrecaoAceite,
  handleEditarAceiteModal,
  handleConfirmarCorrecaoAceite,
  handleSalvarCorrecaoAceite
};