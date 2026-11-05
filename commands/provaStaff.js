// /provastaff: painel no canal fixo (configurado no /painel ou no site) para a staff
// registrar uma punição com as provas. Cada registro ganha um tópico com os arquivos
// e os botões Aceitar e Recusar (só o responsável). Aceitar pede o ID e o motivo e
// manda para a Cadeia Staff, com Aceitar e Recusar como uma denúncia comum; o aceite
// lá segue para o jogo pela ponte. Fica no banco principal como DenunciaStaff.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const Config = require('../models/Config');
const DenunciaStaff = require('../models/DenunciaStaff');
const Usuario = require('../models/Usuario');
const { getConfig: getCachedConfig } = require('../utils/configCache');
const { dmPausada, registrarErroDeDM } = require('../utils/dmSegura');
const { getBrasiliaDateTime } = require('../utils/dateUtils');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'ProvaStaff' });

const BOTAO_UPAR = 'provastaff_upar';
const MODAL_REGISTRO = 'provastaff_modal';
const BOTAO_ACEITAR = 'provastaff_aceitar:';
const BOTAO_RECUSAR = 'provastaff_recusar:';
const MODAL_ACEITE = 'provastaff_aceite:';
const MAX_IDS = 10;

const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const temCargo = (interaction, ids) => ids.filter(Boolean).some(id => interaction.member?.roles?.cache?.has?.(id) || interaction.member?.roles?.includes?.(id));

async function papeis(interaction) {
  const config = await getCachedConfig(interaction.guild.id);
  const responsavel = temCargo(interaction, [config?.roles?.responsavel_admin]);
  return { config, responsavel, staff: responsavel || temCargo(interaction, [config?.roles?.administrador]) };
}

function embedDoPainel() {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📋 Provas da staff')
    .setDescription('> Registre aqui a punição com as provas.\n\n**Só a staff (administrador ou responsável) usa este botão.**')
    .addFields({
      name: '📌 Como funciona',
      value: '1. Clique em **Upar provas**\n2. Preencha o ID, o motivo e a punição (e anexe vídeos ou imagens)\n3. Um tópico guarda as provas e o responsável aceita ou recusa',
      inline: false
    })
    .setFooter({ text: 'Provas da staff · Apenas staff' })
    .setTimestamp();
}

const linhaDoPainel = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(BOTAO_UPAR).setLabel('Upar provas').setEmoji('📤').setStyle(ButtonStyle.Primary)
);

// Painel sempre no fim do canal: apaga o anterior (guardado na Config) e manda de novo.
async function publicarPainel(canal) {
  const config = await Config.findOne({ guildId: canal.guild.id }, { provasStaffPainelMsgId: 1 }).lean();
  if (config?.provasStaffPainelMsgId) {
    const antiga = await canal.messages.fetch(config.provasStaffPainelMsgId).catch(() => null);
    await antiga?.delete().catch(() => {});
  }
  const msg = await canal.send({ embeds: [embedDoPainel()], components: [linhaDoPainel()] });
  await Config.updateOne({ guildId: canal.guild.id }, { $set: { provasStaffPainelMsgId: msg.id } }).catch(() => {});
  return msg;
}

async function canalFixo(interaction, config) {
  const id = config?.channels?.provasStaff;
  return id ? interaction.guild.channels.fetch(id).catch(() => null) : null;
}

async function handleProvaStaffSlash(interaction) {
  const { config, responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.reply(efemero('🚫 Só o responsável publica o painel de provas.'));
  const canal = await canalFixo(interaction, config);
  if (!canal?.isTextBased?.()) {
    return interaction.reply(efemero('❌ Configure o canal das provas da staff no `/painel` (Canais principais) ou no site (Painel do bot) antes.'));
  }
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  await publicarPainel(canal);
  return interaction.editReply(`✅ Painel de provas publicado em ${canal}.`);
}

function modalDoRegistro() {
  const campo = (id, rotulo, estilo, { min = 1, max = 100, obrigatorio = true, exemplo = '' } = {}) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrigatorio)
      .setMinLength(obrigatorio ? min : 0).setMaxLength(max).setPlaceholder(exemplo)
  );
  const modal = new ModalBuilder().setCustomId(MODAL_REGISTRO).setTitle('📋 Registrar punição').addComponents(
    campo('id', 'ID(s) do(s) acusado(s), separe com +', TextInputStyle.Short, { max: 200, exemplo: 'Ex.: 123456 ou 123+456+789' }),
    campo('motivo', 'Motivo da punição', TextInputStyle.Paragraph, { min: 2, max: 500, exemplo: 'Descreva o motivo de forma clara' }),
    campo('punicao', 'Punição aplicada', TextInputStyle.Short, { min: 2, max: 100, exemplo: 'Ex.: Ban 3 dias + 1 aviso' }),
    campo('provas', 'Provas (opcional: links ou texto)', TextInputStyle.Paragraph, { max: 1000, obrigatorio: false, exemplo: 'Links das provas, ou deixe em branco e use o tópico' })
  );
  // Upload no modal exige discord.js >= 14.23; em versão antiga o formulário abre sem esse campo.
  if (LabelBuilder && FileUploadBuilder) {
    modal.addLabelComponents(new LabelBuilder()
      .setLabel('Vídeos / imagens (opcional)')
      .setDescription('Até 10 arquivos: vão para o tópico das provas')
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('arquivos').setRequired(false).setMinValues(0).setMaxValues(10)));
  }
  return modal;
}

