// Botão e modal "Add Player".
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../../models/Denuncia');
const { registrarTopicoRestrito } = require('../../utils/restricaoTopicos');
const { getConfig: getCachedConfig } = require('../../utils/configCache');
const { safeDefer, safeReplyOrEdit } = require('./mensagensStatus');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

async function handleAddPlayer(interaction) {
  try {
    if (!interaction.isRepliable()) return;

    const config = await getCachedConfig(interaction.guild.id);
    if (!config) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Configurações do servidor não encontradas.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const isResponsavelAdmin =
      config?.roles?.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);
    const isAdmin =
      config?.roles?.administrador &&
      interaction.member.roles.cache.has(config.roles.administrador);

    if (!isResponsavelAdmin && !isAdmin) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Apenas administradores e responsáveis admin podem adicionar players.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const denuncia = await Denuncia.findOne({
      threadId: interaction.channel.id,
    }).sort({ createdAt: -1 });

    if (!denuncia) {
      await safeReplyOrEdit(interaction, {
        content: '❌ Não foi possível encontrar uma denúncia neste canal.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('add_player_modal')
      .setTitle('Adicionar Player ao Tópico');

    const playerId = new TextInputBuilder()
      .setCustomId('player_id')
      .setLabel('ID ou Conta do Player')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Digite o ID ou conta do player...')
      .setMaxLength(50);

    modal.addComponents(new ActionRowBuilder().addComponents(playerId));

    try {
      await interaction.showModal(modal);
    } catch (error) {
      if (error.code === 'InteractionAlreadyReplied' || error?.code === 10062) {
        log.debug('Modal já foi respondido ou interação expirou');
      }
    }
  } catch (error) {
    log.error('Erro ao abrir modal de adicionar player', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Ocorreu um erro ao abrir o modal.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
}

async function handleAddPlayerModal(interaction) {
  try {
    if (!interaction.isModalSubmit()) return;
    await safeDefer(interaction, true);
    await safeReplyOrEdit(interaction, { content: '⏳ Processando...' });

    const config = await getCachedConfig(interaction.guild.id);
    if (!config) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Configurações do servidor não encontradas.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const playerId = interaction.fields.getTextInputValue('player_id').trim();
    if (!playerId) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ ID do player não pode estar vazio.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const isDiscordId = /^\d{18,19}$/.test(playerId);

    const denuncia = await Denuncia.findOne({
      threadId: interaction.channel.id,
    }).sort({ createdAt: -1 });

    if (!denuncia) {
      return await safeReplyOrEdit(interaction, {
        content: '❌ Não foi possível encontrar a denúncia neste canal.',
        flags: [MessageFlags.Ephemeral],
      });
    }

    let playerUserId = null;
    try {
      const usuario = await require('../../models/Usuario').findOne({
        guildId: interaction.guild.id,
        $or: [{ conta: playerId }, { userId: playerId }],
      }).sort({ updatedAt: -1 });

      if (usuario?.userId) {
        playerUserId = String(usuario.userId);
      } else {
        if (/^\d{18,19}$/.test(playerId)) {
          playerUserId = playerId;
        } else {
          return await safeReplyOrEdit(interaction, {
            content: `❌ Não foi encontrado nenhum player com ID ou conta \`${playerId}\` no banco de dados.`,
            flags: [MessageFlags.Ephemeral],
          });
        }
      }
    } catch (dbError) {
      if (/^\d{18,19}$/.test(playerId)) {
        playerUserId = playerId;
      } else {
        log.error('Erro ao buscar player no banco', dbError);
        return await safeReplyOrEdit(interaction, {
          content: '❌ Erro ao buscar player no banco de dados.',
          flags: [MessageFlags.Ephemeral],
        });
      }
    }

    const currentIds = denuncia.acusadoUserIds || [];
    if (currentIds.includes(playerUserId)) {
      return await safeReplyOrEdit(interaction, {
        content: `✅ O player \`${playerId}\` já estava na lista de autorização.`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    const updatedIds = [...new Set([...currentIds, playerUserId])];

    await Denuncia.findByIdAndUpdate(denuncia._id, {
      $set: {
        acusadoUserIds: updatedIds,
        restritoParticipacao: true,
      },
    });

    registrarTopicoRestrito(denuncia.threadId, denuncia.criadoPor, updatedIds, true);

    const tipoLabel = isDiscordId ? 'Discord' : 'Player';
    const tipoExibicao = isDiscordId ? `<@${playerUserId}>` : `\`${playerId}\``;

    await safeReplyOrEdit(interaction, {
      content: `✅ ${tipoLabel} ${tipoExibicao} adicionado com sucesso à lista de autorização deste tópico!`,
    });

    const confirmMsg = `✅ **Player Autorizado**: O ${tipoLabel} ${tipoExibicao} foi autorizado a falar neste tópico pelo administrador ${interaction.user}.`;
    await interaction.channel.send(confirmMsg).catch((e) => log.warn('Erro ao confirmar no tópico', e?.message));

    try {
      const playerUser = await interaction.client.users.fetch(playerUserId);
      if (playerUser) {
        await playerUser.send(`✅ Você foi autorizado a falar no tópico de denúncia do servidor ${interaction.guild.name} pelo administrador ${interaction.user.tag}.`).catch(() => {});
      }
    } catch (e) {
      log.debug('Não foi possível notificar o player em DM');
    }
  } catch (error) {
    log.error('Erro ao processar modal de adicionar player', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao adicionar o player.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

module.exports = {
  handleAddPlayer,
  handleAddPlayerModal,
};
