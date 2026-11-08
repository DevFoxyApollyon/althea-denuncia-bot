// Punição para o jogo no modo gamemode: o embed "🎮 Punição para o jogo" no Relatório
// de punições e o que os botões dele fazem (enviar, editar, cancelar).
// Nada é enviado à gamemode sem um responsável clicar em "Enviar ao jogo".
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PontePunicao = require('../../models/PontePunicao');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PonteServidor = require('../../models/PonteServidor');
const PonteUso = require('../../models/PonteUso');
const Usuario = require('../../models/Usuario');
const { motivoComSufixo, validarAlvos, RE_NICK } = require('./validacao');
const { motivoParaGamemode, nomeParaGamemode } = require('./protocoloGm');
const { fecharPunicaoSePronta, explicarCodigo } = require('./pedidosGm');
const { LIMITES_GM_PADRAO } = require('./constantes');
const { getConfig } = require('../../utils/configCache');
const { botaoSoltoEntrarNoTopico } = require('../../utils/restricaoTopicos');
const { temOrganizacao, nomeDaOrganizacao, cargoLegivel } = require('./avisoOrganizacao');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });

const BOTAO_ENVIAR = 'ponte_gm_enviar:';
const BOTAO_EDITAR = 'ponte_gm_editar:';
const BOTAO_CANCELAR = 'ponte_gm_cancelar:';
const MENU_ALVO = 'ponte_gm_alvo:';
const MODAL_ALVO = 'ponte_gm_modal:';
// Embed travado com pedido incerto (a gamemode não respondeu): o responsável
// confirma que foi aplicada ou manda de novo (ver incertosGm.resolverIncertosDaPunicao).
const BOTAO_GM_APLICADA = 'ponte_gm_aplicada:';
const BOTAO_GM_REAPLICAR = 'ponte_gm_reaplicar:';

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
// nickDaConta: nome no jogo já conhecido da conta; vai junto só para a tabela da gamemode ter o
// nick (quem decide quem é punido continua sendo a conta).
function pedidoDoAlvo(alvo, servidor, nickDaConta = '') {
  const limites = limitesDe(servidor);
  const quem = alvo.contaId || alvo.nick || '?';
  if (!alvo.regra) return { erro: `${quem}: motivo fora da tabela. Edite o alvo antes de enviar.` };
  const tipo = alvo.cmd;
  const tempo = Number(alvo.tempo) || 0;
  // Ban permanente não leva aviso (punições antigas podem ter avisos somados de outros motivos).
  // Acima do máximo da gamemode, vai o máximo e o resto é ignorado.
  const avisos = tipo === 'ban' && tempo === 0 ? 0 : Math.min(Number(alvo.avisos) || 0, limites.maxAvisos);
  const conta = Number(alvo.contaId) || 0;
  const nick = conta ? [alvo.nick, nickDaConta].map(n => String(n || '')).find(n => RE_NICK.test(n)) || '' : String(alvo.nick || '');
  if (!conta && !RE_NICK.test(nick)) return { erro: `${quem}: sem ID de conta nem nick válido.` };
  if (tipo === 'ban') {
    if (tempo === 0 && !limites.permitirPermanente) return { erro: `${quem}: ban permanente não é liberado pelo bot neste servidor.` };
    if (tempo > limites.maxBanDias) return { erro: `${quem}: ban de ${tempo} dias passa do máximo (${limites.maxBanDias}).` };
  } else if (tipo === 'cadeia') {
    if (tempo < 1 || tempo > limites.maxCadeiaMin) return { erro: `${quem}: cadeia precisa ser de 1 a ${limites.maxCadeiaMin} minutos.` };
  } else {
    return { erro: `${quem}: tipo "${tipo}" não vai para a gamemode.` };
  }
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

const maiuscula = (texto) => (texto ? texto[0].toUpperCase() + texto.slice(1) : texto);

// Um bloco (campo do embed) por alvo: quem é, a punição, o motivo, o que o servidor do jogo
// informou (nome, organização, cargo) e o estado. Esperando envio, mostra como vai sair.
function blocoDoAlvo(alvo, indice, pedido, servidor, esperandoEnvio, nicks, jaBanido = false) {
  const previa = pedidoDoAlvo(alvo, servidor);
  const dados = esperandoEnvio ? previa.pedido : pedido || previa.pedido;
  const resultado = pedido?.resultado || {};
  const conta = alvo.contaId || (resultado.conta ? String(resultado.conta) : '');
  const nick = resultado.nome || pedido?.nick || alvo.nick || nicks?.get(Number(alvo.contaId)) || '';
  const titulo = `${indice + 1}. ${nick || 'Jogador'}${conta ? ` · conta ${conta}` : ''}`;

  const linhas = [
    `⚖️ ${dados ? maiuscula(descreverPunicao(dados)) : `${alvo.cmd} ${alvo.tempo}`}`,
    `📝 ${dados?.motivo || alvo.motivo || 'sem motivo'}`
  ];
  if (temOrganizacao(resultado.organizacao)) {
    linhas.push(`🏢 ${nomeDaOrganizacao(resultado.organizacao)} · 🎖️ ${cargoLegivel(resultado.organizacao)}`);
  } else if (resultado.nome) {
    linhas.push('🏢 Sem organização');
  }
  if (esperandoEnvio && previa.erro) linhas.push(`⚠️ ${previa.erro.replace(/^[^:]+: /, '')}`);
  // Ban permanente que a gamemode recusou por já estar banida: só informa, sem a tentativa.
  if (jaBanido) linhas.push('🔨 Já está sendo banida');
  else if (pedido) linhas.push(`${esperandoEnvio ? 'Última tentativa: ' : ''}${estadoDoPedido(pedido)}`);
  else if (esperandoEnvio && !previa.erro) linhas.push('⏳ Ainda não enviado');
  return { name: titulo.slice(0, 256), value: linhas.join('\n').slice(0, 1024) };
}

// Embed e botões conforme o estado da punição. Puro: só lê o que recebe.
// nicks: nome no jogo já conhecido de cada conta (para mostrar antes do envio).
function montarMensagemGm(punicao, pedidos, servidor, nicks = new Map()) {
  const ultimos = ultimosPorAlvo(pedidos || []);
  const alvos = alvosAtivos(punicao);
  const pedidosDaVez = alvos.map(a => ultimos.get(String(a._id))).filter(Boolean);
  const enviadoPor = pedidosDaVez.find(p => p.confirmadoPor?.length)?.confirmadoPor[0]?.nome || pedidosDaVez[0]?.aprovadoPor || '';
  const teste = pedidosDaVez.length ? pedidosDaVez.some(p => p.teste) : limitesDe(servidor).modoTeste;

  const peloPc = Boolean(servidor?.executor) && !EXECUTORES_GM.includes(servidor.executor);
  // Ban permanente recusado com JA_BANIDO em todos os jogadores: a conta já está banida,
  // não há o que reenviar (some Enviar, Editar e Cancelar).
  const jaBanidoPermanente = punicao.status === 'aceita' && alvos.length > 0 && alvos.every(a => {
    const ultimo = ultimos.get(String(a._id));
    return a.cmd === 'ban' && (Number(a.tempo) || 0) === 0 && ultimo?.status === 'recusada' && ultimo.codigo === 'JA_BANIDO';
  });
  const situacao = jaBanidoPermanente ? '🔨 A conta já está sendo banida no jogo.'
    : punicao.status === 'aceita' && peloPc
    ? '🖥️ Este servidor aplica pelo PC da staff: esta punição está na fila do PC.'
    : {
    aceita: pedidosDaVez.length
      ? '🔁 Nenhum alvo foi aplicado na última tentativa. Confira e envie de novo, se for o caso.'
      : '⏳ Aguardando um responsável enviar ao jogo.',
    executando: `📤 Enviado por **${enviadoPor || 'responsável'}**, aguardando a gamemode.`,
    aplicada: '✅ Aplicada pela gamemode.',
    cancelada: '❌ Cancelada: não vai para o jogo.'
  }[punicao.status] || punicao.status;

  const esperandoEnvio = punicao.status === 'aceita';
  const blocos = alvos.map((a, i) => blocoDoAlvo(a, i, ultimos.get(String(a._id)), servidor, esperandoEnvio, nicks, jaBanidoPermanente));
  // Por que não foi aplicada: um texto por código de recusa ou erro da última tentativa.
  const codigosRuins = [...new Set(pedidosDaVez.filter(p => ['recusada', 'incerto', 'erro'].includes(p.status) && p.codigo).map(p => p.codigo))];
  const falhou = esperandoEnvio && codigosRuins.length > 0 && !jaBanidoPermanente;

  const topo = [
    [punicao.msgDiscord?.acusado && `👤 **Acusado:** ${String(punicao.msgDiscord.acusado).slice(0, 200)}`,
      punicao.aceitoPor?.nome && `✅ **Aceita por:** ${punicao.aceitoPor.nome}`].filter(Boolean).join('  ·  '),
    '',
    situacao,
    teste && punicao.status !== 'cancelada' && '🧪 Modo teste ligado: a gamemode só simula, nada é aplicado.',
    punicao.msgDiscord?.link && `🔗 [Abrir denúncia](${punicao.msgDiscord.link})`
  ].filter(linha => linha !== false && linha !== null && linha !== undefined);

  const titulo = jaBanidoPermanente ? '🔨 Ban permanente já setado'
    : punicao.status === 'aceita' && peloPc ? '🖥️ Punição na fila do PC da staff'
    : falhou ? '🔁 Punição não aplicada'
      : { aceita: '🎮 Punição esperando envio ao jogo', executando: '📤 Punição enviada ao jogo', aplicada: '✅ Punição aplicada no jogo', cancelada: '🚫 Punição cancelada' }[punicao.status]
        || '🎮 Punição para o jogo';
  const embed = new EmbedBuilder()
    .setColor(jaBanidoPermanente ? '#C0392B' : falhou ? '#E67E22' : { aceita: '#F1C40F', executando: '#3498DB', aplicada: '#2ECC71', cancelada: '#7F8C8D' }[punicao.status] || '#2B2D31')
    .setTitle(titulo)
    .setDescription(topo.join('\n').replace(/^\n+/, '').slice(0, 4000))
    // Até 20 alvos em campos (o Discord aceita 25); o resto fica numa linha só.
    .addFields(blocos.slice(0, 20).map(b => ({ ...b, inline: blocos.length > 1 })))
    .setFooter({ text: `Punição ${punicao._id}${enviadoPor && punicao.status !== 'aceita' ? ` · enviada por ${enviadoPor}` : ''}` })
    .setTimestamp();
  if (blocos.length > 20) embed.addFields({ name: `e mais ${blocos.length - 20} jogador(es)`, value: 'Veja todos pelo Editar.' });
  if (codigosRuins.length && !jaBanidoPermanente) {
    embed.addFields({ name: 'ℹ️ Por que não foi aplicada', value: codigosRuins.map(c => `**${c}**: ${explicarCodigo(c)}`).join('\n').slice(0, 1024) });
  }

  const id = String(punicao._id);
  const botoes = [];
  if (punicao.status === 'aceita' && !peloPc && !jaBanidoPermanente) {
    botoes.push(
      new ButtonBuilder().setCustomId(BOTAO_ENVIAR + id).setLabel('Enviar ao jogo').setEmoji('🎮').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BOTAO_EDITAR + id).setLabel('Editar').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BOTAO_CANCELAR + id).setLabel('Cancelar').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
  } else if (punicao.status === 'executando' && punicao.executor === 'gamemode') {
    // A gamemode não respondeu: o responsável confere no jogo e decide aqui mesmo.
    if (pedidosDaVez.some(p => p.status === 'incerto')) {
      botoes.push(
        new ButtonBuilder().setCustomId(BOTAO_GM_APLICADA + id).setLabel('Foi aplicada').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(BOTAO_GM_REAPLICAR + id).setLabel(peloPc ? 'Tentar novamente (PC)' : 'Tentar novamente').setEmoji('🔁').setStyle(ButtonStyle.Primary)
      );
    }
    botoes.push(new ButtonBuilder().setCustomId(BOTAO_CANCELAR + id).setLabel('Cancelar envio').setEmoji('✖️').setStyle(ButtonStyle.Danger));
  }
  if (punicao.mensagens?.topicoPrivado && punicao.mensagens.topicoId) botoes.push(botaoSoltoEntrarNoTopico(punicao.mensagens.topicoId));
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
  const nicks = await nicksConhecidos(punicao.guildId, alvosAtivos(punicao).map(a => a.contaId)).catch(() => new Map());
  const msg = await canal.send({ ...montarMensagemGm(punicao, [], servidor, nicks), allowedMentions: { parse: [] } });
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
  const nicks = await nicksConhecidos(punicao.guildId, alvosAtivos(punicao).map(a => a.contaId)).catch(() => new Map());
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const msg = canal?.messages ? await canal.messages.fetch(msgId).catch(() => null) : null;
  // Aplicada: o aviso "Punição aplicada" (avisoOrganizacao) já está no canal com
  // todos os dados; este embed sai para não repetir.
  if (punicao.status === 'aplicada') {
    if (msg) await msg.delete().catch(e => log.warn('Falha ao apagar o embed da gamemode', e?.message));
    await PontePunicao.updateOne({ _id: punicao._id }, { $unset: { mensagemGm: 1 } }).catch(() => {});
    return;
  }
  await msg?.edit(montarMensagemGm(punicao, pedidos, servidor, nicks)).catch(e => log.warn('Falha ao editar o embed da gamemode', e?.message));
}