async function handleBotaoUpar(interaction) {
  const { staff } = await papeis(interaction);
  if (!staff) return interaction.reply(efemero('🚫 Só a staff (administrador ou responsável) registra provas.'));
  return interaction.showModal(modalDoRegistro());
}

const linhaDeDecisao = (id) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${BOTAO_ACEITAR}${id}`).setLabel('Aceitar').setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${BOTAO_RECUSAR}${id}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
);

async function handleModalRegistro(interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { config, staff } = await papeis(interaction);
  if (!staff) return interaction.editReply('🚫 Só a staff (administrador ou responsável) registra provas.');
  const canal = await canalFixo(interaction, config) || interaction.channel;

  const ler = (id) => { try { return String(interaction.fields.getTextInputValue(id) || '').trim(); } catch { return ''; } };
  const contas = [...new Set(ler('id').split('+').map(s => s.trim()).filter(Boolean))];
  const motivo = ler('motivo');
  const punicao = ler('punicao');
  const provas = ler('provas');
  let arquivos = [];
  try { arquivos = [...(interaction.fields.getUploadedFiles('arquivos')?.values() ?? [])]; } catch { arquivos = []; }

  if (!contas.length) return interaction.editReply('❌ Nenhum ID informado.');
  const invalido = contas.find(c => !/^\d{1,9}$/.test(c));
  if (invalido) return interaction.editReply(`❌ ID inválido: \`${invalido.slice(0, 30)}\`. Use só os números da conta; vários com \`+\` (ex.: \`123+456\`).`);
  if (contas.length > MAX_IDS) return interaction.editReply(`❌ No máximo ${MAX_IDS} IDs por registro.`);
  if (motivo.length < 2 || punicao.length < 2) return interaction.editReply('❌ Preencha o motivo e a punição.');

  // Discord de cada conta (quem tem a conta no nick).
  const vinculos = await Usuario.find({ guildId: interaction.guild.id, conta: { $in: contas } }, { conta: 1, userId: 1 }).sort({ updatedAt: -1 }).lean().catch(() => []);
  const discordDe = new Map();
  for (const u of vinculos) if (!discordDe.has(String(u.conta))) discordDe.set(String(u.conta), u.userId);

  const doc = await DenunciaStaff.create({
    guildId: interaction.guild.id,
    autor: { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username },
    contas, motivo, punicao, provas, arquivos: arquivos.length
  });

  const linhasIds = contas.map(c => (discordDe.get(c) ? `  • ${c} — (<@${discordDe.get(c)}>)` : `  • ${c}`)).join('\n');
  const provasTexto = provas || (arquivos.length ? `${arquivos.length} arquivo(s) no tópico` : 'Tópico');
  const registro = await canal.send({
    content: [
      `➥ Staff: ||${interaction.user}||`,
      `➥ ID(s):\n${linhasIds}`,
      `➥ Motivo: ${motivo}`,
      `➥ Punição: ${punicao}`,
      `➥ Provas: ${provasTexto}`,
      '➥ Status: `Pendente`'
    ].join('\n').slice(0, 2000),
    components: [linhaDeDecisao(doc._id)],
    allowedMentions: { parse: [] }
  });

  const rotuloIds = contas.length <= 3 ? contas.join(', ') : `${contas.slice(0, 3).join(', ')} +${contas.length - 3}`;
  const topico = await registro.startThread({ name: `Provas — ${rotuloIds}`.slice(0, 100), autoArchiveDuration: 1440, reason: 'Provas da staff' }).catch(() => null);
  if (topico) {
    await topico.send({
      content: `📌 **Provas da staff**\n> **Punição:** ${punicao}\n\n**Acusado(s):**\n${contas.map(c => (discordDe.get(c) ? `• <@${discordDe.get(c)}> — \`${c}\`` : `• ID \`${c}\``)).join('\n')}`,
      allowedMentions: { parse: [] }
    }).catch(() => {});
    if (arquivos.length) await require('./denuncia').enviarAnexosNoTopico(topico, arquivos, interaction.user).catch(() => {});
  }
  await DenunciaStaff.updateOne({ _id: doc._id }, { $set: { channelId: registro.channelId, messageId: registro.id, threadId: topico?.id || '' } });

  // DM para quem tem a conta vinculada (pulada enquanto o Discord bloqueia as DMs do bot).
  let dms = 0;
  if (!dmPausada()) {
    for (const userId of new Set(contas.map(c => discordDe.get(c)).filter(Boolean))) {
      const pessoa = await interaction.client.users.fetch(userId).catch(() => null);
      const enviada = await pessoa?.send({
        embeds: [new EmbedBuilder().setColor('#E74C3C').setTitle('⚠️ Registro de punição')
          .setDescription(`A staff de **${interaction.guild.name}** registrou uma punição na sua conta.`)
          .addFields({ name: '⚖️ Punição', value: `\`${punicao.slice(0, 100)}\``, inline: true }, ...(topico ? [{ name: '🔗 Tópico', value: `[Ver provas](${topico.url})`, inline: true }] : []))
          .setTimestamp()]
      }).catch((erro) => { registrarErroDeDM(erro); return null; });
      if (enviada) dms += 1;
    }
  }

  if (canal.id === config?.channels?.provasStaff) await publicarPainel(canal).catch(() => {});
  return interaction.editReply(`✅ Registro criado${topico ? ` com o tópico ${topico}` : ''}. ${dms ? `📨 ${dms} DM(s) enviada(s).` : ''} O responsável vai aceitar ou recusar.`);
}

