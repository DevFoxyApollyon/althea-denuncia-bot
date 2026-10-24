// Fila de pedidos da gamemode (protocolo gm/v1, doc/PONTE_GAMEMODE.md seções 4 a 6).
// Entrega atômica, resultados idempotentes e fechamento da punição quando todos
// os alvos têm resposta final.
const mongoose = require('mongoose');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PontePunicao = require('../../models/PontePunicao');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const { selarPedido } = require('./protocoloGm');
const { atualizarMensagensDiscord } = require('./aceite');
const { avisarAplicadas } = require('./avisoOrganizacao');

const LEASE_S = 120;
const MAX_DEVOLUCOES = 5;
// Sem volta: o pedido já tem resposta (ou foi encerrado pela staff).
const STATUS_FINAIS = ['aplicada', 'simulada', 'recusada', 'erro', 'cancelado'];

// Tabela da seção 6: status/código da gamemode → status do pedido.
const CODIGOS = {
  aplicada: ['OK', 'DUPLICADO'],
  simulada: ['SIMULADA'],
  recusada: ['CONTA_INEXISTENTE', 'CONTA_PROTEGIDA', 'JA_BANIDO', 'NAO_BANIDO', 'NAO_PRESO', 'RECUSADO', 'DADOS_INVALIDOS', 'EXPIRADO', 'SELO_INVALIDO'],
  devolvida: ['PAUSADO', 'LIMITE_HORA'],
  erro: ['ERRO_GAMEMODE', 'TIMEOUT_GAMEMODE']
};
const DESTINO = { aplicada: 'aplicada', simulada: 'simulada', recusada: 'recusada', devolvida: 'aprovado', erro: 'incerto' };

const segundos = (ms) => Math.floor(ms / 1000);
// eslint-disable-next-line no-control-regex
const texto = (valor, max) => String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Corpo do POST /resultados já parseado → { status, codigo, nome, organizacao, conta } ou { erro }.
function lerResultado(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: 'Corpo inválido.' };
  const status = String(corpo.status || '');
  const codigo = String(corpo.codigo || '');
  if (!CODIGOS[status]?.includes(codigo)) return { erro: 'Status ou código inválido.' };
  const conta = Number(corpo.conta);
  return {
    status,
    codigo,
    nome: texto(corpo.nome, 40),
    organizacao: texto(corpo.organizacao, 60),
    conta: Number.isInteger(conta) && conta > 0 && conta <= 999999999 ? conta : 0
  };
}

// "gamemode: ban 5d +1 aviso", "gamemode: cadeia 120min", "gamemode: ban permanente".
function descreverComando(p) {
  const partes = [p.tipo];
  if (p.tipo === 'ban') partes.push(p.tempo === 0 ? 'permanente' : `${p.tempo}d`);
  if (p.tipo === 'cadeia') partes.push(`${p.tempo}min`);
  if (p.avisos > 0) partes.push(`+${p.avisos} aviso${p.avisos > 1 ? 's' : ''}`);
  return `gamemode: ${partes.join(' ')}`;
}

// Campos que vão para a gamemode, na ordem do protocolo.
const paraProtocolo = (p) => ({
  id: String(p._id),
  tipo: p.tipo,
  conta: p.conta,
  nick: p.nick || '',
  tempo: p.tempo,
  avisos: p.avisos,
  somar: p.tipo === 'ban' && p.somar === true,
  motivo: p.motivo,
  aprovadoPor: p.aprovadoPor,
  emitidoEm: p.emitidoEm,
  teste: p.teste === true
});

// Passa até "limite" pedidos de aprovado para entregue, um de cada vez (duas buscas
// ao mesmo tempo nunca levam o mesmo), e devolve cada um com o selo.
async function entregarPedidos({ conexao, segredo, limite, agora = Date.now() }) {
  const emitidoEm = segundos(agora);
  const entregues = [];
  while (entregues.length < limite) {
    const pedido = await PontePedidoGm.findOneAndUpdate(
      { guildId: conexao.guildId, status: 'aprovado' },
      {
        $set: { status: 'entregue', conexaoId: conexao._id, entregueEm: new Date(agora), leaseAte: new Date(agora + LEASE_S * 1000), emitidoEm },
        $inc: { entregas: 1 }
      },
      { sort: { criadoEm: 1 }, new: true }
    ).lean();
    if (!pedido) break;
    entregues.push(selarPedido(segredo, paraProtocolo(pedido)));
  }
  return entregues;
}

// Entregue sem resposta depois do lease: vira incerto (conferência humana, nunca volta sozinho).
async function marcarIncertos(agora = Date.now()) {
  const marcados = [];
  for (;;) {
    const pedido = await PontePedidoGm.findOneAndUpdate(
      { status: 'entregue', leaseAte: { $lt: new Date(agora) } },
      { $set: { status: 'incerto' } },
      { new: true }
    ).lean();
    if (!pedido) break;
    marcados.push(pedido);
  }
  return marcados;
}

// Grava o item no formato do PC: histórico, relatório e Log Admin funcionam sem mudança.
async function registrarAplicada(pedido, conexao, dados, agora) {
  const item = {
    alvoId: pedido.alvoId,
    comando: descreverComando(pedido),
    ok: true,
    nome: dados.nome,
    organizacao: dados.organizacao,
    contaId: String(dados.conta || pedido.conta || ''),
    pc: `gamemode:${conexao.nome}`,
    em: new Date(agora)
  };
  await PontePunicao.updateOne({ _id: pedido.punicaoId }, { $push: { resultado: item } });
  // Alvo que veio só com o nick ganha o ID que a gamemode achou.
  if (item.contaId && item.contaId !== '0') {
    await PontePunicao.updateOne(
      { _id: pedido.punicaoId, alvos: { $elemMatch: { _id: pedido.alvoId, contaId: '' } } },
      { $set: { 'alvos.$.contaId': item.contaId } }
    );
  }
  return item;
}

