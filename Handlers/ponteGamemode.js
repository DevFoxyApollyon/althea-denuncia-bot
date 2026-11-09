// Botões, menu e modal do embed "🎮 Punição para o jogo" (modo gamemode da ponte).
// Só o cargo responsavel_admin usa; a regra de negócio fica em services/ponteSamp/discordGm.js.
const {
  MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const PontePunicao = require('../models/PontePunicao');
const gm = require('../services/ponteSamp/discordGm');
const { BOTAO_INCERTO_OK, resolverIncerto, resolverIncertosDaPunicao } = require('../services/ponteSamp/incertosGm');
const { getConfig } = require('../utils/configCache');
const { obterTabela } = require('../services/ponteSamp/motivos');
const { classificarMotivo } = require('../services/ponteSamp/validacao');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });
const efemero = (content) => ({ content, flags: [MessageFlags.Ephemeral] });
const RE_ID = /^[0-9a-f]{24}$/;

async function ehResponsavelAdmin(interaction) {
  const config = await getConfig(interaction.guild?.id).catch(() => null);
  const cargo = config?.roles?.responsavel_admin;
  return !!cargo && !!interaction.member?.roles?.cache?.has(cargo);
}

const staffDe = (interaction) => ({ id: interaction.user.id, nome: interaction.member?.displayName || interaction.user.username });

// customId "prefixo<a>:<b>:..." → partes; null se algum id não for ObjectId.
function partes(customId, prefixo, ids = 1) {
  const lista = customId.slice(prefixo.length).split(':');
  // O segundo ID pode ser "novo" (jogador que ainda não existe na punição).
  return lista.slice(0, ids).every((id, i) => RE_ID.test(id) || (i === 1 && id === 'novo')) ? lista : null;
}

async function exigirResponsavel(interaction) {
  if (await ehResponsavelAdmin(interaction)) return true;
  await interaction.reply(efemero('❌ Só o responsável admin decide as punições para o jogo.')).catch(() => {});
  return false;
}

async function handleEnviarGm(interaction) {
  const [punicaoId] = partes(interaction.customId, gm.BOTAO_ENVIAR) || [];
  if (!punicaoId || !(await exigirResponsavel(interaction))) return;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const r = await gm.enviarAoJogo({ client: interaction.client, punicaoId, guildId: interaction.guild.id, staff: staffDe(interaction) });
  if (r.erro) log.warn(`"Enviar ao jogo" da punição ${punicaoId} não foi: ${r.erro}`);
  await interaction.editReply({
    content: r.erro
      ? `❌ ${r.erro}`
      : `📤 ${r.pedidos} pedido(s) na fila da gamemode.${r.teste ? ' 🧪 Modo teste ligado: a gamemode só vai simular.' : ''}`
  }).catch(() => {});
}

async function handleCancelarGm(interaction) {
  const [punicaoId] = partes(interaction.customId, gm.BOTAO_CANCELAR) || [];
  if (!punicaoId || !(await exigirResponsavel(interaction))) return;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const r = await gm.cancelarGm({ client: interaction.client, punicaoId, guildId: interaction.guild.id, staff: staffDe(interaction) });
  let texto;
  if (r.erro) texto = `❌ ${r.erro}`;
  else if (r.voltouParaCadeia) texto = '✖️ Envio cancelado: a denúncia voltou para a Cadeia Staff com Aceitar e Recusar. Aceitar de novo envia ao jogo normalmente.';
  else if (r.status === 'cancelada') texto = '✖️ Punição cancelada: não vai para o jogo.';
  else texto = r.emAndamento
    ? `✖️ ${r.cancelados} pedido(s) cancelado(s). ${r.emAndamento} já estava(m) com a gamemode: o resultado deles ainda vai chegar.`
    : `✖️ Envio cancelado (${r.cancelados} pedido(s)). A punição voltou a esperar envio.`;
  await interaction.editReply({ content: texto }).catch(() => {});
}

// Punição sem jogador: o mesmo modal, com o ID da conta para criar o jogador.
const alvoNovo = (punicao) => ({ _id: 'novo', contaId: '', cmd: 'ban', tempo: 1, avisos: 1, motivo: String(punicao.msgDiscord?.motivo || '').slice(0, 60) });