async function registroDoBotao(interaction, prefixo) {
  const id = interaction.customId.slice(prefixo.length);
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return DenunciaStaff.findOne({ _id: id, guildId: interaction.guild.id }).lean();
}

// Aceitar: pede o ID e o motivo (já preenchidos) antes de ir para a Cadeia Staff.
async function handleBotaoAceitar(interaction) {
  const { responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.reply(efemero('🚫 Só o responsável aceita ou recusa as provas.'));
  const doc = await registroDoBotao(interaction, BOTAO_ACEITAR);
  if (!doc) return interaction.reply(efemero('❌ Registro não encontrado.'));
  if (doc.status !== 'pendente') return interaction.reply(efemero(`ℹ️ Este registro já foi ${doc.status}.`));
  const campo = (id, rotulo, valor, estilo, max) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(true).setMaxLength(max).setValue(String(valor || '').slice(0, max))
  );
  return interaction.showModal(new ModalBuilder().setCustomId(`${MODAL_ACEITE}${doc._id}`).setTitle('Aceitar provas da staff').addComponents(
    campo('acusado', 'ID(s) do(s) acusado(s), separe com +', doc.contas.join('+'), TextInputStyle.Short, 200),
    campo('motivo', 'Motivo (escolhe a punição no jogo)', doc.motivo, TextInputStyle.Paragraph, 300)
  ));
}

const linhaDaCadeia = (messageId) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`log_aceitar_${messageId}`).setLabel('Aceitar').setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`log_recusar_${messageId}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
);

async function editarRegistro(client, doc, status, quem) {
  const canal = doc.channelId ? await client.channels.fetch(doc.channelId).catch(() => null) : null;
  const msg = canal?.messages ? await canal.messages.fetch(doc.messageId).catch(() => null) : null;
  if (!msg) return;
  const texto = msg.content.replace(/➥ Status: `[^`]*`.*$/m, `➥ Status: \`${status}\` por ${quem}`);
  await msg.edit({ content: texto, components: [], allowedMentions: { parse: [] } }).catch(() => {});
}

