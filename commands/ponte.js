// Comandos da ponte com o jogo: /ativar, /instalacao, /ponte e /ponte-codigo.
const { MessageFlags, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const gestao = require('../services/ponteSamp/gestao');
const PonteServidor = require('../models/PonteServidor');
const PonteUso = require('../models/PonteUso');
const { validarTemplates, templatesEfetivos } = require('../services/ponteSamp/validacao');
const { getConfig } = require('../utils/configCache');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'Ponte' });
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const MODAL_TEMPLATES = 'ponte_templates_modal';
const MODAL_MOTIVOS = 'ponte_motivos_modal';
const motivos = require('../services/ponteSamp/motivos');
const { reclassificarFila } = require('../services/ponteSamp/aceite');
const { handlePonteGamemode } = require('./ponteGamemode');

async function ehResponsavel(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const config = await getConfig(interaction.guild.id).catch(() => null);
  const cargo = config?.roles?.responsavel_admin;
  return !!cargo && !!interaction.member?.roles?.cache?.has(cargo);
}

function blocoIni(token) {
  const base = String(process.env.SITE_URL || 'https://SEU-SITE').replace(/\/+$/, '');
  return [
    // Arquivo inteiro, com os mesmos padrões do script: é só substituir tudo.
    '```ini',
    '[ponte]',
    `url=${base}/ponte/api`,
    `token=${token}`,
    'delay_ms=1500',
    'tecla=117',
    'automatico=true',
    'vercontaid=/vercontaid',
    'escala=100',
    '```'
  ].join('\n');
}

async function handleAtivarSlash(interaction) {
  if (!gestao.ponteLigada()) return interaction.reply(efemero('❌ A ponte com o jogo está desligada neste bot.'));
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply(efemero('❌ Precisa da permissão Gerenciar Servidor.'));
  }
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const { erro, servidor } = await gestao.ativarGuild({
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
  return interaction.editReply(`✅ Ponte com o jogo ativada. Limite: ${servidor.limitePcs} PC(s). Agora use \`/instalacao nova\`.`);
}

async function handleInstalacaoSlash(interaction) {
  if (!(await ehResponsavel(interaction))) return interaction.reply(efemero('❌ Sem permissão.'));
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'nova' || sub === 'renovar') {
    const resultado = sub === 'nova'
      ? await gestao.criarInstalacao({ guildId, nome: interaction.options.getString('nome', true), criadoPor: interaction.user.id })
      : await gestao.renovarInstalacao({ guildId, id: interaction.options.getString('id', true) });
    if (resultado.erro) return interaction.editReply(`❌ ${resultado.erro}`);
    const { token, instalacao } = resultado;
    log.info(`Instalação ${sub === 'nova' ? 'criada' : 'renovada'}: ${instalacao.nome} (${guildId}) por ${interaction.user.tag}`);
    return interaction.editReply([
      `✅ PC **${instalacao.nome}** (\`${instalacao._id}\`) pronto.`,
      '⚠️ O token aparece **só agora** e não deve ser compartilhado. Apague **tudo** em `moonloader/config/ponte_denuncias.ini`, cole o bloco abaixo e salve. No jogo, clique em Recarregar ou use `/fila`:',
      blocoIni(token)
    ].join('\n'));
  }

  if (sub === 'revogar') {
    const inst = await gestao.revogarInstalacao({ guildId, id: interaction.options.getString('id', true), por: interaction.user.id });
    return interaction.editReply(inst ? `✅ PC **${inst.nome}** revogado.` : '❌ Instalação não encontrada neste servidor.');
  }

  const lista = await gestao.listarInstalacoes(guildId);
  if (lista.length === 0) return interaction.editReply('ℹ️ Nenhum PC cadastrado.');
  const linhas = lista.map(i => {
    const online = i.ultimoPingEm && Date.now() - new Date(i.ultimoPingEm).getTime() < 90_000 ? '🟢' : '⚪';
    const uso = i.ultimoUsoEm ? `<t:${Math.floor(new Date(i.ultimoUsoEm).getTime() / 1000)}:R>` : 'nunca';
    return `${online} **${i.nome}** \`${i._id}\` • ${i.status} • …${i.ultimos4} • último uso ${uso}`;
  });
  return interaction.editReply(linhas.join('\n').slice(0, 1900));
}

