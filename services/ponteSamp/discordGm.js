// Punição para o jogo no modo gamemode: o embed "🎮 Punição para o jogo" no Relatório
// de punições e o que os botões dele fazem (enviar, editar, cancelar).
// Nada é enviado à gamemode sem um responsável clicar em "Enviar ao jogo".
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PontePunicao = require('../../models/PontePunicao');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PonteServidor = require('../../models/PonteServidor');
const PonteUso = require('../../models/PonteUso');
const { motivoComSufixo, validarAlvos, RE_NICK } = require('./validacao');
const { motivoParaGamemode, nomeParaGamemode } = require('./protocoloGm');
const { fecharPunicaoSePronta } = require('./pedidosGm');
const { LIMITES_GM_PADRAO } = require('./constantes');
const { getConfig } = require('../../utils/configCache');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });

const BOTAO_ENVIAR = 'ponte_gm_enviar:';
const BOTAO_EDITAR = 'ponte_gm_editar:';
const BOTAO_CANCELAR = 'ponte_gm_cancelar:';
const MENU_ALVO = 'ponte_gm_alvo:';
const MODAL_ALVO = 'ponte_gm_modal:';

const EXECUTORES_GM = ['gamemode', 'ambos'];

// A mesma regra do Alt_MotivoValido do include (althea_ponte/althea_util.inc, fora do bot):
// 1 a 60 caracteres deste conjunto, sem "/" nem espaço no começo.
const RE_MOTIVO_GM = /^(?![/ ])[A-Za-z0-9 .,:;!?()[\]\-_+#*@&/]{1,60}$/;
const motivoGmValido = (motivo) => RE_MOTIVO_GM.test(String(motivo)) && String(motivo).endsWith(' [DC]');

const limitesDe = (servidor) => ({ ...LIMITES_GM_PADRAO, ...(servidor?.gm || {}) });
const alvosAtivos = (punicao) => (punicao.alvos || []).filter(a => !a.removido);

// "ban 5 dias + 1 aviso", "ban permanente", "cadeia 120 min".
function descreverPunicao({ tipo, tempo, avisos }) {
  const base = tipo === 'cadeia' ? `cadeia ${tempo} min` : tempo === 0 ? 'ban permanente' : `ban ${tempo} dia${tempo === 1 ? '' : 's'}`;
  return avisos > 0 ? `${base} + ${avisos} aviso${avisos === 1 ? '' : 's'}` : base;
}

// Alvo da punição → campos do pedido (seção 5 da especificação). Devolve { pedido } ou { erro }.
function pedidoDoAlvo(alvo, servidor) {
  const limites = limitesDe(servidor);
  const quem = alvo.contaId || alvo.nick || '?';
  if (!alvo.regra) return { erro: `${quem}: motivo fora da tabela. Edite o alvo antes de enviar.` };
  const tipo = alvo.cmd;
  const tempo = Number(alvo.tempo) || 0;
  const avisos = Number(alvo.avisos) || 0;
  const conta = Number(alvo.contaId) || 0;
  const nick = conta ? '' : String(alvo.nick || '');
  if (!conta && !RE_NICK.test(nick)) return { erro: `${quem}: sem ID de conta nem nick válido.` };
  if (tipo === 'ban') {
    if (tempo === 0 && !limites.permitirPermanente) return { erro: `${quem}: ban permanente não é liberado pelo bot neste servidor.` };
    if (tempo > limites.maxBanDias) return { erro: `${quem}: ban de ${tempo} dias passa do máximo (${limites.maxBanDias}).` };
  } else if (tipo === 'cadeia') {
    if (tempo < 1 || tempo > limites.maxCadeiaMin) return { erro: `${quem}: cadeia precisa ser de 1 a ${limites.maxCadeiaMin} minutos.` };
  } else {
    return { erro: `${quem}: tipo "${tipo}" não vai para a gamemode.` };
  }
  if (avisos > limites.maxAvisos) return { erro: `${quem}: ${avisos} avisos passam do máximo (${limites.maxAvisos}).` };
  const motivo = motivoParaGamemode(motivoComSufixo(alvo.motivo));
  if (!motivoGmValido(motivo)) return { erro: `${quem}: motivo vazio ou inválido para a gamemode. Edite o alvo.` };
  return { pedido: { alvoId: alvo._id, tipo, conta, nick, tempo, avisos, somar: tipo === 'ban', motivo } };
}

// Último pedido de cada alvo (maior rodada).
function ultimosPorAlvo(pedidos) {
  const mapa = new Map();
  for (const p of [...pedidos].sort((a, b) => b.rodada - a.rodada)) {
    if (!mapa.has(String(p.alvoId))) mapa.set(String(p.alvoId), p);
  }
  return mapa;
}

const ICONES = {
  aprovado: '⏳ na fila da gamemode',
  entregue: '📤 entregue, aguardando resposta',
  aplicada: '✅ aplicada',
  simulada: '🧪 simulada (modo teste)',
  recusada: '❌ recusada',
  erro: '⛔ erro',
  incerto: '⚠️ incerto (conferir no jogo)',
  cancelado: '🚫 cancelado'
};

const estadoDoPedido = (p) => `${ICONES[p.status] || p.status}${p.codigo && !['OK', 'SIMULADA'].includes(p.codigo) ? ` (${p.codigo})` : ''}`;

// Esperando envio: mostra o alvo como vai sair (e o último resultado, se já foi tentado).
// Depois do envio: mostra o pedido que foi para a gamemode e o estado dele.
function linhaDoAlvo(alvo, indice, pedido, servidor, esperandoEnvio) {
  const quem = alvo.contaId ? `\`${alvo.contaId}\`` : `\`${alvo.nick || '?'}\``;
  const previa = pedidoDoAlvo(alvo, servidor);
  const dados = esperandoEnvio ? previa.pedido : pedido || previa.pedido;
  const punicao = dados ? `${descreverPunicao(dados)}: ${dados.motivo}` : `${alvo.cmd} ${alvo.tempo}: ${alvo.motivo || 'sem motivo'}`;
  const estados = [];
  if (esperandoEnvio && previa.erro) estados.push(`⚠️ ${previa.erro.replace(/^[^:]+: /, '')}`);
  if (pedido) estados.push(esperandoEnvio ? `última tentativa: ${estadoDoPedido(pedido)}` : estadoDoPedido(pedido));
  return `**${indice + 1}.** ${quem} — ${punicao}${estados.length ? ` — ${estados.join(' · ')}` : ''}`.slice(0, 300);
}

// Embed e botões conforme o estado da punição. Puro: só lê o que recebe.
function montarMensagemGm(punicao, pedidos, servidor) {
  const ultimos = ultimosPorAlvo(pedidos || []);
  const alvos = alvosAtivos(punicao);
  const pedidosDaVez = alvos.map(a => ultimos.get(String(a._id))).filter(Boolean);
  const enviadoPor = pedidosDaVez.find(p => p.confirmadoPor?.length)?.confirmadoPor[0]?.nome || pedidosDaVez[0]?.aprovadoPor || '';
  const teste = pedidosDaVez.length ? pedidosDaVez.some(p => p.teste) : limitesDe(servidor).modoTeste;

  const situacao = {
    aceita: pedidosDaVez.length
      ? '🔁 Nenhum alvo foi aplicado na última tentativa. Confira e envie de novo, se for o caso.'
      : '⏳ Aguardando um responsável enviar ao jogo.',
    executando: `📤 Enviado por **${enviadoPor || 'responsável'}**, aguardando a gamemode.`,
    aplicada: '✅ Aplicada pela gamemode.',
    cancelada: '❌ Cancelada: não vai para o jogo.'
  }[punicao.status] || punicao.status;

  const esperandoEnvio = punicao.status === 'aceita';
  const linhas = alvos.map((a, i) => linhaDoAlvo(a, i, ultimos.get(String(a._id)), servidor, esperandoEnvio));
  const topo = [
    punicao.msgDiscord?.acusado && `**Acusado:** ${String(punicao.msgDiscord.acusado).slice(0, 200)}`,
    punicao.aceitoPor?.nome && `**Aceita por:** ${punicao.aceitoPor.nome}`
  ].filter(Boolean);
  const rodape = [
    situacao,
    teste && punicao.status !== 'cancelada' && '🧪 Modo teste ligado: a gamemode só simula, nada é aplicado.',
    punicao.msgDiscord?.link && `🔗 [Abrir denúncia](${punicao.msgDiscord.link})`
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor({ aceita: '#F1C40F', executando: '#3498DB', aplicada: '#2ECC71', cancelada: '#7F8C8D' }[punicao.status] || '#2B2D31')
    .setTitle('🎮 Punição para o jogo')
    .setDescription([...topo, ...(topo.length ? [''] : []), ...linhas, '', ...rodape].join('\n').slice(0, 4000))
    .setFooter({ text: `Punição ${punicao._id}` })
    .setTimestamp();

  const id = String(punicao._id);
  const botoes = [];
  if (punicao.status === 'aceita') {
    botoes.push(
      new ButtonBuilder().setCustomId(BOTAO_ENVIAR + id).setLabel('Enviar ao jogo').setEmoji('🎮').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BOTAO_EDITAR + id).setLabel('Editar').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BOTAO_CANCELAR + id).setLabel('Cancelar').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
  } else if (punicao.status === 'executando' && punicao.executor === 'gamemode') {
    botoes.push(new ButtonBuilder().setCustomId(BOTAO_CANCELAR + id).setLabel('Cancelar envio').setEmoji('✖️').setStyle(ButtonStyle.Danger));
  }
  return { embeds: [embed], components: botoes.length ? [new ActionRowBuilder().addComponents(botoes)] : [] };
}

async function canalDoRelatorio(client, guildId) {
  const config = await getConfig(guildId).catch(() => null);
  const canalId = config?.channels?.relatorioPunicoes || config?.channels?.log;
  const canal = canalId && client ? await client.channels.fetch(canalId).catch(() => null) : null;
  return canal?.send ? canal : null;
}

// Depois do aceite (guild em gamemode ou ambos): posta o embed no Relatório de punições.
async function postarPunicaoGm(client, punicao, servidor) {
  if (!EXECUTORES_GM.includes(servidor?.executor)) return null;
  const canal = await canalDoRelatorio(client, punicao.guildId);
  if (!canal) {
    log.warn(`Guild ${punicao.guildId}: sem canal de Relatório de punições (nem Log Admin) para o embed da gamemode.`);
    return null;
  }
  const msg = await canal.send({ ...montarMensagemGm(punicao, [], servidor), allowedMentions: { parse: [] } });
  await PontePunicao.updateOne({ _id: punicao._id }, { $set: { mensagemGm: { canalId: canal.id, msgId: msg.id } } });
  return msg;
}

// Refaz o embed com o estado atual do banco (resultado da gamemode, edição, cancelamento).
async function atualizarMensagemGm(client, punicaoId) {
  if (!client) return;
  const punicao = await PontePunicao.findById(punicaoId).lean();
  const { canalId, msgId } = punicao?.mensagemGm || {};
  if (!canalId || !msgId) return;
  const [pedidos, servidor] = await Promise.all([
    PontePedidoGm.find({ punicaoId }).lean(),
    PonteServidor.findOne({ guildId: punicao.guildId }).lean()
  ]);
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const msg = canal?.messages ? await canal.messages.fetch(msgId).catch(() => null) : null;
  await msg?.edit(montarMensagemGm(punicao, pedidos, servidor)).catch(e => log.warn('Falha ao editar o embed da gamemode', e?.message));
}

const auditar = (acao, punicao, staff, detalhes = null) => PonteUso.create({
  guildId: punicao.guildId, acao, punicaoId: punicao._id, detalhes: { por: staff?.id || '', nome: staff?.nome || '', ...(detalhes || {}) }
}).catch(() => {});

async function servidorGm(guildId) {
  const servidor = await PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor.' };
  if (!EXECUTORES_GM.includes(servidor.executor)) return { erro: 'Este servidor aplica as punições pelo PC, não pela gamemode.' };
  return { servidor };
}

// Botão "Enviar ao jogo": cria um pedido por alvo e tira a punição da fila do PC.
async function enviarAoJogo({ client = null, punicaoId, guildId, staff }) {
  const { servidor, erro } = await servidorGm(guildId);
  if (erro) return { erro };
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: String(guildId) }).lean();
  if (!punicao) return { erro: 'Punição não encontrada.' };
  if (punicao.status !== 'aceita') return { erro: 'Esta punição não está mais esperando envio.' };
  const alvos = alvosAtivos(punicao);
  if (alvos.length === 0) return { erro: 'A punição não tem alvos.' };

  const montados = alvos.map(a => pedidoDoAlvo(a, servidor));
  const falha = montados.find(m => m.erro);
  if (falha) return { erro: falha.erro };

  // Só sai de "aceita" uma vez: o PC (modo ambos) e um segundo clique perdem a corrida.
  const tomada = await PontePunicao.findOneAndUpdate(
    { _id: punicao._id, status: 'aceita', versao: punicao.versao },
    // executandoDesde fica nulo: a liberação de execução presa do PC não mexe nos pedidos da gamemode.
    { $set: { status: 'executando', executor: 'gamemode', executandoPor: null, executandoDesde: null }, $inc: { versao: 1 } },
    { new: true }
  ).lean();
  if (!tomada) return { erro: 'A punição mudou ou já foi enviada. Confira o embed.' };

  const anteriores = await PontePedidoGm.find({ punicaoId: punicao._id }, { alvoId: 1, rodada: 1 }).lean();
  const rodadaDe = (alvoId) => 1 + Math.max(0, ...anteriores.filter(p => String(p.alvoId) === String(alvoId)).map(p => p.rodada));
  const aprovadoPor = nomeParaGamemode(staff.nome);
  const agora = Date.now();
  try {
    await PontePedidoGm.insertMany(montados.map(({ pedido }, i) => ({
      ...pedido,
      punicaoId: punicao._id,
      denunciaId: punicao.denunciaId,
      guildId: punicao.guildId,
      rodada: rodadaDe(pedido.alvoId),
      aprovadoPor,
      teste: limitesDe(servidor).modoTeste,
      confirmadoPor: [{ id: String(staff.id), nome: String(staff.nome || '').slice(0, 64), em: new Date(agora) }],
      status: 'aprovado',
      // Mesma ordem dos alvos na entrega.
      criadoEm: new Date(agora + i)
    })));
  } catch (error) {
    // Nada foi para a gamemode: a punição volta a esperar envio.
    await PontePedidoGm.updateMany({ punicaoId: punicao._id, status: 'aprovado' }, { $set: { status: 'cancelado' } }).catch(() => {});
    await PontePunicao.updateOne({ _id: punicao._id, status: 'executando' }, { $set: { status: 'aceita', executor: '' }, $inc: { versao: 1 } }).catch(() => {});
    log.error('Falha ao criar os pedidos da gamemode', error);
    return { erro: 'Não foi possível criar os pedidos. Tente de novo.' };
  }

  await auditar('gm_enviar', punicao, staff, { alvos: montados.length, teste: limitesDe(servidor).modoTeste });
  await atualizarMensagemGm(client, punicao._id).catch(() => {});
  return { ok: true, punicao: tomada, pedidos: montados.length, teste: limitesDe(servidor).modoTeste };
}