async function handleModalAceite(interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { config, responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.editReply('🚫 Só o responsável aceita ou recusa as provas.');
  const id = interaction.customId.slice(MODAL_ACEITE.length);
  const acusado = interaction.fields.getTextInputValue('acusado').split('+').map(s => s.trim()).filter(Boolean).join('+');
  const motivo = interaction.fields.getTextInputValue('motivo').trim();
  if (!acusado || !acusado.split('+').every(c => /^\d{1,9}$/.test(c))) return interaction.editReply('❌ ID inválido: use só números, vários com `+`.');
  if (motivo.length < 2) return interaction.editReply('❌ Escreva o motivo.');

  const quem = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username, em: new Date() };
  const doc = await DenunciaStaff.findOneAndUpdate(
    { _id: id, guildId: interaction.guild.id, status: 'pendente' },
    { $set: { status: 'aceita', decididoPor: quem, acusadoAceite: acusado, motivoAceite: motivo } },
    { new: true }
  ).lean();
  if (!doc) return interaction.editReply('ℹ️ Este registro já foi decidido.');

  const cadeia = config?.channels?.logs ? await interaction.guild.channels.fetch(config.channels.logs).catch(() => null) : null;
  const link = `https://discord.com/channels/${doc.guildId}/${doc.channelId}/${doc.messageId}`;
  let cadeiaMsg = null;
  if (cadeia?.send) {
    cadeiaMsg = await cadeia.send({
      content: `➱ Provas da staff aceitas Acusado (${acusado}) tomará punição por (${motivo}) Data ${getBrasiliaDateTime()} Link:|| ${link} ||`,
      components: [linhaDaCadeia(doc.messageId)],
      allowedMentions: { parse: [] }
    }).catch((erro) => { log.warn(`Provas ${doc._id} não foram para a Cadeia Staff: ${erro.message}`); return null; });
  }
  if (cadeiaMsg) await DenunciaStaff.updateOne({ _id: doc._id }, { $set: { 'cadeia.canalId': cadeiaMsg.channelId, 'cadeia.msgId': cadeiaMsg.id } });
  await editarRegistro(interaction.client, doc, 'Aceita', interaction.user);
  return interaction.editReply(cadeiaMsg
    ? `✅ Aceita e enviada para a Cadeia Staff: ${cadeiaMsg.url}`
    : '⚠️ Aceita, mas a Cadeia Staff não está configurada ou o bot não consegue enviar lá.');
}

async function handleBotaoRecusar(interaction) {
  const { responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.reply(efemero('🚫 Só o responsável aceita ou recusa as provas.'));
  const id = interaction.customId.slice(BOTAO_RECUSAR.length);
  if (!/^[0-9a-f]{24}$/.test(id)) return interaction.reply(efemero('❌ Botão inválido.'));
  const quem = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username, em: new Date() };
  const doc = await DenunciaStaff.findOneAndUpdate({ _id: id, guildId: interaction.guild.id, status: 'pendente' }, { $set: { status: 'recusada', decididoPor: quem } }, { new: true }).lean();
  if (!doc) return interaction.reply(efemero('ℹ️ Este registro já foi decidido.'));
  await interaction.deferUpdate();
  await editarRegistro(interaction.client, doc, 'Recusada', interaction.user);
}

// Cadeia Staff: a DenunciaStaff vira o formato que o aceite da denúncia usa (ponte com o jogo).
function comoDenuncia(doc) {
  return {
    _id: doc._id,
    guildId: doc.guildId,
    acusado: doc.acusadoAceite,
    acusadoId: doc.acusadoAceite,
    motivo: doc.motivo,
    motivoAceite: doc.motivoAceite,
    provas: doc.provas,
    channelId: doc.channelId,
    messageId: doc.messageId,
    threadId: doc.threadId
  };
}

// Recusar na Cadeia Staff: só marca (não há tópico de denúncia para avisar).
async function recusarNaCadeia(interaction, doc) {
  const config = await getCachedConfig(interaction.guild.id);
  if (!temCargo(interaction, [config?.roles?.responsavel_admin])) return interaction.editReply('🚫 Só o responsável usa estes botões.');
  const r = await DenunciaStaff.updateOne({ _id: doc._id, 'cadeia.status': '' }, { $set: { 'cadeia.status': 'recusada' } });
  if (!r.modifiedCount) return interaction.editReply('ℹ️ Esta confirmação já foi processada.');
  await interaction.message.edit({ content: `${interaction.message.content}\n❌ Recusada na Cadeia Staff ||${getBrasiliaDateTime()}|| por ${interaction.user}`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  return interaction.editReply('❌ Recusada na Cadeia Staff.');
}

module.exports = {
  BOTAO_UPAR, MODAL_REGISTRO, BOTAO_ACEITAR, BOTAO_RECUSAR, MODAL_ACEITE,
  handleProvaStaffSlash, handleBotaoUpar, handleModalRegistro, handleBotaoAceitar, handleModalAceite, handleBotaoRecusar,
  comoDenuncia, recusarNaCadeia, publicarPainel
};