// Quem edita a tabela de motivos (a mesma para todos os servidores): o dono do bot,
// quem gerencia o servidor e os cargos de administrador e responsável.
async function podeEditarMotivos(interaction) {
  if (gestao.ehDono(interaction.user.id) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const config = await getConfig(interaction.guild.id).catch(() => null);
  const cargos = [config?.roles?.administrador, config?.roles?.responsavel_admin].filter(Boolean);
  return cargos.some(cargo => interaction.member?.roles?.cache?.has(cargo));
}

// /ponte motivos: abre a tabela inteira para editar.
async function abrirMotivos(interaction) {
  if (!(await podeEditarMotivos(interaction))) return interaction.reply(efemero('❌ Só administradores e responsáveis editam a tabela de motivos.'));
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
  const salvo = await motivos.salvarTabela(lista, `${interaction.user.tag} (Discord, ${interaction.guild.name})`);
  if (salvo.erro) return interaction.reply(efemero(`❌ ${salvo.erro}`));
  reclassificarFila({ client: interaction.client, tabela: salvo.tabela }).catch(() => {});
  log.info(`Tabela de motivos da ponte salva por ${interaction.user.tag} (${salvo.tabela.length} motivos).`);
  return interaction.reply(efemero(`✅ Tabela salva com ${salvo.tabela.length} motivos. Vale para todos os servidores e para os PCs na próxima atualização da fila.`));
}

async function handlePonteSlash(interaction) {
  if (interaction.options.getSubcommandGroup(false) === 'gamemode') return handlePonteGamemode(interaction);
  if (interaction.options.getSubcommand(false) === 'motivos') return abrirMotivos(interaction);
  if (!(await ehResponsavel(interaction))) return interaction.reply(efemero('❌ Sem permissão.'));
  const servidor = await gestao.servidorAtivo(interaction.guild.id);
  if (!servidor) return interaction.reply(efemero('❌ A ponte com o jogo não está ativa neste servidor.'));

  const atual = Object.entries(templatesEfetivos(servidor.templates)).map(([c, t]) => `${c} = ${t}`).join('\n');
  const modal = new ModalBuilder()
    .setCustomId(MODAL_TEMPLATES)
    .setTitle('Comandos de punição no jogo')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('templates')
        .setLabel('Um por linha: nome = /comando {id} {tempo} {motivo}')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
        .setValue(atual.slice(0, 2000))
    ));
  return interaction.showModal(modal);
}

async function handlePonteTemplatesModal(interaction) {
  if (!(await ehResponsavel(interaction))) return interaction.reply(efemero('❌ Sem permissão.'));
  const objeto = {};
  for (const linha of interaction.fields.getTextInputValue('templates').split('\n')) {
    if (!linha.trim()) continue;
    const pos = linha.indexOf('=');
    if (pos < 1) return interaction.reply(efemero(`❌ Linha sem "=": \`${linha.slice(0, 80)}\``));
    objeto[linha.slice(0, pos).trim().toLowerCase()] = linha.slice(pos + 1).trim();
  }
  const { erro, templates } = validarTemplates(objeto);
  if (erro) return interaction.reply(efemero(`❌ ${erro}`));
  await PonteServidor.updateOne({ guildId: interaction.guild.id, ativo: true }, { $set: { templates } });
  return interaction.reply(efemero(`✅ Comandos salvos:\n\`\`\`\n${Object.entries(templates).map(([c, t]) => `${c} = ${t}`).join('\n')}\n\`\`\``));
}

async function handlePonteCodigoSlash(interaction) {
  // A permissão escondida no Discord não basta: a checagem real é o ID do dono.
  if (!gestao.ehDono(interaction.user.id)) {
    log.warn(`Tentativa de /ponte-codigo sem permissão: ${interaction.user.tag} (${interaction.user.id}) em ${interaction.guild?.id}`);
    await PonteUso.create({ guildId: interaction.guild?.id || '', acao: 'codigo_negado', detalhes: { userId: interaction.user.id } }).catch(() => {});
    return interaction.reply(efemero('❌ Sem permissão.'));
  }
  const validadeDias = interaction.options.getInteger('validade_dias');
  const limitePcs = interaction.options.getInteger('limite_pcs');
  const { codigo } = await gestao.criarCodigo({ criadoPor: interaction.user.id, validadeDias, limitePcs });
  return interaction.reply(efemero([
    `✅ Código gerado (aparece só agora): \`${codigo}\``,
    `Validade: ${validadeDias ? `${validadeDias} dia(s)` : 'sem prazo'} • Limite de PCs: ${limitePcs || 'padrão'}`,
    'Na guild de destino: `/ativar codigo:` com este código.'
  ].join('\n')));
}

module.exports = {
  MODAL_TEMPLATES,
  MODAL_MOTIVOS,
  handlePonteMotivosModal,
  handleAtivarSlash,
  handleInstalacaoSlash,
  handlePonteSlash,
  handlePonteTemplatesModal,
  handlePonteCodigoSlash
};
