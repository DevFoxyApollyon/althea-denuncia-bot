// /provastaff: painel no canal fixo (configurado no /painel ou no site) para a staff
// registrar uma punição com as provas. Cada registro ganha um tópico com os arquivos
// e os botões Aceitar e Recusar (só o responsável). Aceitar pede o ID e o motivo e
// manda para a Cadeia Staff, com Aceitar e Recusar como uma denúncia comum; o aceite
// lá segue para o jogo pela ponte. Fica no banco principal como DenunciaStaff.
// /tempban: o responsável registra no mesmo canal já aceito, sem botões, e a punição
// vai direto para o jogo (sem passar pela Cadeia Staff).
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
const { classificarMotivo } = require('../services/ponteSamp/validacao');
const { obterTabela } = require('../services/ponteSamp/motivos');
const { punicaoLegivel } = require('../services/ponteSamp/avisoOrganizacao');

const log = new Logger({ tag: 'ProvaStaff' });

const BOTAO_UPAR = 'provastaff_upar';
const MODAL_REGISTRO = 'provastaff_modal';
const BOTAO_ACEITAR = 'provastaff_aceitar:';
const BOTAO_RECUSAR = 'provastaff_recusar:';
const MODAL_ACEITE = 'provastaff_aceite:';
const MODAL_TEMPBAN = 'provastaff_tempban';
const MAX_IDS = 10;

const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const temCargo = (interaction, ids) => ids.filter(Boolean).some(id => interaction.member?.roles?.cache?.has?.(id) || interaction.member?.roles?.includes?.(id));

async function papeis(interaction) {
  const config = await getCachedConfig(interaction.guild.id);
  const responsavel = temCargo(interaction, [config?.roles?.responsavel_admin]);
  // "staff" aqui é quem pode registrar provas: administrador, responsável ou suporte.
  return { config, responsavel, staff: responsavel || temCargo(interaction, [config?.roles?.administrador, config?.roles?.suporte]) };
}

function embedDoPainel() {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📋 Provas da staff')
    .setDescription('> Registre aqui a punição com as provas.\n\n**Só a staff (administrador, responsável ou suporte) usa este botão.**')
    .addFields({
      name: '📌 Como funciona',
      value: '1. Clique em **Upar provas**\n2. Preencha o ID e o motivo (e anexe vídeos ou imagens); a punição sai da tabela de motivos\n3. Um tópico guarda as provas e o responsável aceita ou recusa',
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

function modalDoRegistro({ customId = MODAL_REGISTRO, titulo = '📋 Registrar punição' } = {}) {
  const campo = (id, rotulo, estilo, { min = 1, max = 100, obrigatorio = true, exemplo = '' } = {}) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrigatorio)
      .setMinLength(obrigatorio ? min : 0).setMaxLength(max).setPlaceholder(exemplo)
  );
  const modal = new ModalBuilder().setCustomId(customId).setTitle(titulo).addComponents(
    campo('id', 'ID(s) do(s) acusado(s), separe com +', TextInputStyle.Short, { max: 200, exemplo: 'Ex.: 123456 ou 123+456+789' }),
    campo('motivo', 'Motivo da punição', TextInputStyle.Paragraph, { min: 2, max: 500, exemplo: 'Descreva o motivo de forma clara' }),
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
  if (!staff) return interaction.reply(efemero('🚫 Só a staff (administrador, responsável ou suporte) registra provas.'));
  return interaction.showModal(modalDoRegistro());
}

const linhaDeDecisao = (id) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${BOTAO_ACEITAR}${id}`).setLabel('Aceitar').setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${BOTAO_RECUSAR}${id}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
);

// Lê o formulário (do "Upar provas" ou do /tempban). Devolve { erro } ou os dados.
function lerFormulario(interaction) {
  const ler = (id) => { try { return String(interaction.fields.getTextInputValue(id) || '').trim(); } catch { return ''; } };
  const contas = [...new Set(ler('id').split('+').map(s => s.trim()).filter(Boolean))];
  const motivo = ler('motivo');
  const provas = ler('provas');
  let arquivos = [];
  try { arquivos = [...(interaction.fields.getUploadedFiles('arquivos')?.values() ?? [])]; } catch { arquivos = []; }

  if (!contas.length) return { erro: '❌ Nenhum ID informado.' };
  const invalido = contas.find(c => !/^\d{1,9}$/.test(c));
  if (invalido) return { erro: `❌ ID inválido: \`${invalido.slice(0, 30)}\`. Use só os números da conta; vários com \`+\` (ex.: \`123+456\`).` };
  if (contas.length > MAX_IDS) return { erro: `❌ No máximo ${MAX_IDS} IDs por registro.` };
  if (motivo.length < 2) return { erro: '❌ Preencha o motivo.' };
  return { contas, motivo, provas, arquivos };
}

