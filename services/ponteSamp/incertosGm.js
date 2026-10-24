// Pedidos incertos da gamemode: entregues sem resposta (lease vencido) ou com
// ERRO_GAMEMODE/TIMEOUT_GAMEMODE. Não se sabe se foram aplicados, então nunca
// voltam sozinhos: o Log Admin recebe dois botões e um responsável decide.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PontePunicao = require('../../models/PontePunicao');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const PonteServidor = require('../../models/PonteServidor');
const PonteUso = require('../../models/PonteUso');
const { marcarIncertos, registrarAplicada, fecharPunicaoSePronta } = require('./pedidosGm');
const { atualizarMensagemGm, descreverPunicao } = require('./discordGm');
const { nomeParaGamemode } = require('./protocoloGm');
const { LIMITES_GM_PADRAO } = require('./constantes');
const { ponteLigada } = require('./gestao');
const { getConfig } = require('../../utils/configCache');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });

const BOTAO_INCERTO_OK = 'ponte_gm_incerto_ok:';
const BOTAO_INCERTO_REENVIAR = 'ponte_gm_incerto_reenviar:';
const VERIFICAR_MS = 30 * 1000;

let intervalo = null;

function mensagemDoIncerto(pedido, punicao, resolvido = null) {
  const embed = new EmbedBuilder()
    .setColor(resolvido ? '#7F8C8D' : '#F39C12')
    .setTitle('⚠️ Punição incerta na gamemode')
    .setDescription([
      `Não dá para saber se a gamemode aplicou **${descreverPunicao(pedido)}** em \`${pedido.conta || pedido.nick}\` (${pedido.motivo}).`,
      pedido.codigo ? `Último código: \`${pedido.codigo}\`.` : 'A gamemode buscou o pedido e não respondeu a tempo.',
      'Confira no jogo e escolha abaixo. Nada é reenviado sozinho.',
      punicao?.msgDiscord?.link ? `🔗 [Abrir denúncia](${punicao.msgDiscord.link})` : '',
      resolvido ? `\n${resolvido}` : ''
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `Pedido ${pedido._id}` })
    .setTimestamp();
  const components = resolvido ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BOTAO_INCERTO_OK + pedido._id).setLabel('Foi aplicada').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BOTAO_INCERTO_REENVIAR + pedido._id).setLabel('Não foi aplicada, reenviar').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
  )];
  return { embeds: [embed], components };
}

// Avisa no Log Admin cada incerto ainda não avisado (um aviso por pedido).
async function avisarIncertos(client, agora = Date.now()) {
  let avisados = 0;
  for (let i = 0; i < 20; i++) {
    const pedido = await PontePedidoGm.findOneAndUpdate(
      { status: 'incerto', alertaIncertoEm: null }, { $set: { alertaIncertoEm: new Date(agora) } }, { new: true }
    ).lean();
    if (!pedido) break;
    try {
      const [config, punicao] = await Promise.all([getConfig(pedido.guildId).catch(() => null), PontePunicao.findById(pedido.punicaoId).lean()]);
      const canal = config?.channels?.log && client ? await client.channels.fetch(config.channels.log).catch(() => null) : null;
      atualizarMensagemGm(client, pedido.punicaoId).catch(() => {});
      if (!canal?.send) continue;
      const cargo = config?.roles?.responsavel_admin;
      const msg = await canal.send({
        content: cargo ? `<@&${cargo}>` : undefined,
        ...mensagemDoIncerto(pedido, punicao),
        allowedMentions: { roles: cargo ? [cargo] : [] }
      });
      await PontePedidoGm.updateOne({ _id: pedido._id }, { $set: { mensagemIncerto: { canalId: canal.id, msgId: msg.id } } });
      avisados += 1;
    } catch (erro) {
      log.warn(`Falha ao avisar pedido incerto ${pedido._id}: ${erro.message}`);
    }
  }
  return avisados;
}

// Um ciclo do job: lease vencido vira incerto e todo incerto novo é avisado.
async function verificarIncertos(client, agora = Date.now()) {
  if (!ponteLigada()) return { marcados: 0, avisados: 0 };
  const marcados = await marcarIncertos(agora);
  const avisados = await avisarIncertos(client, agora);
  return { marcados: marcados.length, avisados };
}

