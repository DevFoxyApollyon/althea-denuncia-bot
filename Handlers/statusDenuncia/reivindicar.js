// Botão "Reivindicar".
const { MessageFlags } = require('discord.js');
const Denuncia = require('../../models/Denuncia');
const { atualizarStatusNaMensagem } = require('../../utils/atualizarStatus');
const { getConfig: getCachedConfig } = require('../../utils/configCache');
const { safeDefer, safeReplyOrEdit, sendOnce } = require('./mensagensStatus');
const { checkModPermission, registrarAcaoModerador } = require('./acoesStatus');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

const CLAIM_COOLDOWN_MS = 6 * 60 * 1000;
// Servidores onde o staff precisa esperar entre uma reivindicação e outra.
// Configurável pelo .env (IDs separados por vírgula).
const CLAIM_COOLDOWN_GUILD_IDS = new Set(
  (process.env.CLAIM_COOLDOWN_GUILD_IDS ?? '817924556358156360')
    .split(/[\s,;]+/)
    .filter(Boolean)
);

async function handleClaimButton(interaction) {
  try {
    if (!interaction.isRepliable()) return;
    await safeDefer(interaction, true);

    const hasPermission = await checkModPermission(interaction, true);
    if (!hasPermission) return;

    const config = await getCachedConfig(interaction.guild.id);

    const isResponsavelAdmin =
      config?.roles?.responsavel_admin &&
      interaction.member.roles.cache.has(config.roles.responsavel_admin);

    const temCooldown = !isResponsavelAdmin && CLAIM_COOLDOWN_GUILD_IDS.has(interaction.guild?.id);

    // O cooldown é lido do banco (última reivindicação do staff), então continua
    // valendo depois de um restart do bot.
    if (temCooldown) {
      const ultima = await Denuncia.findOne({
        guildId: interaction.guild.id,
        claimedBy: interaction.user.id,
        claimedAt: { $gt: new Date(Date.now() - CLAIM_COOLDOWN_MS) },
      }).sort({ claimedAt: -1 }).select('claimedAt').lean();

      if (ultima?.claimedAt) {
        const remaining = Math.ceil((CLAIM_COOLDOWN_MS - (Date.now() - new Date(ultima.claimedAt).getTime())) / 1000);
        if (remaining > 0) {
          const minutes = Math.floor(remaining / 60);
          const seconds = remaining % 60;
          const tempoRestante = minutes > 0
            ? `${minutes}m ${seconds}s`
            : `${seconds}s`;
          await safeReplyOrEdit(interaction, {
            content: `⏳ Você precisa aguardar **${tempoRestante}** antes de reivindicar outra denúncia.`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
      }
    }

    const denuncia = await Denuncia.findOneAndUpdate(
      {
        threadId: interaction.channel.id,
        $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
      },
      {
        $set: {
          claimedBy: interaction.user.id,
          claimedAt: new Date(),
          status: 'reivindicacao',
        },
      },
      { new: true, sort: { createdAt: -1 } }
    );

    if (!denuncia) {
      const exists = await Denuncia.findOne({ threadId: interaction.channel.id });
      if (!exists) {
        await safeReplyOrEdit(interaction, {
          content: '❌ Não foi possível encontrar uma denúncia neste canal.',
        });
        return;
      }

      const claimedDenuncia = await Denuncia.findOne({ threadId: interaction.channel.id }).sort({ createdAt: -1 });

      if (claimedDenuncia?.claimedBy === interaction.user.id) {
        await safeReplyOrEdit(interaction, { content: '❌ Você já reivindicou esta denúncia.' });
        return;
      }

      const claimer = await interaction.client.users.fetch(claimedDenuncia?.claimedBy).catch(() => null);
      await safeReplyOrEdit(interaction, {
        content: `❌ Esta denúncia já foi reivindicada por ${claimer ? claimer.tag : 'outro moderador'}.`,
      });
      return;
    }

    await registrarAcaoModerador(interaction.user.id, 'reivindicar', denuncia._id, interaction.guild.id);

    const claimMessage = `📌 O administrador ${interaction.user} reivindicou esta denúncia e estará analisando.`;
    await sendOnce(interaction.channel, claimMessage);

    try {
      await interaction.channel.setName(`📌│${interaction.channel.name.replace(/^(📌|❌|✅|🔎)│/, '')}`);
    } catch (error) {
      log.error('Erro ao atualizar nome do canal', error);
    }

    await safeReplyOrEdit(interaction, { content: '✅ Você reivindicou esta denúncia com sucesso!' });

    try {
      await atualizarStatusNaMensagem(interaction.client, denuncia, 'reivindicacao');
    } catch (e) {
      log.warn('Falha ao atualizar status na mensagem principal (reivindicacao)', e?.message);
    }
  } catch (error) {
    log.error('Erro ao reivindicar denúncia', error);
    await safeReplyOrEdit(interaction, {
      content: '❌ Ocorreu um erro ao reivindicar a denúncia.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

module.exports = {
  handleClaimButton,
};