// Mensagem do registro no canal, tópico com as provas e DM para quem tem a conta.
async function publicarRegistro(interaction, canal, doc, { contas, motivo, punicao, provas, arquivos, status, components }) {
  // Discord de cada conta (quem tem a conta no nick).
  const vinculos = await Usuario.find({ guildId: interaction.guild.id, conta: { $in: contas } }, { conta: 1, userId: 1 }).sort({ updatedAt: -1 }).lean().catch(() => []);
  const discordDe = new Map();
  for (const u of vinculos) if (!discordDe.has(String(u.conta))) discordDe.set(String(u.conta), u.userId);

  const linhasIds = contas.map(c => (discordDe.get(c) ? `  • ${c} — (<@${discordDe.get(c)}>)` : `  • ${c}`)).join('\n');
  const provasTexto = provas || (arquivos.length ? `${arquivos.length} arquivo(s) no tópico` : 'Tópico');
  const registro = await canal.send({
    content: [
      `➥ Staff: ||${interaction.user}||`,
      `➥ ID(s):\n${linhasIds}`,
      `➥ Motivo: ${motivo}`,
      `➥ Punição: ${punicao}`,
      `➥ Provas: ${provasTexto}`,
      `➥ Status: ${status}`
    ].join('\n').slice(0, 2000),
    components,
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
  return { registro, topico, dms };
}

async function handleModalRegistro(interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { config, staff } = await papeis(interaction);
  if (!staff) return interaction.editReply('🚫 Só a staff (administrador, responsável ou suporte) registra provas.');
  const canal = await canalFixo(interaction, config) || interaction.channel;

  const form = lerFormulario(interaction);
  if (form.erro) return interaction.editReply(form.erro);
  const { contas, motivo, provas, arquivos } = form;

  // A punição sai da tabela de motivos (a mesma do aceite da denúncia).
  const regra = classificarMotivo(motivo, (await obterTabela()).tabela);
  const punicao = punicaoDoMotivo(regra);

  const doc = await DenunciaStaff.create({
    guildId: interaction.guild.id,
    autor: { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username },
    contas, motivo, punicao, provas, arquivos: arquivos.length
  });
  const { topico, dms } = await publicarRegistro(interaction, canal, doc, {
    contas, motivo, punicao, provas, arquivos, status: '`Pendente`', components: [linhaDeDecisao(doc._id)]
  });

  if (canal.id === config?.channels?.provasStaff) await publicarPainel(canal).catch(() => {});
  return interaction.editReply(`✅ Registro criado${topico ? ` com o tópico ${topico}` : ''}. ${dms ? `📨 ${dms} DM(s) enviada(s).` : ''} O responsável vai aceitar ou recusar.`);
}

// /tempban: só o responsável (o mesmo que aceita e envia ao jogo). Abre o formulário.
async function handleTempbanSlash(interaction) {
  const { config, responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.reply(efemero('🚫 Só o responsável usa o /tempban.'));
  const canal = await canalFixo(interaction, config);
  if (!canal?.isTextBased?.()) {
    return interaction.reply(efemero('❌ Configure o canal das provas da staff no `/painel` (Canais principais) ou no site (Painel do bot) antes.'));
  }
  return interaction.showModal(modalDoRegistro({ customId: MODAL_TEMPBAN, titulo: '🔨 Tempban direto no jogo' }));
}

// Texto da linha "Jogo" conforme o que a ponte respondeu.
function resultadoNoJogo(ponte, envio) {
  if (ponte?.soRegistro) return '📝 Motivo neutro: só visual, não vai para o jogo.';
  if (envio?.ok) return `📤 Enviada à gamemode (${envio.pedidos} pedido(s)).${envio.teste ? ' 🧪 Modo teste: só simula.' : ''}`;
  if (envio?.erro) return `⚠️ Não foi para a gamemode: ${envio.erro} Use "Enviar ao jogo" no Relatório de punições.`;
  if (ponte?.criado) return '🎮 Enviada para o painel do jogo.';
  if (ponte?.jaExistia) return 'ℹ️ Já estava no painel do jogo.';
  return '⚠️ A ponte com o jogo não está ativa neste servidor: nada foi enviado.';
}

// Registro já aceito, sem botões, no canal das provas; a punição vai direto para o jogo.
async function handleModalTempban(interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { config, responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.editReply('🚫 Só o responsável usa o /tempban.');
  const canal = await canalFixo(interaction, config);
  if (!canal?.isTextBased?.()) return interaction.editReply('❌ Canal das provas da staff não configurado.');

  const form = lerFormulario(interaction);
  if (form.erro) return interaction.editReply(form.erro);
  const { contas, motivo, provas, arquivos } = form;

  // Vai direto para o jogo: o motivo precisa estar na tabela (escolhe tempo e avisos).
  const regra = classificarMotivo(motivo, (await obterTabela()).tabela);
  if (!regra.regra) {
    return interaction.editReply(`❌ O motivo **${motivo.slice(0, 100)}** não está na tabela de motivos. Cadastre o motivo e o tempo em **Motivos de punição** no site e tente de novo.`);
  }
  const punicao = punicaoDoMotivo(regra);
  const quem = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username, em: new Date() };

  const doc = await DenunciaStaff.create({
    guildId: interaction.guild.id,
    autor: { id: quem.id, nome: quem.nome },
    contas, motivo, punicao, provas, arquivos: arquivos.length,
    status: 'aceita', decididoPor: quem, acusadoAceite: contas.join('+'), motivoAceite: motivo,
    cadeia: { status: 'aceita' }
  });
  const { registro, topico, dms } = await publicarRegistro(interaction, canal, doc, {
    contas, motivo, punicao, provas, arquivos, status: `\`Aceita\` por ${interaction.user} (/tempban)`, components: []
  });

  // Ponte com o jogo: entra na fila e, no modo gamemode, já é enviada.
  const denuncia = comoDenuncia({ ...doc.toObject(), channelId: registro.channelId, messageId: registro.id, threadId: topico?.id || '' });
  const ponte = await require('../services/ponteSamp/aceite').registrarAceite({
    client: interaction.client, denuncia, origem: 'canal_staff', staff: quem, canalMensagem: registro
  }).catch(() => null);
  const envio = ponte ? await require('../Handlers/statusDenuncia/acoesStatus').enviarAoJogoNoAceite(interaction, denuncia).catch(() => null) : null;
  const jogo = resultadoNoJogo(ponte, envio);
  if (envio?.erro) log.warn(`[PonteGm] /tempban ${doc._id} não foi para a gamemode: ${envio.erro}`);
  await registro.edit({ content: `${registro.content}\n➥ Jogo: ${jogo}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => {});

  await publicarPainel(canal).catch(() => {});
  return interaction.editReply(`✅ Tempban registrado${topico ? ` com o tópico ${topico}` : ''}.\n${jogo}${dms ? `\n📨 ${dms} DM(s) enviada(s).` : ''}`);
}

const FORA_DA_TABELA = 'Motivo fora da tabela: o responsável confere no aceite';
const punicaoDoMotivo = (regra) => (!regra.regra ? FORA_DA_TABELA
  : regra.cmd === 'registro' ? (regra.texto || 'Neutro')
    : punicaoLegivel({ cmd: regra.cmd, tempo: regra.tempo, avisos: regra.avisos }));

// Motivo novo cadastrado (site, /ponte motivos ou painel do jogo): os registros
// pendentes que estavam fora da tabela ganham a punição na mensagem e no tópico.
async function atualizarProvasForaDaTabela({ client, tabela }) {
  const pendentes = await DenunciaStaff.find({ status: 'pendente', punicao: FORA_DA_TABELA }).limit(200).lean();
  let atualizadas = 0;
  for (const doc of pendentes) {
    const regra = classificarMotivo(doc.motivo, tabela);
    if (!regra.regra) continue;
    const punicao = punicaoDoMotivo(regra);
    const r = await DenunciaStaff.updateOne({ _id: doc._id, status: 'pendente', punicao: FORA_DA_TABELA }, { $set: { punicao } });
    if (!r.modifiedCount) continue;
    atualizadas += 1;
    if (!client) continue;
    const trocar = async (canalId, msgId) => {
      const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
      const msg = canal?.messages && msgId ? await canal.messages.fetch(msgId).catch(() => null) : null;
      if (msg?.content?.includes(FORA_DA_TABELA)) await msg.edit({ content: msg.content.replace(FORA_DA_TABELA, punicao), allowedMentions: { parse: [] } }).catch(() => {});
    };
    await trocar(doc.channelId, doc.messageId);
    // Primeira mensagem do tópico (o resumo com a punição).
    const topico = doc.threadId ? await client.channels.fetch(doc.threadId).catch(() => null) : null;
    const resumo = topico?.messages ? (await topico.messages.fetch({ limit: 5, after: '0' }).catch(() => null))?.find(m => m.author?.id === client.user?.id && m.content.includes(FORA_DA_TABELA)) : null;
    if (resumo) await resumo.edit({ content: resumo.content.replace(FORA_DA_TABELA, punicao), allowedMentions: { parse: [] } }).catch(() => {});
  }
  return atualizadas;
}

// Trava (liga e desliga no Painel do bot): para aceitar ou recusar, o motivo precisa
// estar na tabela de motivos. O registro em si entra com qualquer motivo.
async function motivoForaDaTabela(config, motivo) {
  if (config?.provasExigirMotivo === false) return null;
  const regra = classificarMotivo(motivo, (await obterTabela()).tabela);
  return regra.regra ? null
    : `❌ O motivo **${String(motivo).slice(0, 100)}** não está na tabela de motivos. Cadastre o motivo e o tempo em **Motivos de punição** no site (ou como "Neutro", se não for ban nem cadeia) e tente de novo.`;
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

// No tópico das provas: aceita (com o link da Cadeia Staff) ou recusada, como nas denúncias.
async function avisarNoTopico(client, doc, texto) {
  const topico = doc.threadId ? await client.channels.fetch(doc.threadId).catch(() => null) : null;
  if (topico?.archived) await topico.setArchived(false).catch(() => {});
  if (topico?.send) await topico.send({ content: texto, allowedMentions: { parse: [] } }).catch(() => {});
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
  const fora = await motivoForaDaTabela(config, motivo);
  if (fora) return interaction.editReply(fora);

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
  await avisarNoTopico(interaction.client, doc, cadeiaMsg
    ? `✅ Provas aceitas por ${interaction.user}\n🔗 **Link para compartilhar:** ${cadeiaMsg.url}`
    : `✅ Provas aceitas por ${interaction.user}`);
  return interaction.editReply(cadeiaMsg
    ? `✅ Aceita e enviada para a Cadeia Staff: ${cadeiaMsg.url}`
    : '⚠️ Aceita, mas a Cadeia Staff não está configurada ou o bot não consegue enviar lá.');
}

async function handleBotaoRecusar(interaction) {
  const { responsavel } = await papeis(interaction);
  if (!responsavel) return interaction.reply(efemero('🚫 Só o responsável aceita ou recusa as provas.'));
  const id = interaction.customId.slice(BOTAO_RECUSAR.length);
  if (!/^[0-9a-f]{24}$/.test(id)) return interaction.reply(efemero('❌ Botão inválido.'));
  const pendente = await DenunciaStaff.findOne({ _id: id, guildId: interaction.guild.id }).lean();
  const fora = pendente ? await motivoForaDaTabela(await getCachedConfig(interaction.guild.id), pendente.motivo) : null;
  if (fora) return interaction.reply(efemero(fora));
  const quem = { id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username, em: new Date() };
  const doc = await DenunciaStaff.findOneAndUpdate({ _id: id, guildId: interaction.guild.id, status: 'pendente' }, { $set: { status: 'recusada', decididoPor: quem } }, { new: true }).lean();
  if (!doc) return interaction.reply(efemero('ℹ️ Este registro já foi decidido.'));
  await interaction.deferUpdate();
  await editarRegistro(interaction.client, doc, 'Recusada', interaction.user);
  await avisarNoTopico(interaction.client, doc, `❌ Provas recusadas por ${interaction.user}`);
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
  BOTAO_UPAR, MODAL_REGISTRO, BOTAO_ACEITAR, BOTAO_RECUSAR, MODAL_ACEITE, MODAL_TEMPBAN,
  handleProvaStaffSlash, handleTempbanSlash, handleModalTempban, handleBotaoUpar, handleModalRegistro, handleBotaoAceitar, handleModalAceite, handleBotaoRecusar,
  comoDenuncia, recusarNaCadeia, publicarPainel, atualizarProvasForaDaTabela, avisarNoTopico
};
