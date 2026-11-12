// /desbanir: formulário com o link da denúncia; se o bot já aplicou a punição dela,
// mostra a denúncia (só para quem usou) com o botão "Desbanir", que manda a
// gamemode desbanir cada jogador banido nela (preso sai com /tirarprisao; avisos com
// /limparavisooff). Só o responsável e o dono do bot usam; com a senha da Cadeia Staff
// ligada, pedem a senha antes.
const {
  MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require('discord.js');
const { getConfig: getCachedConfig } = require('../utils/configCache');
const { lerLinkDoDiscord } = require('./link');
const { prepararDesbanimento, desbanir, consultarConta, desfazerPorConta } = require('../services/ponteSamp/desbanirGm');
const { punicaoLegivel } = require('../services/ponteSamp/avisoOrganizacao');
const { ehDono } = require('../services/ponteSamp/gestao');
const { exigirSenhaDoJogo, senhaDoJogoLiberada, SENHA_VENCEU } = require('../utils/senhaStaff');

const MODAL_DESBANIR = 'desbanir_modal';
const BOTAO_DESBANIR = 'ponte_gm_desbanir:';
// /desbanir pelo ID da conta: botões da consulta e o formulário dos avisos.
const BOTAO_DESBANIR_ID = 'desbanir_id:';
const BOTAO_SOLTAR_ID = 'soltar_id:';
const MODAL_AVISOS_ID = 'desbanir_avisos:';
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });

async function ehResponsavel(interaction) {
  if (ehDono(interaction.user.id)) return true;
  const config = await getCachedConfig(interaction.guild.id);
  const cargo = config?.roles?.responsavel_admin;
  return !!cargo && (interaction.member?.roles?.cache?.has?.(cargo) || interaction.member?.roles?.includes?.(cargo));
}
const SEM_PERMISSAO = '🚫 Só o responsável pode desbanir pelo bot.';

// Antes de responder: com a senha ligada e vencida, abre o formulário da senha.
const pedeSenha = async (interaction) => !await exigirSenhaDoJogo(interaction, await getCachedConfig(interaction.guild.id));
// Já respondida (formulário enviado): só confere a senha.
const senhaVencida = async (interaction) => !await senhaDoJogoLiberada(await getCachedConfig(interaction.guild.id), interaction.user.id);

async function handleDesbanirSlash(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  if (await pedeSenha(interaction)) return;
  const campo = new TextInputBuilder()
    .setCustomId('link').setLabel('Link da denúncia ou ID da conta')
    .setPlaceholder('https://discord.com/channels/... ou 1067694').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
  return interaction.showModal(new ModalBuilder().setCustomId(MODAL_DESBANIR).setTitle('Desbanir pelo bot')
    .addComponents(new ActionRowBuilder().addComponents(campo)));
}

const ROTULO_ESTADO = { pode: 'punido', andamento: '⏳ em andamento', desbanido: '✅ já desfeito' };
const ACAO_DO_TIPO = { desbanir: 'desbanir', soltar: 'soltar (/tirarprisao)' };

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
  if (await senhaVencida(interaction)) return interaction.editReply(SENHA_VENCEU);
  const digitado = String(interaction.fields.getTextInputValue('link') || '').trim();
  // Só números: é o ID da conta. Pergunta ao jogo como ela está antes de qualquer coisa.
  if (/^\d{1,9}$/.test(digitado)) return consultarPeloId(interaction, Number(digitado));
  const link = lerLinkDoDiscord(digitado);
  if (!link) return interaction.editReply('❌ Cole o link do tópico ou de uma mensagem da denúncia, ou o ID da conta (só números).');
  if (link.guildId !== interaction.guild.id) return interaction.editReply('❌ Esse link é de outro servidor.');
  const r = await prepararDesbanimento(interaction.guild.id, link);
  if (r.erro) return interaction.editReply(`❌ ${r.erro}`);
  return interaction.editReply(telaDoDesbanimento(r, interaction.guild));
}