const auditar = (acao, punicao, staff, detalhes = null) => PonteUso.create({
  guildId: punicao.guildId, acao, punicaoId: punicao._id, detalhes: { por: staff?.id || '', nome: staff?.nome || '', ...(detalhes || {}) }
}).catch(() => {});

async function servidorGm(guildId) {
  const servidor = await PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor.' };
  if (!EXECUTORES_GM.includes(servidor.executor)) return { erro: 'Este servidor agora aplica pelo PC da staff: a punição já está na fila do PC.' };
  return { servidor };
}

// Trocou quem aplica: as punições que ainda não saíram seguem o executor novo.
//  - Para o PC: as enviadas à gamemode que ela ainda não buscou voltam para a fila (o PC pega
//    da fila); as que ela já buscou ficam com ela, porque podem estar sendo aplicadas.
//  - Para a gamemode (ou os dois): cada punição esperando envio ganha o embed com "Enviar ao jogo".
// Em todos os casos os embeds são refeitos (os botões somem ou voltam).
async function aoTrocarExecutor({ client = null, guildId, para }) {
  guildId = String(guildId);
  let devolvidas = 0;
  if (!EXECUTORES_GM.includes(para)) {
    const enviadas = await PontePunicao.find({ guildId, status: 'executando', executor: 'gamemode' }, { _id: 1 }).lean();
    for (const { _id } of enviadas) {
      if (await PontePedidoGm.exists({ punicaoId: _id, status: { $in: ['entregue', 'incerto'] } })) continue;
      await PontePedidoGm.updateMany({ punicaoId: _id, status: 'aprovado' }, { $set: { status: 'cancelado' } });
      const r = await PontePunicao.updateOne({ _id, status: 'executando', executor: 'gamemode' }, { $set: { status: 'aceita', executor: '' }, $inc: { versao: 1 } });
      devolvidas += r.modifiedCount;
    }
  }

  let embedsNovos = 0;
  const servidor = await PonteServidor.findOne({ guildId, ativo: true }).lean();
  const pendentes = await PontePunicao.find({ guildId, status: { $in: ['aceita', 'executando'] } }).sort({ criadoEm: 1 }).limit(100).lean();
  for (const punicao of pendentes) {
    if (punicao.mensagemGm?.msgId) await atualizarMensagemGm(client, punicao._id).catch(() => {});
    else if (punicao.status === 'aceita' && EXECUTORES_GM.includes(para) && client) {
      if (await postarPunicaoGm(client, punicao, servidor).catch(() => null)) embedsNovos++;
    }
  }
  return { devolvidas, embedsNovos };
}

