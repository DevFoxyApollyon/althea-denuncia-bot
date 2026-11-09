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
const { getConfig: getCachedConfig } = require('../utils/configCache');

const CORRIGIR_MODAL_PREFIX = 'corrigir_modal_aceite_';
const RESPONSE_DELETE_DELAY_MS = 5 * 1000;

async function isResponsavelAdmin(interaction, config) {
  const roleId = config?.roles?.responsavel_admin;
  const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(roleId && member?.roles?.cache?.has(roleId));
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
  const config = await getCachedConfig(interaction.guild.id);

  if (!await isResponsavelAdmin(interaction, config)) {
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

// A correção troca só a primeira linha; o que vem depois (link para compartilhar,
// linhas da ponte com o jogo) continua na mensagem.
const linhasDeBaixo = (texto) => {
  const i = String(texto || '').indexOf('\n');
  return i === -1 ? '' : String(texto).slice(i);
};
// Na Cadeia Staff a primeira linha ganha, depois do link, quem confirmou ("||data|| por @x").
const depoisDoLink = (texto) => (String(texto || '').split('\n')[0].match(/Link: ?\|\| ?\S+ ?\|\|(.*)$/) || [])[1] || '';

// Punição para o jogo ainda esperando envio: os jogadores saem de novo do ID e do
// motivo corrigidos (a já enviada ou aplicada não muda). Devolve true se atualizou.
async function atualizarPunicaoDoJogo(client, denuncia) {
  const PontePunicao = require('../models/PontePunicao');
  const punicao = await PontePunicao.findOne({ denunciaId: denuncia._id, status: 'aceita' }).lean();
  if (!punicao) return false;
  const { montarAlvos } = require('../services/ponteSamp/aceite');
  const { tabela } = await require('../services/ponteSamp/motivos').obterTabela();
  const alvos = montarAlvos(denuncia, tabela).filter(a => a.cmd !== 'registro');
  if (!alvos.length) return false;
  const salva = await PontePunicao.findOneAndUpdate(
    { _id: punicao._id, status: 'aceita', versao: punicao.versao },
    { $set: { alvos, 'msgDiscord.motivo': String(denuncia.motivoAceite || '').slice(0, 300) }, $inc: { versao: 1 } },
    { new: true, runValidators: true }
  ).lean();
  if (!salva) return false;
  await require('../services/ponteSamp/discordGm').atualizarMensagemGm(client, salva._id).catch(() => {});
  return true;
}

async function handleSalvarCorrigirDenuncia(interaction) {
  const messageId = getMessageId(interaction.customId);
  const config = await getCachedConfig(interaction.guild.id);

  if (!await isResponsavelAdmin(interaction, config)) {
    return respondAndDelete(interaction, { content: getPermissionError(config) });
  }

  const digitado = interaction.fields.getTextInputValue('acusadoId');
  const acusadoId = require('../services/ponteSamp/validacao').separarContas(digitado).join('+') || digitado.trim();
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
    const denuncia = await Denuncia.findOne({ messageId });

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
    const ponteAtualizada = await atualizarPunicaoDoJogo(interaction.client, denuncia).catch(() => false);

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
          await logMsg.edit(`${newContent}${depoisDoLink(logMsg.content)}${linhasDeBaixo(logMsg.content)}`.slice(0, 2000));
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
        await acceptedMessage.edit({ content: `${newContent}${linhasDeBaixo(acceptedMessage.content)}`.slice(0, 2000), components: [createCorrectionButtonRow()] });
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
            ponteAtualizada ? '🎮 Punição para o jogo atualizada com o ID e o motivo novos.' : '',
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
  createCorrectionButtonRow,
  atualizarPunicaoDoJogo,
  linhasDeBaixo,
  depoisDoLink
};