// Botão "Cancelar": antes do envio, a punição não vai para o jogo; depois, cancela
// o que a gamemode ainda não buscou (o que já foi entregue espera a resposta).
async function cancelarGm({ client = null, punicaoId, guildId, staff }) {
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: String(guildId) }).lean();
  if (!punicao) return { erro: 'Punição não encontrada.' };

  if (punicao.status === 'aceita') {
    const cancelada = await PontePunicao.findOneAndUpdate(
      { _id: punicao._id, status: 'aceita' }, { $set: { status: 'cancelada' }, $inc: { versao: 1 } }, { new: true }
    ).lean();
    if (!cancelada) return { erro: 'A punição mudou. Confira o embed.' };
    require('./aceite').limparAguardando(client, cancelada).catch(() => {});
    await auditar('gm_cancelar', punicao, staff, { etapa: 'antes_do_envio' });
    await atualizarMensagemGm(client, punicao._id).catch(() => {});
    return { ok: true, status: 'cancelada' };
  }

  if (punicao.status !== 'executando' || punicao.executor !== 'gamemode') return { erro: 'Esta punição não pode mais ser cancelada por aqui.' };
  const { modifiedCount } = await PontePedidoGm.updateMany({ punicaoId: punicao._id, status: 'aprovado' }, { $set: { status: 'cancelado' } });
  const emAndamento = await PontePedidoGm.countDocuments({ punicaoId: punicao._id, status: { $in: ['entregue', 'incerto'] } });
  await fecharPunicaoSePronta({ client, punicaoId: punicao._id });
  await auditar('gm_cancelar', punicao, staff, { etapa: 'depois_do_envio', cancelados: modifiedCount, emAndamento });
  await atualizarMensagemGm(client, punicao._id).catch(() => {});
  return { ok: true, cancelados: modifiedCount, emAndamento };
}

