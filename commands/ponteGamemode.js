// /ponte gamemode …: credenciais da gamemode (só o dono do bot) e o funcionamento
// do modo gamemode na guild (responsável: pausar, retomar, executor e limites).
const {
  MessageFlags, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder
} = require('discord.js');
const PonteServidor = require('../models/PonteServidor');
const PonteConexaoGm = require('../models/PonteConexaoGm');
const PontePedidoGm = require('../models/PontePedidoGm');
const PonteUso = require('../models/PonteUso');
const gestao = require('../services/ponteSamp/gestao');
const conexoes = require('../services/ponteSamp/conexoesGm');
const { EXECUTORES, LIMITES_GM_PADRAO } = require('../services/ponteSamp/constantes');
const { getConfig } = require('../utils/configCache');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const MODAL_LIMITES = 'ponte_gm_limites_modal';
const SUBS_DO_DONO = ['criar', 'listar', 'revogar', 'renovar'];
const ONLINE_MS = 30 * 1000;

async function ehResponsavel(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const config = await getConfig(interaction.guild.id).catch(() => null);
  const cargo = config?.roles?.responsavel_admin;
  return !!cargo && !!interaction.member?.roles?.cache?.has(cargo);
}

const auditar = (interaction, acao, detalhes) => PonteUso.create({
  guildId: interaction.guild.id, acao, detalhes: { por: interaction.user.id, ...detalhes }
}).catch(() => {});

const quando = (data) => (data ? `<t:${Math.floor(new Date(data).getTime() / 1000)}:R>` : 'nunca');

function linhaDaConexao(c, agora = Date.now()) {
  const online = c.status === 'ativa' && c.ultimoContatoEm && agora - new Date(c.ultimoContatoEm).getTime() < ONLINE_MS;
  const estado = c.status !== 'ativa' ? '⛔ revogada' : c.pausada ? '⏸️ pausada' : online ? '🟢 online' : '⚪ offline';
  const ips = c.ipsPermitidos?.length ? c.ipsPermitidos.join(', ') : '⚠️ qualquer IP';
  const extra = [c.versaoInclude && `include ${c.versaoInclude}`, c.modoTesteInformado && '🧪 teste no jogo', c.ultimoIp && `IP ${c.ultimoIp}`].filter(Boolean).join(' • ');
  return `${estado} **${c.nome}** \`${c._id}\` • …${c.ultimos4} • IPs: ${ips} • contato ${quando(c.ultimoContatoEm)}${extra ? ` • ${extra}` : ''}`;
}

function respostaComArquivo(conexao, segredo, titulo, servidor) {
  const avisos = [
    `✅ ${titulo}: **${conexao.nome}** (\`${conexao._id}\`).`,
    '⚠️ O arquivo abaixo aparece **só agora**. Ele não vai para o código nem para o git.',
    'No servidor do jogo: salve como `scriptfiles/althea_credenciais.txt` e rode `rcon althea recarregar` (sem reiniciar).',
    !conexao.ipsPermitidos?.length && '⚠️ Sem IPs na lista: qualquer IP com a credencial é aceito. Quando souber os IPs do servidor, crie uma credencial nova com `ips:` e revogue esta.',
    servidor?.executor === 'pc' && 'ℹ️ Este servidor ainda aplica pelo PC: use `/ponte gamemode executor tipo:` para ligar a gamemode.',
    servidor?.gm?.modoTeste !== false && '🧪 Modo teste ligado: a gamemode só simula. Desligue em `/ponte gamemode limites` quando os testes terminarem.'
  ].filter(Boolean);
  return {
    content: avisos.join('\n'),
    files: [new AttachmentBuilder(Buffer.from(conexoes.arquivoCredenciais(conexao, segredo), 'utf8'), { name: 'althea_credenciais.txt' })],
    flags: [MessageFlags.Ephemeral]
  };
}