// Nome no jogo de cada conta: o último que a gamemode confirmou ao aplicar ou, sem isso, o do
// nick do Discord de quem tem a conta ("nome_no_jogo 1234"). Só nomes que a gamemode aceita.
async function nicksConhecidos(guildId, contas) {
  const lista = [...new Set(contas.map(Number).filter(c => c > 0))];
  const mapa = new Map();
  if (!lista.length) return mapa;
  const confirmados = await PontePedidoGm.find({ guildId: String(guildId), conta: { $in: lista }, 'resultado.nome': { $nin: ['', null] } }, { conta: 1, 'resultado.nome': 1 })
    .sort({ criadoEm: -1 }).limit(200).lean().catch(() => []);
  for (const p of confirmados) if (!mapa.has(p.conta) && RE_NICK.test(p.resultado.nome)) mapa.set(p.conta, p.resultado.nome);
  const faltam = lista.filter(c => !mapa.has(c));
  if (faltam.length) {
    const usuarios = await Usuario.find({ guildId: String(guildId), conta: { $in: faltam.map(String) } }, { conta: 1, nickname: 1 })
      .sort({ updatedAt: -1 }).lean().catch(() => []);
    for (const u of usuarios) {
      const nome = String(u.nickname || '').replace(/\s+\d+\s*$/, '').trim();
      if (!mapa.has(Number(u.conta)) && RE_NICK.test(nome)) mapa.set(Number(u.conta), nome);
    }
  }
  return mapa;
}

