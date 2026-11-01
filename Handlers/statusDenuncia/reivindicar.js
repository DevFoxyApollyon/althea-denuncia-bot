// Botão "Reivindicar".
const { MessageFlags, EmbedBuilder, ChannelType } = require('discord.js');
const Denuncia = require('../../models/Denuncia');
const { atualizarStatusNaMensagem } = require('../../utils/atualizarStatus');
const { getConfig: getCachedConfig } = require('../../utils/configCache');
const { safeDefer, safeReplyOrEdit, sendOnce } = require('./mensagensStatus');
const { checkModPermission, registrarAcaoModerador } = require('./acoesStatus');
const { sincronizarBotoes } = require('./botoesStatus');
const { CODIGOS_ESPERADOS, dmPausada, registrarErroDeDM, avisosExtrasLigados } = require('../../utils/dmSegura');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'HandlerStatusButton', debug: false });

const { ESPERA_ENTRE_REIVINDICACOES_MS, esperaEntreReivindicacoesAtiva, tempoRestante } = require('../../utils/esperas');

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

    // Espera entre uma reivindicação e outra (liga e desliga no painel do bot).
    const temCooldown = !isResponsavelAdmin && esperaEntreReivindicacoesAtiva(config, interaction.guild?.id);

    // O cooldown é lido do banco (última reivindicação do staff), então continua
    // valendo depois de um restart do bot.
    if (temCooldown) {
      const ultima = await Denuncia.findOne({
        guildId: interaction.guild.id,
        claimedBy: interaction.user.id,
        claimedAt: { $gt: new Date(Date.now() - ESPERA_ENTRE_REIVINDICACOES_MS) },
      }).sort({ claimedAt: -1 }).select('claimedAt').lean();

      if (ultima?.claimedAt) {
        const restante = ESPERA_ENTRE_REIVINDICACOES_MS - (Date.now() - new Date(ultima.claimedAt).getTime());
        if (restante > 0) {
          await safeReplyOrEdit(interaction, {
            content: `⏳ Você precisa aguardar **${tempoRestante(restante)}** antes de reivindicar outra denúncia.`,
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

    // Em tópico privado, quem reivindica (inclusive pelo site) entra nele.
    if (interaction.channel?.type === ChannelType.PrivateThread) {
      await interaction.channel.members?.add?.(interaction.user.id).catch(() => {});
    }

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
    // O denunciante é avisado por mensagem direta de que alguém pegou o caso.
    if (avisosExtrasLigados() && !dmPausada() && /^\d{15,21}$/.test(String(denuncia.criadoPor || '')) && denuncia.criadoPor !== interaction.user.id) {
      try {
        const denunciante = await interaction.client.users.fetch(denuncia.criadoPor);
        const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
        const campos = [
          { name: '🎯 ID do acusado', value: `\`${denuncia.acusado}\``, inline: true },
          { name: '🔗 Tópico no Discord', value: `[Abrir tópico](https://discord.com/channels/${denuncia.guildId}/${denuncia.threadId})`, inline: false }
        ];
        if (siteUrl) campos.push({ name: '🌐 Acompanhar pelo site', value: `${siteUrl}/#/d/${denuncia._id}`, inline: false });
        await denunciante.send({
          embeds: [new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📌 Sua denúncia foi reivindicada')
            .setDescription(`Um administrador de **${interaction.guild.name}** assumiu a sua denúncia e vai analisar as provas.`)
            .addFields(campos)
            .setFooter({ text: 'Sistema de Denúncias • Brasil RolePlay' })
            .setTimestamp()]
        });
      } catch (dmError) {
        // DM fechada ou limitada pelo Discord é esperado e não é erro do bot.
        registrarErroDeDM(dmError);
        if (!CODIGOS_ESPERADOS.includes(dmError?.code)) log.warn('Não foi possível avisar o denunciante da reivindicação', dmError?.message);
      }
    }

    // Reivindicada: o botão fica desativado para os outros staffs.
    await sincronizarBotoes(interaction.channel, 'reivindicacao', interaction.message);
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