async function fecharAviso(client, pedido, punicao, texto) {
  const { canalId, msgId } = pedido.mensagemIncerto || {};
  if (!client || !canalId || !msgId) return;
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const msg = canal?.messages ? await canal.messages.fetch(msgId).catch(() => null) : null;
  await msg?.edit(mensagemDoIncerto(pedido, punicao, texto)).catch(() => {});
}

// Botões do Log Admin. aplicada=true: "Foi aplicada"; false: "Não foi aplicada, reenviar".
async function resolverIncerto({ client = null, pedidoId, guildId, staff, aplicada, agora = Date.now() }) {
  const resolvidoPor = { id: String(staff.id), nome: String(staff.nome || '').slice(0, 64), em: new Date(agora) };
  const pedido = await PontePedidoGm.findOneAndUpdate(
    { _id: pedidoId, guildId: String(guildId), status: 'incerto' },
    { $set: { status: aplicada ? 'aplicada' : 'cancelado', resolvidoPor } },
    { new: true }
  ).lean();
  if (!pedido) return { erro: 'Este pedido não está mais incerto (a gamemode respondeu ou alguém já resolveu).' };

  let novo = null;
  if (aplicada) {
    const conexao = (pedido.conexaoId && await PonteConexaoGm.findById(pedido.conexaoId, { nome: 1 }).lean()) || { nome: 'gamemode' };
    await registrarAplicada(pedido, { nome: `${conexao.nome} (confirmado por ${resolvidoPor.nome})` }, pedido.resultado || {}, agora);
    await fecharPunicaoSePronta({ client, punicaoId: pedido.punicaoId, conexao, agora });
  } else {
    // Pedido novo (rodada + 1) para o mesmo alvo, aprovado por quem confirmou.
    const servidor = await PonteServidor.findOne({ guildId: pedido.guildId }, { gm: 1 }).lean();
    const ultimo = await PontePedidoGm.findOne({ punicaoId: pedido.punicaoId, alvoId: pedido.alvoId }).sort({ rodada: -1 }).lean();
    novo = await PontePedidoGm.create({
      punicaoId: pedido.punicaoId,
      alvoId: pedido.alvoId,
      rodada: (ultimo?.rodada || pedido.rodada) + 1,
      denunciaId: pedido.denunciaId,
      guildId: pedido.guildId,
      tipo: pedido.tipo,
      conta: pedido.conta,
      nick: pedido.nick,
      tempo: pedido.tempo,
      avisos: pedido.avisos,
      somar: pedido.somar,
      motivo: pedido.motivo,
      aprovadoPor: nomeParaGamemode(staff.nome),
      teste: (servidor?.gm?.modoTeste ?? LIMITES_GM_PADRAO.modoTeste) === true,
      confirmadoPor: [resolvidoPor],
      status: 'aprovado',
      criadoEm: new Date(agora)
    });
  }

  await PonteUso.create({
    guildId: pedido.guildId,
    acao: aplicada ? 'gm_incerto_ok' : 'gm_incerto_reenviar',
    punicaoId: pedido.punicaoId,
    detalhes: { pedidoId: String(pedido._id), por: resolvidoPor.id, nome: resolvidoPor.nome, novoPedidoId: novo ? String(novo._id) : null }
  }).catch(() => {});

  const punicao = await PontePunicao.findById(pedido.punicaoId).lean();
  await fecharAviso(client, pedido, punicao, aplicada
    ? `✅ Marcada como aplicada por **${resolvidoPor.nome}**.`
    : `🔁 Reenviada por **${resolvidoPor.nome}** (pedido novo \`${novo._id}\`).`);
  atualizarMensagemGm(client, pedido.punicaoId).catch(() => {});
  return { ok: true, pedido, novo };
}

function iniciarJobGamemode(client) {
  if (intervalo || !ponteLigada()) return;
  intervalo = setInterval(() => {
    verificarIncertos(client).catch(erro => log.warn('Verificação de pedidos incertos falhou: ' + erro.message));
  }, VERIFICAR_MS);
  intervalo.unref?.();
  log.info('Verificação de pedidos incertos da gamemode ligada (a cada 30 s).');
}

module.exports = {
  BOTAO_INCERTO_OK,
  BOTAO_INCERTO_REENVIAR,
  mensagemDoIncerto,
  avisarIncertos,
  verificarIncertos,
  resolverIncerto,
  iniciarJobGamemode
};
