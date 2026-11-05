// /desbanir: formulário com o link da denúncia; se o bot já aplicou a punição dela,
// mostra a denúncia (só para quem usou) com o botão "Desbanir", que manda a
// gamemode rodar /desbanir <conta> em cada jogador banido nela. Só o responsável usa.
const {
  MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require('discord.js');
const { getConfig: getCachedConfig } = require('../utils/configCache');
const { lerLinkDoDiscord } = require('./link');
const { prepararDesbanimento, desbanir } = require('../services/ponteSamp/desbanirGm');
const { punicaoLegivel } = require('../services/ponteSamp/avisoOrganizacao');

const MODAL_DESBANIR = 'desbanir_modal';
const BOTAO_DESBANIR = 'ponte_gm_desbanir:';
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });

async function ehResponsavel(interaction) {
  const config = await getCachedConfig(interaction.guild.id);
  const cargo = config?.roles?.responsavel_admin;
  return !!cargo && (interaction.member?.roles?.cache?.has?.(cargo) || interaction.member?.roles?.includes?.(cargo));
}
const SEM_PERMISSAO = '🚫 Só o responsável pode desbanir pelo bot.';

async function handleDesbanirSlash(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  const campo = new TextInputBuilder()
    .setCustomId('link').setLabel('Link da denúncia (tópico ou mensagem)')
    .setPlaceholder('https://discord.com/channels/...').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
  return interaction.showModal(new ModalBuilder().setCustomId(MODAL_DESBANIR).setTitle('Desbanir pelo bot')
    .addComponents(new ActionRowBuilder().addComponents(campo)));
}

const ROTULO_ESTADO = { pode: 'punido', andamento: '⏳ em andamento', desbanido: '✅ já desfeito' };
const ACAO_DO_TIPO = { desbanir: 'desbanir', soltar: 'soltar (cadeia com tempo 0)' };

function telaDoDesbanimento({ denuncia, punicao, alvos }, servidor) {
  const podem = alvos.filter(a => a.estado === 'pode' && a.conta > 0);
  const embed = new EmbedBuilder()
    .setColor('#1C7ED6')
    .setAuthor({ name: `Desbanir pelo bot${servidor?.name ? ` · ${servidor.name}` : ''}`.slice(0, 256), iconURL: servidor?.iconURL?.() || undefined })
    .setTitle('🔓  Confirmar desbanimento')
    .setDescription([
      `👤 **Acusado:** ${String(denuncia.acusado || '?').slice(0, 200)}`,
      denuncia.motivo ? `📝 **Motivo da denúncia:** ${String(denuncia.motivo).slice(0, 200)}` : '',
      punicao.aplicadaEm ? `📅 **Banido em:** <t:${Math.floor(new Date(punicao.aplicadaEm).getTime() / 1000)}:f>` : '',
      punicao.msgDiscord?.link ? `🔗 [Abrir denúncia](${punicao.msgDiscord.link})` : ''
    ].filter(Boolean).join('\n'))
    .addFields(alvos.slice(0, 20).map(a => ({
      name: `👤 ${a.nick || 'Jogador'} (${a.conta || '?'})`,
      value: `⚖️ ${punicaoLegivel(a.alvo) || 'Ban'} · ${ROTULO_ESTADO[a.estado]}${a.estado === 'pode' ? ` · vai ${ACAO_DO_TIPO[a.tipo]}${Number(a.alvo.avisos) > 0 ? ` e tirar ${a.alvo.avisos} aviso(s)` : ''}` : ''}`,
      inline: false
    })))
    .setFooter({ text: podem.length ? `O jogo vai desfazer a punição de ${podem.length} conta(s).` : 'Nada para desfazer.' });
  const botao = new ButtonBuilder()
    .setCustomId(`${BOTAO_DESBANIR}${punicao._id}`)
    .setLabel(podem.length > 1 ? `Desfazer ${podem.length} punições` : podem[0]?.tipo === 'soltar' ? 'Soltar' : 'Desbanir')
    .setEmoji('🔓').setStyle(ButtonStyle.Danger).setDisabled(!podem.length);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(botao)] };
}