// Botão "Enviar ao jogo": cria um pedido por alvo e tira a punição da fila do PC.
async function enviarAoJogo({ client = null, punicaoId, guildId, staff }) {
  const { servidor, erro } = await servidorGm(guildId);
  if (erro) {
    await atualizarMensagemGm(client, punicaoId).catch(() => {});
    return { erro };
  }
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: String(guildId) }).lean();
  if (!punicao) return { erro: 'Punição não encontrada.' };
  if (punicao.status !== 'aceita') return { erro: 'Esta punição não está mais esperando envio.' };
  const alvos = alvosAtivos(punicao);
  if (alvos.length === 0) return { erro: 'A punição não tem alvos.' };

  const nicks = await nicksConhecidos(punicao.guildId, alvos.map(a => a.contaId));
  const montados = alvos.map(a => pedidoDoAlvo(a, servidor, nicks.get(Number(a.contaId))));
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
  // "novo": punição sem jogador (ID do aceite fora do formato); o modal traz a conta.
  const novo = alvoId === 'novo';
  const alvo = novo ? null : (punicao.alvos || []).find(a => String(a._id) === String(alvoId) && !a.removido);
  if (!novo && !alvo) return { erro: 'Alvo não encontrado.' };

  const cmd = String(campos.tipo || '').trim().toLowerCase();
  const tempo = Number(String(campos.tempo ?? '').trim());
  const avisos = Number(String(campos.avisos ?? '').trim() || 0);
  const regra = `editado por ${String(staff.nome || '').slice(0, 40)}`;
  // Vários IDs com "+": um jogador por conta; o motivo é separado por conta quando cita cada uma
  // ("1270101 CL + 360429 saav"), como no aceite.
  const contas = [...new Set(String(campos.conta || '').split('+').map(c => c.trim()).filter(Boolean))];
  const porConta = novo ? require('./aceite').motivosPorAcusado(campos.motivo, contas) : new Map();
  const lista = novo
    ? [...(punicao.alvos || []), ...contas.map(c => ({ contaId: c, nick: '', cmd, tempo, avisos, motivo: porConta.get(c.toLowerCase()) || campos.motivo, regra }))]
    : punicao.alvos.map(a => (String(a._id) === String(alvoId) ? { ...a, cmd, tempo, avisos, motivo: campos.motivo, regra } : a));
  if (novo && !contas.length) return { erro: 'Informe o ID da conta do jogador.' };
  const validado = validarAlvos(lista, servidor.templates);
  if (validado.erro) return { erro: validado.erro };
  const editado = novo ? validado.alvos[validado.alvos.length - 1] : validado.alvos.find(a => String(a._id) === String(alvoId));
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
  BOTAO_GM_APLICADA,
  BOTAO_GM_REAPLICAR,
  MENU_ALVO,
  MODAL_ALVO,
  EXECUTORES_GM,
  RE_MOTIVO_GM,
  motivoGmValido,
  descreverPunicao,
  pedidoDoAlvo,
  nicksConhecidos,
  aoTrocarExecutor,
  montarMensagemGm,
  postarPunicaoGm,
  atualizarMensagemGm,
  canalDoRelatorio,
  enviarAoJogo,
  cancelarGm,
  editarAlvoGm,
  alvosAtivos
};