// Quando o último pedido de cada alvo tem resposta final, a punição sai de "executando":
// aplicada se ao menos um foi aplicado; senão volta para "aceita" (a staff decide de novo).
async function fecharPunicaoSePronta({ client, punicaoId, conexao, agora = Date.now() }) {
  const pedidos = await PontePedidoGm.find({ punicaoId }).sort({ rodada: -1 }).lean();
  const ultimos = new Map();
  for (const p of pedidos) if (!ultimos.has(String(p.alvoId))) ultimos.set(String(p.alvoId), p);
  const lista = [...ultimos.values()];
  if (lista.length === 0 || !lista.every(p => STATUS_FINAIS.includes(p.status))) return null;

  const algumAplicado = lista.some(p => p.status === 'aplicada');
  // Fechada por um cancelamento no Discord: o nome vem da conexão que aplicou.
  if (!conexao) {
    const aplicou = lista.find(p => p.status === 'aplicada' && p.conexaoId);
    conexao = (aplicou && await PonteConexaoGm.findById(aplicou.conexaoId, { nome: 1 }).lean()) || { nome: 'gamemode' };
  }
  const nomePc = `gamemode:${conexao.nome}`;
  const $set = algumAplicado
    ? { status: 'aplicada', aplicadaEm: new Date(agora), aplicadaPor: { instalacaoId: null, nomePc }, executandoPor: null, executandoDesde: null }
    : { status: 'aceita', executor: '', executandoPor: null, executandoDesde: null };
  const punicao = await PontePunicao.findOneAndUpdate(
    { _id: punicaoId, status: 'executando' }, { $set, $inc: { versao: 1 } }, { new: true }
  ).lean();
  if (!punicao) return null;

  if (punicao.status === 'aplicada') {
    atualizarMensagensDiscord(client, punicao, `➱ Aplicado (gamemode: ${conexao.nome})`).catch(() => {});
    const aplicados = new Set(lista.filter(p => p.status === 'aplicada').map(p => String(p.alvoId)));
    const itens = (punicao.resultado || []).filter(r => r.ok && aplicados.has(String(r.alvoId)) && String(r.pc || '').startsWith('gamemode:'));
    avisarAplicadas(client, punicao, itens, nomePc).catch(() => {});
  }
  return punicao;
}

// Aplica um resultado vindo da gamemode. Devolve { http, pedido, novo, alerta }:
//  - 200 gravado (ou repetição idêntica); 404 não é desta conexão; 409 já tem outro resultado.
//  - alerta: 'selo' (SELO_INVALIDO) ou 'devolucoes' (passou de 5), para quem chamou avisar.
async function registrarResultado({ client = null, conexao, pedidoId, dados, agora = Date.now() }) {
  if (!mongoose.isValidObjectId(pedidoId) || !/^[0-9a-f]{24}$/.test(pedidoId)) return { http: 404 };
  const filtro = { _id: pedidoId, guildId: conexao.guildId, conexaoId: conexao._id };
  const atual = await PontePedidoGm.findOne(filtro).lean();
  if (!atual) return { http: 404 };

  const devolvida = dados.status === 'devolvida';
  const destino = devolvida && atual.devolucoes + 1 > MAX_DEVOLUCOES ? 'erro' : DESTINO[dados.status];
  const mesmo = (p) => p.codigo === dados.codigo && (devolvida ? p.status === 'aprovado' || p.status === 'erro' : p.status === DESTINO[dados.status]);

  if (!['entregue', 'incerto'].includes(atual.status)) {
    return mesmo(atual) ? { http: 200, pedido: atual, novo: false } : { http: 409, pedido: atual };
  }

  const $set = {
    status: destino,
    codigo: dados.codigo,
    resultado: { nome: dados.nome, organizacao: dados.organizacao, conta: dados.conta },
    leaseAte: null
  };
  const pedido = await PontePedidoGm.findOneAndUpdate(
    { ...filtro, status: { $in: ['entregue', 'incerto'] } },
    { $set, ...(devolvida ? { $inc: { devolucoes: 1 } } : {}) },
    { new: true }
  ).lean();
  // Outra resposta chegou no meio: decide pela que ficou gravada.
  if (!pedido) {
    const gravado = await PontePedidoGm.findOne(filtro).lean();
    return gravado && mesmo(gravado) ? { http: 200, pedido: gravado, novo: false } : { http: 409, pedido: gravado };
  }

  if (pedido.status === 'aplicada') await registrarAplicada(pedido, conexao, dados, agora);
  if (STATUS_FINAIS.includes(pedido.status)) await fecharPunicaoSePronta({ client, punicaoId: pedido.punicaoId, conexao, agora });

  const alerta = dados.codigo === 'SELO_INVALIDO' ? 'selo' : (devolvida && pedido.status === 'erro' ? 'devolucoes' : null);
  return { http: 200, pedido, novo: true, alerta };
}

module.exports = {
  LEASE_S,
  MAX_DEVOLUCOES,
  STATUS_FINAIS,
  CODIGOS,
  lerResultado,
  descreverComando,
  paraProtocolo,
  entregarPedidos,
  marcarIncertos,
  registrarAplicada,
  fecharPunicaoSePronta,
  registrarResultado
};