async function handleDesbanirModal(interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  if (!await ehResponsavel(interaction)) return interaction.editReply(SEM_PERMISSAO);
  const link = lerLinkDoDiscord(interaction.fields.getTextInputValue('link'));
  if (!link) return interaction.editReply('❌ Link inválido. Cole o link do tópico ou de uma mensagem da denúncia.');
  if (link.guildId !== interaction.guild.id) return interaction.editReply('❌ Esse link é de outro servidor.');
  const r = await prepararDesbanimento(interaction.guild.id, link);
  if (r.erro) return interaction.editReply(`❌ ${r.erro}`);
  return interaction.editReply(telaDoDesbanimento(r, interaction.guild));
}

async function handleDesbanirBotao(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  const punicaoId = interaction.customId.slice(BOTAO_DESBANIR.length);
  if (!/^[0-9a-f]{24}$/.test(punicaoId)) return interaction.reply(efemero('❌ Botão inválido.'));
  await interaction.deferUpdate();
  const staff = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username };
  const r = await desbanir({ client: interaction.client, punicaoId, guildId: interaction.guild.id, staff }).catch(() => ({ erro: 'Não foi possível criar o pedido. Tente de novo.' }));
  // Punição desfeita: a denúncia vira recusada, como no botão Recusar.
  const recusada = r.erro ? false : await recusarDenuncia(interaction, punicaoId).catch(() => false);
  const texto = r.erro
    ? `❌ ${r.erro}`
    : `📤 Pedido enviado à gamemode: ${r.contas.map(c => `\`${c}\``).join(', ')}.${r.teste ? ' 🧪 Modo teste ligado: a gamemode só vai simular.' : ''}${r.avisosFicam ? ' ⚠️ Os avisos não serão tirados: a gamemode ainda está com a include 1.0.0.' : ''} O resultado sai no Relatório de punições.${recusada ? ' ❌ A denúncia foi marcada como recusada.' : ''}`;
  return interaction.editReply({ content: texto, embeds: interaction.message.embeds, components: r.erro ? interaction.message.components : [] });
}

// A denúncia (ou a prova da staff) da punição desfeita passa a recusada.
async function recusarDenuncia(interaction, punicaoId) {
  const PontePunicao = require('../models/PontePunicao');
  const punicao = await PontePunicao.findById(punicaoId, { denunciaId: 1 }).lean();
  if (!punicao) return false;
  const pessoa = { client: interaction.client, guild: interaction.guild, member: interaction.member, user: interaction.user };
  if (await require('../Handlers/statusDenuncia/acoesStatus').recusarDenunciaDesfeita({ ...pessoa, denunciaId: punicao.denunciaId })) return true;
  // Provas da staff: marca recusada e atualiza o registro no canal.
  const DenunciaStaff = require('../models/DenunciaStaff');
  const doc = await DenunciaStaff.findOneAndUpdate(
    { _id: punicao.denunciaId, status: { $ne: 'recusada' } },
    { $set: { status: 'recusada', decididoPor: { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username, em: new Date() } } },
    { new: true }
  ).lean();
  if (!doc) return false;
  const canal = doc.channelId ? await interaction.client.channels.fetch(doc.channelId).catch(() => null) : null;
  const msg = canal?.messages ? await canal.messages.fetch(doc.messageId).catch(() => null) : null;
  if (msg) await msg.edit({ content: msg.content.replace(/➥ Status: .*$/m, `➥ Status: \`Recusada (punição desfeita)\` por ${interaction.user}`), components: [], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

module.exports = { MODAL_DESBANIR, BOTAO_DESBANIR, handleDesbanirSlash, handleDesbanirModal, handleDesbanirBotao };