async function credenciais(interaction, sub) {
  // A permissão escondida no Discord não basta: a checagem real é o ID do dono.
  if (!gestao.ehDono(interaction.user.id)) {
    log.warn(`Tentativa de /ponte gamemode ${sub} sem permissão: ${interaction.user.tag} (${interaction.user.id}) em ${interaction.guild?.id}`);
    await auditar(interaction, 'gm_credencial', { sub, negado: true });
    return interaction.reply(efemero('❌ Só o dono do bot cria, lista, revoga e renova credenciais da gamemode.'));
  }
  const guildId = interaction.guild.id;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  if (sub === 'criar' || sub === 'renovar') {
    const r = sub === 'criar'
      ? await conexoes.criarConexao({ guildId, nome: interaction.options.getString('nome', true), ips: interaction.options.getString('ips') || '', criadoPor: interaction.user.id })
      : await conexoes.renovarConexao({ guildId, id: interaction.options.getString('id', true) });
    if (r.erro) return interaction.editReply(`❌ ${r.erro}`);
    await auditar(interaction, 'gm_credencial', { sub, conexaoId: String(r.conexao._id), ips: r.conexao.ipsPermitidos?.length || 0 });
    log.info(`Credencial da gamemode ${sub === 'criar' ? 'criada' : 'renovada'}: ${r.conexao.nome} (${guildId}) por ${interaction.user.tag}`);
    const servidor = await PonteServidor.findOne({ guildId }).lean();
    return interaction.editReply(respostaComArquivo(r.conexao, r.segredo, sub === 'criar' ? 'Credencial criada' : 'Credencial renovada (a anterior parou de valer)', servidor));
  }

  if (sub === 'revogar') {
    const c = await conexoes.revogarConexao({ guildId, id: interaction.options.getString('id', true), por: interaction.user.id });
    if (c) await auditar(interaction, 'gm_credencial', { sub, conexaoId: String(c._id) });
    return interaction.editReply(c ? `✅ Credencial **${c.nome}** revogada. A gamemode passa a receber 403 (REVOGADA).` : '❌ Credencial ativa não encontrada neste servidor.');
  }

  const lista = await conexoes.listarConexoes(guildId);
  if (lista.length === 0) return interaction.editReply('ℹ️ Nenhuma credencial da gamemode neste servidor. Use `/ponte gamemode criar`.');
  return interaction.editReply(lista.map(c => linhaDaConexao(c)).join('\n').slice(0, 1900));
}

function modalDeLimites(servidor) {
  const gm = { ...LIMITES_GM_PADRAO, ...(servidor.gm || {}) };
  const campo = (id, rotulo, valor, max = 5) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setValue(String(valor))
  );
  return new ModalBuilder()
    .setCustomId(MODAL_LIMITES)
    .setTitle('Limites da gamemode')
    .addComponents(
      campo('maxBanDias', 'Ban máximo (dias)', gm.maxBanDias),
      campo('maxCadeiaMin', 'Cadeia máxima (minutos)', gm.maxCadeiaMin),
      campo('maxAvisos', 'Avisos no máximo (0 a 10)', gm.maxAvisos, 2),
      campo('permitirPermanente', 'Ban permanente pelo bot? (sim/não)', gm.permitirPermanente ? 'sim' : 'não', 3),
      campo('modoTeste', 'Modo teste (só simula)? (sim/não)', gm.modoTeste ? 'sim' : 'não', 3)
    );
}