function modalDoAlvo(punicao, alvo) {
  // O Discord recusa rótulo com mais de 45 letras (o modal nem abre): o detalhe vai no exemplo do campo.
  const campo = (id, rotulo, valor, estilo = TextInputStyle.Short, max = 10, exemplo = '') => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(rotulo.slice(0, 45)).setStyle(estilo).setRequired(id !== 'avisos').setMaxLength(max)
      .setValue(String(valor ?? '').slice(0, max)).setPlaceholder(exemplo || rotulo.slice(0, 100))
  );
  const novo = alvo._id === 'novo';
  return new ModalBuilder()
    .setCustomId(`${gm.MODAL_ALVO}${punicao._id}:${alvo._id}:${punicao.versao}`)
    .setTitle(novo ? 'Adicionar o jogador' : `Punição de ${String(alvo.contaId || alvo.nick || 'alvo').slice(0, 30)}`)
    .addComponents(
      ...(novo ? [campo('conta', 'ID da conta (vários com +)', '', TextInputStyle.Short, 100, 'Ex.: 1270101 ou 1270101+360429')] : []),
      campo('tipo', 'Tipo (ban ou cadeia)', alvo.cmd, TextInputStyle.Short, 6),
      campo('tempo', 'Tempo', alvo.tempo, TextInputStyle.Short, 5, 'Ban: dias (0 = permanente). Cadeia: minutos.'),
      campo('avisos', 'Avisos', alvo.avisos ?? 0, TextInputStyle.Short, 2),
      campo('motivo', 'Motivo ([DC] é colocado sozinho)', alvo.motivo, TextInputStyle.Short, 60)
    );
}

// Ao abrir a edição, o tipo, o tempo e os avisos vêm da tabela atual quando o motivo está
// nela (a tabela pode ter mudado depois do aceite). Fora da tabela, ficam os do jogador.
async function comTabelaAtual(alvo) {
  const { tabela } = await obterTabela().catch(() => ({ tabela: null }));
  if (!tabela || !alvo?.motivo) return alvo;
  const c = classificarMotivo(alvo.motivo, tabela);
  if (!c.regra || c.cmd === 'registro') return alvo;
  return { ...alvo, cmd: c.cmd, tempo: c.tempo, avisos: c.avisos };
}

async function punicaoParaEditar(interaction, punicaoId) {
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: interaction.guild.id }).lean();
  if (!punicao || punicao.status !== 'aceita') {
    // Embed velho com botões de antes: diz o que aconteceu e refaz o embed (os botões somem).
    const situacao = {
      executando: 'já foi enviada ao jogo e está esperando a resposta',
      aplicada: 'já foi aplicada',
      cancelada: 'foi cancelada'
    }[punicao?.status] || 'não existe mais (passou do prazo de guarda ou foi apagada)';
    await interaction.reply(efemero(`❌ Esta punição ${situacao}. O embed foi atualizado.`)).catch(() => {});
    if (punicao) gm.atualizarMensagemGm(interaction.client, punicao._id).catch(() => {});
    return null;
  }
  return punicao;
}