async function handleDesbanirBotao(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  const punicaoId = interaction.customId.slice(BOTAO_DESBANIR.length);
  if (!/^[0-9a-f]{24}$/.test(punicaoId)) return interaction.reply(efemero('❌ Botão inválido.'));
  if (await pedeSenha(interaction)) return;
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
  await require('./provaStaff').avisarNoTopico(interaction.client, doc, `❌ Provas recusadas por ${interaction.user} (punição desfeita pelo /desbanir)`);
  if (msg) await msg.edit({ content: msg.content.replace(/➥ Status: .*$/m, `➥ Status: \`Recusada (punição desfeita)\` por ${interaction.user}`), components: [], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

// ---------- pelo ID da conta ----------
// Até quantos avisos o formulário deixa tirar quando a consulta não diz quantos a conta tem.
const MAX_AVISOS_SEM_CONSULTA = 10;

async function consultarPeloId(interaction, conta) {
  await interaction.editReply(`🔎 Consultando a conta \`${conta}\` no jogo... (a gamemode responde em alguns segundos)`);
  const staff = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username };
  const r = await consultarConta({ guildId: interaction.guild.id, conta, staff }).catch(() => ({ erro: 'Não foi possível consultar. Tente de novo.' }));
  // Os botões aparecem sempre: a consulta pode falhar (include antiga) ou vir zerada (gamemode
  // sem a Althea_Consultar de verdade), e mesmo assim dá para desbanir e tirar avisos.
  const avisosConhecidos = !r.erro && Number.isInteger(r.avisos) && r.avisos > 0 ? r.avisos : 0;
  const botoes = [
    new ButtonBuilder().setCustomId(`${BOTAO_DESBANIR_ID}${conta}:${avisosConhecidos}`).setLabel('Desbanir / tirar avisos').setEmoji('🔓').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${BOTAO_SOLTAR_ID}${conta}`).setLabel('Tirar da cadeia').setEmoji('⛓️').setStyle(ButtonStyle.Primary)
  ];
  const embed = new EmbedBuilder()
    .setAuthor({ name: `Desbanir pelo bot · ${interaction.guild.name}`.slice(0, 256), iconURL: interaction.guild.iconURL?.() || undefined });
  if (r.erro) {
    embed.setColor('#868E96').setTitle(`❔  Conta ${conta}: o jogo não respondeu a consulta`).setDescription([
      `⚠️ ${r.erro}`,
      '',
      'Dá para desbanir e tirar avisos mesmo assim: o bot pergunta quantos avisos tirar (0 a 10).'
    ].join('\n'));
  } else {
    embed.setColor(r.banido ? '#E03131' : r.preso ? '#F08C00' : '#2F9E44')
      .setTitle(r.banido ? '🔓  Conta banida' : r.preso ? '⛓️  Conta presa' : '✅  Conta sem ban nem cadeia')
      .setDescription([
        `👤 **Player:** ${r.nome || 'Jogador'} (\`${conta}\`)`,
        `🔨 **Banido:** ${r.banido ? 'sim' : 'não'}`,
        `⛓️ **Preso:** ${r.preso ? 'sim' : 'não'}`,
        `⚠️ **Avisos:** ${r.avisos}`,
        '',
        r.avisos > 0 ? `Ao desbanir, o bot pergunta quantos avisos tirar (a conta tem **${r.avisos}**). Sem ban, só os avisos saem.`
          : 'Se o jogo mostrar outra coisa (consulta zerada), use os botões mesmo assim.'
      ].join('\n'));
  }
  return interaction.editReply({ content: '', embeds: [embed], components: [new ActionRowBuilder().addComponents(botoes)] });
}

// Desbanir: pergunta quantos avisos tirar (padrão 1, ou 0 se não tiver aviso).
async function handleDesbanirIdBotao(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  const [conta, avisos] = interaction.customId.slice(BOTAO_DESBANIR_ID.length).split(':').map(Number);
  if (!Number.isInteger(conta) || conta < 1) return interaction.reply(efemero('❌ Botão inválido.'));
  if (await pedeSenha(interaction)) return;
  // Sem saber quantos avisos a conta tem (consulta falhou ou veio zerada), deixa até 10.
  const maximo = avisos > 0 ? avisos : MAX_AVISOS_SEM_CONSULTA;
  const campo = new TextInputBuilder()
    .setCustomId('avisos').setLabel(avisos > 0 ? `Quantos avisos tirar? (a conta tem ${avisos})` : `Quantos avisos tirar? (0 a ${maximo})`)
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(Math.min(1, avisos || 0)));
  return interaction.showModal(new ModalBuilder().setCustomId(`${MODAL_AVISOS_ID}${conta}:${maximo}`).setTitle(`Desbanir a conta ${conta}`)
    .addComponents(new ActionRowBuilder().addComponents(campo)));
}

async function handleAvisosIdModal(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  if (await senhaVencida(interaction)) return interaction.reply(efemero(SENHA_VENCEU));
  const [conta, temAvisos] = interaction.customId.slice(MODAL_AVISOS_ID.length).split(':').map(Number);
  const avisos = Number(String(interaction.fields.getTextInputValue('avisos') || '').trim());
  if (!Number.isInteger(avisos) || avisos < 0 || avisos > temAvisos) {
    return interaction.reply(efemero(`❌ Escreva um número de 0 a ${temAvisos} (os avisos que a conta tem).`));
  }
  await interaction.deferUpdate();
  const staff = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username };
  const r = await desfazerPorConta({ guildId: interaction.guild.id, conta, acao: 'desbanir', avisos, staff }).catch(() => ({ erro: 'Não foi possível criar o pedido.' }));
  return interaction.editReply({
    content: r.erro ? `❌ ${r.erro}` : `📤 Desbanimento da conta \`${conta}\` enviado à gamemode${avisos ? `, tirando ${avisos} aviso(s)` : ''}.${r.teste ? ' 🧪 Modo teste: só simula.' : ''} O resultado sai no Relatório de punições.`,
    components: r.erro ? undefined : []
  });
}

async function handleSoltarIdBotao(interaction) {
  if (!await ehResponsavel(interaction)) return interaction.reply(efemero(SEM_PERMISSAO));
  const conta = Number(interaction.customId.slice(BOTAO_SOLTAR_ID.length));
  if (!Number.isInteger(conta) || conta < 1) return interaction.reply(efemero('❌ Botão inválido.'));
  if (await pedeSenha(interaction)) return;
  await interaction.deferUpdate();
  const staff = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username };
  const r = await desfazerPorConta({ guildId: interaction.guild.id, conta, acao: 'soltar', staff }).catch(() => ({ erro: 'Não foi possível criar o pedido.' }));
  return interaction.editReply({
    content: r.erro ? `❌ ${r.erro}` : `📤 Pedido para tirar a conta \`${conta}\` da cadeia enviado à gamemode.${r.teste ? ' 🧪 Modo teste: só simula.' : ''} O resultado sai no Relatório de punições.`,
    components: r.erro ? undefined : []
  });
}

module.exports = {
  MODAL_DESBANIR, BOTAO_DESBANIR, BOTAO_DESBANIR_ID, BOTAO_SOLTAR_ID, MODAL_AVISOS_ID,
  handleDesbanirSlash, handleDesbanirModal, handleDesbanirBotao, handleDesbanirIdBotao, handleAvisosIdModal, handleSoltarIdBotao
};
