// /link: a pessoa manda o link de um tópico privado de denúncia (ou de qualquer
// mensagem dentro dele), que aparece como "#desconhecido" para quem não está no
// tópico. O comando devolve o link da mensagem principal da denúncia no canal,
// que todos conseguem abrir, e o botão de entrar no tópico. Só administrador e
// responsável usam; o link vai num formulário e a resposta só quem usou vê.
const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const { getConfig: getCachedConfig } = require('../utils/configCache');
const { botaoEntrarNoTopico, linkDaMensagemPrincipal } = require('../utils/restricaoTopicos');

// https://discord.com/channels/<servidor>/<canal ou tópico>[/<mensagem>]
// (também ptb., canary. e discordapp.com).
function lerLinkDoDiscord(texto) {
    const achado = String(texto || '').match(/https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,21})\/(\d{15,21})(?:\/(\d{15,21}))?/i);
    if (!achado) return null;
    return { guildId: achado[1], canalId: achado[2], mensagemId: achado[3] || null };
}

const MODAL_LINK = 'link_modal';

async function podeUsar(interaction) {
    const config = await getCachedConfig(interaction.guild.id);
    const cargos = [config?.roles?.administrador, config?.roles?.responsavel_admin].filter(Boolean);
    return cargos.some(id => interaction.member?.roles?.cache?.has?.(id) || interaction.member?.roles?.includes?.(id));
}

// /link abre o formulário para colar o link.
async function handleLinkSlash(interaction) {
    if (!await podeUsar(interaction)) {
        return interaction.reply({ content: '🚫 Só quem tem o cargo de administrador ou de responsável pode usar este comando.', flags: [MessageFlags.Ephemeral] });
    }
    const campo = new TextInputBuilder()
        .setCustomId('link')
        .setLabel('Link do tópico ou de uma mensagem dele')
        .setPlaceholder('https://discord.com/channels/...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);
    return interaction.showModal(new ModalBuilder()
        .setCustomId(MODAL_LINK)
        .setTitle('Achar denúncia pelo link')
        .addComponents(new ActionRowBuilder().addComponents(campo)));
}

async function handleLinkModal(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    if (!await podeUsar(interaction)) {
        return interaction.editReply('🚫 Só quem tem o cargo de administrador ou de responsável pode usar este comando.');
    }

    const link = lerLinkDoDiscord(interaction.fields.getTextInputValue('link'));
    if (!link) return interaction.editReply('❌ Link inválido. Cole o link do tópico ou de uma mensagem dele, como `https://discord.com/channels/...`.');
    if (link.guildId !== interaction.guild.id) return interaction.editReply('❌ Esse link é de outro servidor.');

    // O link pode ser do tópico, de uma mensagem dentro dele ou da própria
    // mensagem principal no canal.
    const filtros = [{ threadId: link.canalId }];
    if (link.mensagemId) filtros.push({ messageId: link.mensagemId });
    const denuncia = await Denuncia.findOne({ guildId: interaction.guild.id, $or: filtros })
        .select('guildId channelId messageId threadId acusado status')
        .lean();
    if (!denuncia) return interaction.editReply('❌ Não achei nenhuma denúncia com esse link.');

    const principal = linkDaMensagemPrincipal(interaction.guild.id, denuncia);
    const topico = denuncia.threadId ? `https://discord.com/channels/${interaction.guild.id}/${denuncia.threadId}` : null;
    return interaction.editReply({
        content: [
            '🔗 **Denúncia encontrada**',
            principal ? `➱ **Mensagem principal**: ${principal}` : '➱ **Mensagem principal**: indisponível',
            topico ? `➱ **Tópico**: ${topico}` : null,
            denuncia.acusado ? `➱ **Acusado**: \`${denuncia.acusado}\`` : null,
            denuncia.status ? `➱ **Status**: \`${denuncia.status}\`` : null
        ].filter(Boolean).join('\n'),
        components: denuncia.threadId ? [botaoEntrarNoTopico(denuncia.threadId)] : [],
        allowedMentions: { parse: [] }
    });
}

module.exports = { MODAL_LINK, handleLinkSlash, handleLinkModal, lerLinkDoDiscord };