// Modal de edição de um alvo: tipo, tempo, avisos e motivo. Passa pela mesma validação do painel do jogo.
async function editarAlvoGm({ client = null, punicaoId, guildId, alvoId, versao, campos, staff }) {
  const { servidor, erro } = await servidorGm(guildId);
  if (erro) return { erro };
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: String(guildId) }).lean();
  if (!punicao || punicao.status !== 'aceita') return { erro: 'Esta punição não está mais esperando envio.' };
  if (punicao.versao !== versao) return { erro: 'A punição mudou enquanto você editava. Abra a edição de novo.' };
  const alvo = (punicao.alvos || []).find(a => String(a._id) === String(alvoId) && !a.removido);
  if (!alvo) return { erro: 'Alvo não encontrado.' };

  const cmd = String(campos.tipo || '').trim().toLowerCase();
  const tempo = Number(String(campos.tempo ?? '').trim());
  const avisos = Number(String(campos.avisos ?? '').trim() || 0);
  const lista = punicao.alvos.map(a => (String(a._id) === String(alvoId)
    ? { ...a, cmd, tempo, avisos, motivo: campos.motivo, regra: `editado por ${String(staff.nome || '').slice(0, 40)}` }
    : a));
  const validado = validarAlvos(lista, servidor.templates);
  if (validado.erro) return { erro: validado.erro };
  const editado = validado.alvos.find(a => String(a._id) === String(alvoId));
  const previa = pedidoDoAlvo(editado, servidor);

  const salva = await PontePunicao.findOneAndUpdate(
    { _id: punicao._id, status: 'aceita', versao }, { $set: { alvos: validado.alvos }, $inc: { versao: 1 } }, { new: true, runValidators: true }
  ).lean();
  if (!salva) return { erro: 'A punição mudou enquanto você editava. Abra a edição de novo.' };
  await PonteUso.create({ guildId: punicao.guildId, acao: 'editar', punicaoId: punicao._id, detalhes: { via: 'discord_gm', por: staff.id, alvoId: String(alvoId) } }).catch(() => {});
  await atualizarMensagemGm(client, punicao._id).catch(() => {});
  return { ok: true, punicao: salva, aviso: previa.erro || '' };
}

module.exports = {
  BOTAO_ENVIAR,
  BOTAO_EDITAR,
  BOTAO_CANCELAR,
  MENU_ALVO,
  MODAL_ALVO,
  EXECUTORES_GM,
  RE_MOTIVO_GM,
  motivoGmValido,
  descreverPunicao,
  pedidoDoAlvo,
  montarMensagemGm,
  postarPunicaoGm,
  atualizarMensagemGm,
  enviarAoJogo,
  cancelarGm,
  editarAlvoGm,
  alvosAtivos
};