// Um alvo: abre o modal direto. Vários: escolhe o alvo num menu.
async function handleEditarGm(interaction) {
  const [punicaoId] = partes(interaction.customId, gm.BOTAO_EDITAR) || [];
  if (!punicaoId || !(await exigirResponsavel(interaction))) return;
  const punicao = await punicaoParaEditar(interaction, punicaoId);
  if (!punicao) return;
  const alvos = gm.alvosAtivos(punicao);
  if (alvos.length === 0) return interaction.showModal(modalDoAlvo(punicao, alvoNovo(punicao)));
  if (alvos.length === 1) return interaction.showModal(modalDoAlvo(punicao, await comTabelaAtual(alvos[0])));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${gm.MENU_ALVO}${punicao._id}`)
    .setPlaceholder('Escolha o jogador')
    .addOptions(alvos.slice(0, 25).map((a, i) => ({
      label: `${i + 1}. ${a.contaId || a.nick || '?'}`.slice(0, 100),
      description: `${a.cmd} ${a.tempo}${a.avisos ? ` + ${a.avisos} aviso(s)` : ''}: ${a.motivo || 'sem motivo'}`.slice(0, 100),
      value: String(a._id)
    })));
  await interaction.reply({ ...efemero('Qual jogador você quer editar?'), components: [new ActionRowBuilder().addComponents(menu)] });
}

async function handleMenuAlvoGm(interaction) {
  const [punicaoId] = partes(interaction.customId, gm.MENU_ALVO) || [];
  if (!punicaoId || !(await exigirResponsavel(interaction))) return;
  const punicao = await punicaoParaEditar(interaction, punicaoId);
  if (!punicao) return;
  const alvo = gm.alvosAtivos(punicao).find(a => String(a._id) === interaction.values?.[0]);
  if (!alvo) return interaction.reply(efemero('❌ Jogador não encontrado.'));
  await interaction.showModal(modalDoAlvo(punicao, await comTabelaAtual(alvo)));
}

async function handleModalAlvoGm(interaction) {
  const dados = partes(interaction.customId, gm.MODAL_ALVO, 2);
  if (!dados || !(await exigirResponsavel(interaction))) return;
  const [punicaoId, alvoId, versao] = dados;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const ler = (id) => { try { return interaction.fields.getTextInputValue(id) ?? ''; } catch { return ''; } };
  const r = await gm.editarAlvoGm({
    client: interaction.client,
    punicaoId,
    guildId: interaction.guild.id,
    alvoId,
    versao: Number(versao),
    campos: { conta: ler('conta'), tipo: ler('tipo'), tempo: ler('tempo'), avisos: ler('avisos'), motivo: ler('motivo') },
    staff: staffDe(interaction)
  }).catch((error) => {
    log.error('Falha ao editar alvo da gamemode', error);
    return { erro: 'Não foi possível salvar. Tente de novo.' };
  });
  await interaction.editReply({
    content: r.erro ? `❌ ${r.erro}` : `✅ Alvo atualizado.${r.aviso ? ` ⚠️ Ainda não dá para enviar: ${r.aviso}` : ''}`
  }).catch(() => {});
}

// Botões do aviso de incerto no Log Admin: "Foi aplicada" ou "Não foi aplicada, reenviar".
async function handleIncertoGm(interaction) {
  const aplicada = interaction.customId.startsWith(BOTAO_INCERTO_OK);
  const pedidoId = interaction.customId.split(':').pop();
  if (!RE_ID.test(pedidoId) || !(await exigirResponsavel(interaction))) return;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const r = await resolverIncerto({ client: interaction.client, pedidoId, guildId: interaction.guild.id, staff: staffDe(interaction), aplicada })
    .catch((error) => {
      log.error('Falha ao resolver pedido incerto', error);
      return { erro: 'Não foi possível registrar. Tente de novo.' };
    });
  await interaction.editReply({
    content: r.erro ? `❌ ${r.erro}` : aplicada ? '✅ Registrado como aplicado.' : '🔁 Pedido reenviado para a gamemode.'
  }).catch(() => {});
}

// Botões do embed travado no Relatório de punições: "Foi aplicada" ou "Tentar novamente".
async function handleIncertoDaPunicaoGm(interaction) {
  const aplicada = interaction.customId.startsWith(gm.BOTAO_GM_APLICADA);
  const [punicaoId] = partes(interaction.customId, aplicada ? gm.BOTAO_GM_APLICADA : gm.BOTAO_GM_REAPLICAR) || [];
  if (!punicaoId || !(await exigirResponsavel(interaction))) return;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const r = await resolverIncertosDaPunicao({ client: interaction.client, punicaoId, guildId: interaction.guild.id, staff: staffDe(interaction), aplicada })
    .catch((error) => {
      log.error('Falha ao resolver os pedidos incertos da punição', error);
      return { erro: 'Não foi possível registrar. Tente de novo.' };
    });
  let texto;
  if (r.erro) texto = `❌ ${r.erro}`;
  else if (aplicada) texto = '✅ Registrado como aplicado.';
  else texto = '🔁 Enviada de novo para a gamemode.';
  await interaction.editReply({ content: texto }).catch(() => {});
}

module.exports = { handleIncertoDaPunicaoGm, handleEnviarGm, handleCancelarGm, handleEditarGm, handleMenuAlvoGm, handleModalAlvoGm, handleIncertoGm, modalDoAlvo };
