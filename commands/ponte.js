// Comandos da ponte com o jogo: /ativar, /ponte e /ponte-codigo.
const { MessageFlags, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const gestao = require('../services/ponteSamp/gestao');
const PonteUso = require('../models/PonteUso');
const { getConfig } = require('../utils/configCache');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'Ponte' });
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const MODAL_MOTIVOS = 'ponte_motivos_modal';
const motivos = require('../services/ponteSamp/motivos');
const { reclassificarFila } = require('../services/ponteSamp/aceite');
const { handlePonteGamemode } = require('./ponteGamemode');

async function handleAtivarSlash(interaction) {
  if (!gestao.ponteLigada()) return interaction.reply(efemero('❌ A ponte com o jogo está desligada neste bot.'));
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply(efemero('❌ Precisa da permissão Gerenciar Servidor.'));
  }
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { erro } = await gestao.ativarGuild({
    codigo: interaction.options.getString('codigo', true),
    guildId: interaction.guild.id,
    userId: interaction.user.id
  });
  if (erro) return interaction.editReply(`❌ ${erro}`);
  log.info(`Ponte ativada em ${interaction.guild.name} (${interaction.guild.id}) por ${interaction.user.tag}`);
  // Aparece no painel do dono (/admin) como quem ativou a ponte neste servidor.
  await PonteUso.create({
    guildId: interaction.guild.id, acao: 'ativar',
    detalhes: { por: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username }
  }).catch(() => {});
  return interaction.editReply('✅ Ponte com o jogo ativada. Agora o dono do bot cria a credencial da gamemode (`/ponte gamemode criar`).');
}

// Quem edita a tabela de motivos (a mesma para todos os servidores): o dono do bot e o
// cargo de responsável.
async function podeEditarMotivos(interaction) {
  if (gestao.ehDono(interaction.user.id)) return true;
  const config = await getConfig(interaction.guild.id).catch(() => null);
  const cargo = config?.roles?.responsavel_admin;
  return Boolean(cargo && interaction.member?.roles?.cache?.has(cargo));
}

// /ponte motivos: abre a tabela inteira para editar.
async function abrirMotivos(interaction) {
  if (!(await podeEditarMotivos(interaction))) return interaction.reply(efemero('❌ Só o responsável edita a tabela de motivos.'));
  const { tabela } = await motivos.obterTabela();
  const texto = motivos.tabelaParaTexto(tabela);
  if (texto.length > 4000) return interaction.reply(efemero('❌ A tabela ficou grande demais para o Discord. Edite pelo site (/admin → Motivos) ou pelo painel do jogo.'));
  return interaction.showModal(new ModalBuilder()
    .setCustomId(MODAL_MOTIVOS)
    .setTitle('Motivos (todos os servidores)')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('motivos')
        .setLabel('NOME|SINÔNIMO = ban/cadeia tempo avisos')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setValue(texto)
    )));
}

async function handlePonteMotivosModal(interaction) {
  if (!(await podeEditarMotivos(interaction))) return interaction.reply(efemero('❌ Sem permissão.'));
  const { erro, lista } = motivos.textoParaTabela(interaction.fields.getTextInputValue('motivos'));
  if (erro) return interaction.reply(efemero(`❌ ${erro}`));
  const podeApagar = require('../services/ponteSamp/gestao').ehDono(interaction.user.id);
  const salvo = await motivos.salvarTabela(lista, `${interaction.user.tag} (Discord, ${interaction.guild.name})`, { podeApagar });
  if (salvo.erro) return interaction.reply(efemero(`❌ ${salvo.erro}`));
  reclassificarFila({ client: interaction.client, tabela: salvo.tabela }).catch(() => {});
  require('./provaStaff').atualizarProvasForaDaTabela({ client: interaction.client, tabela: salvo.tabela }).catch(() => {});
  log.info(`Tabela de motivos da ponte salva por ${interaction.user.tag} (${salvo.tabela.length} motivos).`);
  return interaction.reply(efemero(`✅ Tabela salva com ${salvo.tabela.length} motivos. Vale para todos os servidores e para os PCs na próxima atualização da fila.`));
}

async function handlePonteSlash(interaction) {
  if (interaction.options.getSubcommandGroup(false) === 'gamemode') return handlePonteGamemode(interaction);
  return abrirMotivos(interaction);
}

async function handlePonteCodigoSlash(interaction) {
  // A permissão escondida no Discord não basta: a checagem real é o ID do dono.
  if (!gestao.ehDono(interaction.user.id)) {
    log.warn(`Tentativa de /ponte-codigo sem permissão: ${interaction.user.tag} (${interaction.user.id}) em ${interaction.guild?.id}`);
    await PonteUso.create({ guildId: interaction.guild?.id || '', acao: 'codigo_negado', detalhes: { userId: interaction.user.id } }).catch(() => {});
    return interaction.reply(efemero('❌ Sem permissão.'));
  }
  const validadeDias = interaction.options.getInteger('validade_dias');
  const { codigo } = await gestao.criarCodigo({ criadoPor: interaction.user.id, validadeDias });
  return interaction.reply(efemero([
    `✅ Código gerado (aparece só agora): \`${codigo}\``,
    `Validade: ${validadeDias ? `${validadeDias} dia(s)` : 'sem prazo'}`,
    'Na guild de destino: `/ativar codigo:` com este código.'
  ].join('\n')));
}

module.exports = {
  MODAL_MOTIVOS,
  handlePonteMotivosModal,
  handleAtivarSlash,
  handlePonteSlash,
  handlePonteCodigoSlash
};