// Texto do modal → limites gm.*. Devolve { gm } ou { erro }.
function lerLimites(campos) {
  const inteiro = (nome, rotulo, min, max) => {
    const valor = Number(String(campos[nome] ?? '').trim());
    return Number.isInteger(valor) && valor >= min && valor <= max ? valor : { erro: `${rotulo}: use um número de ${min} a ${max}.` };
  };
  const simNao = (nome, rotulo) => {
    const valor = String(campos[nome] ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (['sim', 's'].includes(valor)) return true;
    if (['nao', 'n'].includes(valor)) return false;
    return { erro: `${rotulo}: responda sim ou não.` };
  };
  const gm = {
    maxBanDias: inteiro('maxBanDias', 'Ban máximo', 1, 99999),
    maxCadeiaMin: inteiro('maxCadeiaMin', 'Cadeia máxima', 1, 99999),
    maxAvisos: inteiro('maxAvisos', 'Avisos', 0, 10),
    permitirPermanente: simNao('permitirPermanente', 'Ban permanente'),
    modoTeste: simNao('modoTeste', 'Modo teste')
  };
  const erro = Object.values(gm).find(v => v && typeof v === 'object');
  return erro ? { erro: erro.erro } : { gm };
}

async function configuracao(interaction, sub) {
  if (!(await ehResponsavel(interaction))) return interaction.reply(efemero('❌ Só o responsável muda o modo gamemode deste servidor.'));
  const guildId = interaction.guild.id;
  const servidor = await gestao.servidorAtivo(guildId);
  if (!servidor) return interaction.reply(efemero('❌ A ponte com o jogo não está ativa neste servidor.'));

  if (sub === 'limites') return interaction.showModal(modalDeLimites(servidor));

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  if (sub === 'pausar') {
    await PonteServidor.updateOne({ guildId }, { $set: { 'gm.pausado': true } });
    await auditar(interaction, 'gm_config', { sub });
    return interaction.editReply('⏸️ Gamemode pausada: as buscas passam a vir vazias e nada novo é entregue. Os pedidos ficam na fila até `/ponte gamemode retomar`.');
  }
  if (sub === 'retomar') {
    await PonteServidor.updateOne({ guildId }, { $set: { 'gm.pausado': false } });
    // Também solta as credenciais pausadas por selo inválido.
    const { modifiedCount } = await PonteConexaoGm.updateMany({ guildId, status: 'ativa', pausada: true }, { $set: { pausada: false } });
    await auditar(interaction, 'gm_config', { sub, conexoesRetomadas: modifiedCount });
    return interaction.editReply(`▶️ Gamemode retomada.${modifiedCount ? ` ${modifiedCount} credencial(is) pausada(s) por selo inválido voltaram a funcionar.` : ''}`);
  }
  if (sub === 'executor') {
    const tipo = interaction.options.getString('tipo', true);
    if (!EXECUTORES.includes(tipo)) return interaction.editReply('❌ Tipo inválido.');
    await PonteServidor.updateOne({ guildId }, { $set: { executor: tipo } });
    await auditar(interaction, 'gm_config', { sub, de: servidor.executor, para: tipo });
    const pendentes = tipo === 'pc' ? await PontePedidoGm.countDocuments({ guildId, status: { $in: ['aprovado', 'entregue', 'incerto'] } }) : 0;
    const texto = {
      pc: '🖥️ Agora só o PC da staff aplica. A API da gamemode passa a responder 403.',
      gamemode: '🎮 Agora só a gamemode aplica. Punições novas ganham o embed "Enviar ao jogo" no Relatório de punições, e o PC não executa mais.',
      ambos: '🔀 PC e gamemode aplicam: quem pegar primeiro leva (a punição só sai da fila uma vez).'
    }[tipo];
    return interaction.editReply(`${texto}${pendentes ? `\n⚠️ Ainda há ${pendentes} pedido(s) da gamemode em andamento: eles não serão entregues enquanto o executor for PC.` : ''}`);
  }
  return interaction.editReply('❌ Subcomando desconhecido.');
}

async function handlePonteGamemode(interaction) {
  if (!gestao.ponteLigada()) return interaction.reply(efemero('❌ A ponte com o jogo está desligada neste bot.'));
  const sub = interaction.options.getSubcommand();
  return SUBS_DO_DONO.includes(sub) ? credenciais(interaction, sub) : configuracao(interaction, sub);
}

async function handleLimitesGmModal(interaction) {
  if (!(await ehResponsavel(interaction))) return interaction.reply(efemero('❌ Sem permissão.'));
  const ler = (id) => interaction.fields.getTextInputValue(id);
  const { erro, gm } = lerLimites({
    maxBanDias: ler('maxBanDias'), maxCadeiaMin: ler('maxCadeiaMin'), maxAvisos: ler('maxAvisos'),
    permitirPermanente: ler('permitirPermanente'), modoTeste: ler('modoTeste')
  });
  if (erro) return interaction.reply(efemero(`❌ ${erro}`));
  const $set = Object.fromEntries(Object.entries(gm).map(([chave, valor]) => [`gm.${chave}`, valor]));
  const salvo = await PonteServidor.findOneAndUpdate({ guildId: interaction.guild.id, ativo: true }, { $set }, { new: true }).lean();
  if (!salvo) return interaction.reply(efemero('❌ A ponte com o jogo não está ativa neste servidor.'));
  await auditar(interaction, 'gm_config', { sub: 'limites', ...gm });
  return interaction.reply(efemero([
    '✅ Limites salvos (valem para os próximos envios):',
    `• Ban até **${gm.maxBanDias}** dias • permanente: **${gm.permitirPermanente ? 'liberado' : 'bloqueado'}**`,
    `• Cadeia até **${gm.maxCadeiaMin}** min • avisos até **${gm.maxAvisos}**`,
    gm.modoTeste ? '• 🧪 Modo teste **ligado**: a gamemode só simula.' : '• ⚠️ Modo teste **desligado**: os próximos envios são aplicados de verdade.',
    'Lembre de deixar os limites da gamemode (`ALTHEA_MAX_*`) iguais ou maiores; o que passar do limite dela é recusado lá.'
  ].join('\n')));
}

module.exports = { MODAL_LIMITES, handlePonteGamemode, handleLimitesGmModal, lerLimites, linhaDaConexao };
