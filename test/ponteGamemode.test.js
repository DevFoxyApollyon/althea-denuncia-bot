require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { iniciarMongoMemoria } = require('./helpers/mongoMemoria');

process.env.PONTE_SAMP_ATIVA = '1';
process.env.PONTE_CHAVE_MESTRA = crypto.randomBytes(32).toString('base64');

const vetores = require('../gamemode/teste/vetores_protocolo.json');
const protocolo = require('../services/ponteSamp/protocoloGm');
const cifra = require('../services/ponteSamp/cifra');
const { PRAZOS_EM_DIAS, CAMPO_RETENCAO, COLECOES_PERMANENTES } = require('../utils/retencaoDados');

let mongo;
let http;
let base;
let m; // models e serviços, carregados depois do Mongo subir
// Relógio da API: null usa o relógio de verdade.
let relogioMs = null;
const agora = () => relogioMs ?? Date.now();

test.before(async () => {
  mongo = await iniciarMongoMemoria();
  m = {
    PonteServidor: require('../models/PonteServidor'),
    PonteConexaoGm: require('../models/PonteConexaoGm'),
    PontePedidoGm: require('../models/PontePedidoGm'),
    PontePunicao: require('../models/PontePunicao'),
    PonteUso: require('../models/PonteUso'),
    pedidosGm: require('../services/ponteSamp/pedidosGm'),
    criarApiGamemode: require('../site/ponte/apiGamemode').criarApiGamemode
  };
  await Promise.all(['PontePedidoGm', 'PontePunicao', 'PonteServidor'].map(nome => m[nome].init()));

  const app = express();
  app.use('/ponte/gm/v1', m.criarApiGamemode({ agora, limites: { buscas: 10000, resultados: 10000, falhas: 10000 } }));
  http = app.listen(0);
  base = `http://127.0.0.1:${http.address().port}`;
});

test.after(async () => {
  http?.close();
  await mongo?.parar();
});

// ---------- ajudantes ----------

async function guildGm(guildId, { executor = 'gamemode', segredo = cifra.gerarSegredo(), ips = [] } = {}) {
  await m.PonteServidor.updateOne({ guildId }, { $set: { ativo: true, executor } }, { upsert: true });
  const conexao = await m.PonteConexaoGm.create({
    guildId, nome: `GM ${guildId}`, segredoCifrado: cifra.cifrar(segredo), ultimos4: segredo.slice(-4), ipsPermitidos: ips
  });
  return { conexao, segredo };
}

// Punição em execução pela gamemode, com um pedido aprovado por alvo.
async function punicaoComPedidos(guildId, qtd = 1, extra = {}) {
  const alvos = Array.from({ length: qtd }, (_, i) => ({ contaId: String(1000 + i), cmd: 'ban', tempo: 5, avisos: 1, motivo: 'DM', regra: 'x' }));
  const punicao = await m.PontePunicao.create({
    denunciaId: new mongoose.Types.ObjectId(), guildId, origem: 'canal_staff', status: 'executando', alvos
  });
  const pedidos = await m.PontePedidoGm.insertMany(punicao.alvos.map((a, i) => ({
    punicaoId: punicao._id, alvoId: a._id, guildId, tipo: 'ban', conta: Number(a.contaId), tempo: 5, avisos: 1,
    somar: true, motivo: 'DM [DC]', aprovadoPor: 'joao.staff', teste: false, criadoEm: new Date(Date.now() + i), ...extra
  })));
  return { punicao, pedidos };
}

// Requisição assinada como o include faz. "mexer" altera um pedaço depois de assinar.
async function chamar(conexao, segredo, caminho, { metodo = 'GET', corpo = '', query = '', ts, nonce, mexer = {} } = {}) {
  const caminhoCompleto = `/ponte/gm/v1${caminho}`;
  const dados = {
    metodo, caminho: caminhoCompleto, ts: ts ?? Math.floor(agora() / 1000),
    nonce: nonce ?? crypto.randomBytes(16).toString('hex'), corpo
  };
  const sig = protocolo.assinarRequisicao(segredo, dados);
  const params = new URLSearchParams({ id: String(conexao._id), ts: String(dados.ts), nonce: dados.nonce, sig, ...mexer.query });
  for (const [k, v] of Object.entries(mexer.query || {})) if (v === undefined) params.delete(k);
  const resposta = await fetch(`${base}${caminhoCompleto}?${query ? `${query}&` : ''}${params}`, {
    method: metodo, body: metodo === 'GET' ? undefined : (mexer.corpo ?? corpo)
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

const resultado = (status, codigo, extra = {}) => JSON.stringify({ status, codigo, nome: 'Fulano_Tal', organizacao: '', conta: 0, ...extra });

// ---------- 1. Vetores do protocolo (conferidos dentro do Pawn) ----------

test('vetores de requisição: canônico e assinatura batem com o protocoloGm', () => {
  assert.equal(vetores.protocolo, 'gm/v1');
  for (const v of vetores.requisicoes) {
    const dados = { metodo: v.metodo, caminho: v.caminho, ts: v.ts, nonce: v.nonce, corpo: v.corpo };
    assert.equal(protocolo.canonicoRequisicao(dados), v.canonico);
    assert.equal(protocolo.assinarRequisicao(vetores.segredo, dados), v.assinatura);
    // O corpo chega como Buffer na rota: o resultado precisa ser o mesmo.
    assert.equal(protocolo.assinaturaConfere(vetores.segredo, { ...dados, corpo: Buffer.from(v.corpo, 'utf8') }, v.assinatura), true);
    assert.equal(protocolo.assinaturaConfere(vetores.segredo, { ...dados, corpo: v.corpo + ' ' }, v.assinatura), false);
  }
});

test('vetores de pedido: canônico e selo batem com o protocoloGm', () => {
  for (const v of vetores.pedidos) {
    assert.equal(protocolo.canonicoPedido(v.pedido), v.canonico);
    assert.equal(protocolo.selarPedido(vetores.segredo, v.pedido).selo, v.selo);
  }
});

test('assinatura com formato inválido é recusada sem lançar erro', () => {
  const dados = { metodo: 'GET', caminho: '/ponte/gm/v1/pedidos', ts: 1, nonce: '0'.repeat(32), corpo: '' };
  for (const sig of [undefined, '', 'xyz', 'A'.repeat(64), '0'.repeat(63)]) {
    assert.equal(protocolo.assinaturaConfere(vetores.segredo, dados, sig), false);
  }
});

// --- Cifra do segredo ---

test('cifra: ida e volta devolve o segredo original, com IV diferente a cada vez', () => {
  const segredo = cifra.gerarSegredo();
  assert.match(segredo, /^[0-9a-f]{64}$/);
  const a = cifra.cifrar(segredo);
  const b = cifra.cifrar(segredo);
  assert.notEqual(a.iv, b.iv);
  assert.equal(Buffer.from(a.iv, 'base64').length, 12);
  assert.equal(cifra.decifrar(a), segredo);
  assert.equal(cifra.decifrar(b), segredo);
});

test('cifra: dados, tag ou IV adulterados fazem o decifrar falhar', () => {
  const obj = cifra.cifrar(cifra.gerarSegredo());
  const virar = (b64) => {
    const buf = Buffer.from(b64, 'base64');
    buf[0] ^= 1;
    return buf.toString('base64');
  };
  assert.throws(() => cifra.decifrar({ ...obj, dados: virar(obj.dados) }));
  assert.throws(() => cifra.decifrar({ ...obj, tag: virar(obj.tag) }));
  assert.throws(() => cifra.decifrar({ ...obj, iv: virar(obj.iv) }));
});

test('cifra: outra chave mestra não decifra', () => {
  const obj = cifra.cifrar('abc');
  const original = process.env.PONTE_CHAVE_MESTRA;
  try {
    process.env.PONTE_CHAVE_MESTRA = crypto.randomBytes(32).toString('base64');
    assert.throws(() => cifra.decifrar(obj));
  } finally {
    process.env.PONTE_CHAVE_MESTRA = original;
  }
});

test('cifra: sem chave mestra (ou com tamanho errado) não cifra', () => {
  const original = process.env.PONTE_CHAVE_MESTRA;
  try {
    for (const valor of ['', crypto.randomBytes(16).toString('base64')]) {
      process.env.PONTE_CHAVE_MESTRA = valor;
      assert.equal(cifra.chaveMestraConfigurada(), false);
      assert.throws(() => cifra.cifrar('abc'), /PONTE_CHAVE_MESTRA/);
    }
  } finally {
    process.env.PONTE_CHAVE_MESTRA = original;
  }
  assert.equal(cifra.chaveMestraConfigurada(), true);
});

// --- Models ---

test('models da gamemode registram com a retenção certa', () => {
  const PonteConexaoGm = require('../models/PonteConexaoGm');
  const PontePedidoGm = require('../models/PontePedidoGm');
  assert.equal(PonteConexaoGm.collection.name, 'ponteconexoesgm');
  assert.equal(PontePedidoGm.collection.name, 'pontepedidosgm');
  assert.ok(COLECOES_PERMANENTES.includes('ponteconexoesgm'));
  assert.equal(PonteConexaoGm.schema.path(CAMPO_RETENCAO), undefined);
  assert.ok(PontePedidoGm.schema.path(CAMPO_RETENCAO));
  assert.equal(PRAZOS_EM_DIAS.pontepedidosgm, 90);
  // Como o resto da ponte, as duas ficam no banco secundário.
  const { secondaryConnection } = require('../utils/persistencia');
  assert.equal(PonteConexaoGm.db, secondaryConnection);
  assert.equal(PontePedidoGm.db, secondaryConnection);
});

test('pedido da gamemode: índice único por punição, alvo e rodada', () => {
  const PontePedidoGm = require('../models/PontePedidoGm');
  const indices = PontePedidoGm.schema.indexes();
  const unico = indices.find(([campos]) => campos.punicaoId === 1 && campos.alvoId === 1 && campos.rodada === 1);
  assert.ok(unico);
  assert.equal(unico[1].unique, true);
  assert.ok(indices.some(([campos]) => campos.guildId === 1 && campos.status === 1 && campos.criadoEm === 1));
  assert.ok(indices.some(([campos]) => campos.status === 1 && campos.leaseAte === 1));
});

test('pedido da gamemode valida tipo e status, e nasce em modo teste', () => {
  const PontePedidoGm = require('../models/PontePedidoGm');
  const erro = new PontePedidoGm({ tipo: 'kick', status: 'outro' }).validateSync();
  for (const campo of ['punicaoId', 'alvoId', 'guildId', 'tipo', 'status', 'motivo', 'aprovadoPor']) {
    assert.ok(erro.errors[campo], campo);
  }
  const doc = new PontePedidoGm({});
  assert.equal(doc.status, 'aprovado');
  assert.equal(doc.rodada, 1);
  assert.equal(doc.teste, true);
});

test('guild nova usa o PC como executor e os limites padrão da gamemode', () => {
  const PonteServidor = require('../models/PonteServidor');
  const doc = new PonteServidor({ guildId: '1' });
  assert.equal(doc.executor, 'pc');
  assert.deepEqual(doc.toObject().gm, {
    pausado: false, maxBanDias: 30, permitirPermanente: true, maxCadeiaMin: 300,
    maxAvisos: 3, modoTeste: true
  });
  assert.ok(new PonteServidor({ guildId: '1', executor: 'outro' }).validateSync().errors.executor);
});

test('auditoria aceita as ações da gamemode', () => {
  const PonteUso = require('../models/PonteUso');
  for (const acao of ['gm_busca', 'gm_resultado', 'gm_auth_falhou', 'gm_selo_invalido', 'gm_enviar',
    'gm_cancelar', 'gm_incerto_ok', 'gm_incerto_reenviar', 'gm_credencial']) {
    assert.equal(new PonteUso({ acao }).validateSync(), undefined, acao);
  }
});

test('conexão da gamemode nasce ativa, sem pausa e exige o segredo cifrado', () => {
  const PonteConexaoGm = require('../models/PonteConexaoGm');
  const erro = new PonteConexaoGm({}).validateSync();
  assert.ok(erro.errors.guildId);
  assert.ok(erro.errors.nome);
  assert.ok(erro.errors['segredoCifrado.dados']);
  const doc = new PonteConexaoGm({ guildId: '1', nome: 'Brasil RP', segredoCifrado: cifra.cifrar('x') });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'ativa');
  assert.equal(doc.pausada, false);
  assert.deepEqual(doc.ipsPermitidos, []);
});

// ---------- 1. Vetores pela rota real ----------

test('rota real aceita as requisições dos vetores, com o relógio no horário deles', async () => {
  const [vGet, vPost] = vetores.requisicoes;
  const { conexao } = await guildGm('800', { segredo: vetores.segredo });
  const pedidoId = vPost.caminho.split('/').pop();
  const { punicao } = await punicaoComPedidos('800', 1, { _id: new mongoose.Types.ObjectId(pedidoId), status: 'entregue' });
  await m.PontePedidoGm.updateOne({ _id: pedidoId }, { $set: { conexaoId: conexao._id } });

  const pedirCru = (v) => fetch(`${base}${v.caminho}?${new URLSearchParams({ id: String(conexao._id), ts: String(v.ts), nonce: v.nonce, sig: v.assinatura })}`, {
    method: v.metodo, body: v.metodo === 'GET' ? undefined : v.corpo
  }).then(async r => ({ status: r.status, corpo: await r.json() }));

  try {
    relogioMs = vGet.ts * 1000;
    const busca = await pedirCru(vGet);
    assert.equal(busca.status, 200, JSON.stringify(busca.corpo));
    assert.equal(busca.corpo.agora, vGet.ts);
    relogioMs = vPost.ts * 1000;
    const envio = await pedirCru(vPost);
    assert.equal(envio.status, 200, JSON.stringify(envio.corpo));
  } finally {
    relogioMs = null;
  }
  const pedido = await m.PontePedidoGm.findById(pedidoId).lean();
  assert.equal(pedido.status, 'aplicada');
  assert.equal(pedido.resultado.organizacao, 'Policia Militar [6]');
  const fechada = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(fechada.status, 'aplicada');
  assert.equal(fechada.resultado[0].pc, 'gamemode:GM 800');
  assert.equal(fechada.resultado[0].comando, 'gamemode: ban 5d +1 aviso');
  assert.equal(fechada.resultado[0].contaId, '472860');
});

test('pedido entregue sai com o selo que a gamemode confere', async () => {
  const { conexao, segredo } = await guildGm('801');
  await punicaoComPedidos('801', 2);
  const r = await chamar(conexao, segredo, '/pedidos', { query: 'limite=10&versao=1.0.0&teste=1' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pedidos.length, 2);
  for (const p of r.corpo.pedidos) {
    const { selo, ...semSelo } = p;
    assert.equal(protocolo.selarPedido(segredo, semSelo).selo, selo);
    assert.equal(p.motivo, 'DM [DC]');
    assert.equal(p.somar, true);
  }
  const salvo = await m.PonteConexaoGm.findById(conexao._id).lean();
  assert.equal(salvo.versaoInclude, '1.0.0');
  assert.equal(salvo.modoTesteInformado, true);
  assert.ok(salvo.ultimoContatoEm);
  // Já entregues: a próxima busca vem vazia.
  assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.pedidos.length, 0);
});

// ---------- 2. Autenticação ----------

test('autenticação: sig ausente, relógio, nonce repetido e corpo alterado', async () => {
  const { conexao, segredo } = await guildGm('810');
  const semSig = await chamar(conexao, segredo, '/pedidos', { mexer: { query: { sig: undefined } } });
  assert.equal(semSig.status, 401);
  assert.equal(semSig.corpo.codigo, 'ASSINATURA');

  for (const desvio of [61, -61]) {
    const r = await chamar(conexao, segredo, '/pedidos', { ts: Math.floor(Date.now() / 1000) + desvio });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.codigo, 'RELOGIO');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  assert.equal((await chamar(conexao, segredo, '/pedidos', { nonce })).status, 200);
  const repetido = await chamar(conexao, segredo, '/pedidos', { nonce });
  assert.equal(repetido.status, 401);
  assert.equal(repetido.corpo.codigo, 'NONCE');

  const { pedidos } = await punicaoComPedidos('810', 1, { status: 'entregue', conexaoId: conexao._id });
  const corpo = resultado('aplicada', 'OK');
  const alterado = await chamar(conexao, segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo, mexer: { corpo: corpo.replace('Fulano', 'Fulanp') } });
  assert.equal(alterado.status, 401);
  assert.equal(alterado.corpo.codigo, 'ASSINATURA');

  const outroSegredo = await chamar(conexao, cifra.gerarSegredo(), '/pedidos');
  assert.equal(outroSegredo.corpo.codigo, 'ASSINATURA');
  assert.ok(await m.PonteUso.exists({ acao: 'gm_auth_falhou', guildId: '810' }));
});

test('autenticação: IP fora da lista, conexão revogada e executor pc dão 403', async () => {
  const fora = await guildGm('811', { ips: ['203.0.113.9'] });
  const ip = await chamar(fora.conexao, fora.segredo, '/pedidos');
  assert.deepEqual([ip.status, ip.corpo.codigo], [403, 'IP']);

  const liberado = await guildGm('812', { ips: ['127.0.0.1'] });
  assert.equal((await chamar(liberado.conexao, liberado.segredo, '/pedidos')).status, 200);

  const revogada = await guildGm('813');
  await m.PonteConexaoGm.updateOne({ _id: revogada.conexao._id }, { $set: { status: 'revogada' } });
  const r = await chamar(revogada.conexao, revogada.segredo, '/pedidos');
  assert.deepEqual([r.status, r.corpo.codigo], [403, 'REVOGADA']);

  const pc = await guildGm('814', { executor: 'pc' });
  assert.equal((await chamar(pc.conexao, pc.segredo, '/pedidos')).status, 403);

  const ambos = await guildGm('815', { executor: 'ambos' });
  assert.equal((await chamar(ambos.conexao, ambos.segredo, '/pedidos')).status, 200);

  const inexistente = await chamar({ _id: new mongoose.Types.ObjectId() }, cifra.gerarSegredo(), '/pedidos');
  assert.deepEqual([inexistente.status, inexistente.corpo.codigo], [401, 'CREDENCIAL']);
});

test('autenticação: sem chave mestra a API responde 503', async () => {
  const { conexao, segredo } = await guildGm('816');
  const original = process.env.PONTE_CHAVE_MESTRA;
  try {
    process.env.PONTE_CHAVE_MESTRA = '';
    assert.equal((await chamar(conexao, segredo, '/pedidos')).status, 503);
  } finally {
    process.env.PONTE_CHAVE_MESTRA = original;
  }
});

test('autenticação: falhas demais no minuto bloqueiam o IP', async () => {
  const app = express();
  app.use('/ponte/gm/v1', m.criarApiGamemode({ limites: { falhas: 3 } }));
  const servidor = app.listen(0);
  try {
    const url = `http://127.0.0.1:${servidor.address().port}/ponte/gm/v1/pedidos?id=x`;
    const codigos = [];
    for (let i = 0; i < 5; i++) codigos.push((await fetch(url)).status);
    assert.deepEqual(codigos, [401, 401, 401, 401, 429]);
  } finally {
    servidor.close();
  }
});

test('pausa pelo Discord ou na conexão: busca vem vazia e nada é entregue', async () => {
  const { conexao, segredo } = await guildGm('817');
  await punicaoComPedidos('817', 1);
  await m.PonteServidor.updateOne({ guildId: '817' }, { $set: { 'gm.pausado': true } });
  const r = await chamar(conexao, segredo, '/pedidos');
  assert.equal(r.corpo.pausado, true);
  assert.deepEqual(r.corpo.pedidos, []);
  assert.equal(await m.PontePedidoGm.countDocuments({ guildId: '817', status: 'aprovado' }), 1);
});

// ---------- 3. Isolamento ----------

test('isolamento: a conexão da guild A não recebe nem responde pedido da guild B', async () => {
  const a = await guildGm('820');
  const b = await guildGm('821');
  const { pedidos } = await punicaoComPedidos('821', 2);
  assert.equal((await chamar(a.conexao, a.segredo, '/pedidos')).corpo.pedidos.length, 0);

  const entregues = (await chamar(b.conexao, b.segredo, '/pedidos')).corpo.pedidos;
  assert.equal(entregues.length, 2);
  const r = await chamar(a.conexao, a.segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo: resultado('aplicada', 'OK') });
  assert.equal(r.status, 404);
  assert.equal((await m.PontePedidoGm.findById(pedidos[0]._id).lean()).status, 'entregue');
});

// ---------- 4. Entrega atômica ----------

test('entrega atômica: duas buscas ao mesmo tempo recebem conjuntos disjuntos', async () => {
  const { conexao, segredo } = await guildGm('830');
  await punicaoComPedidos('830', 15);
  const [x, y] = await Promise.all([
    chamar(conexao, segredo, '/pedidos', { query: 'limite=20' }),
    chamar(conexao, segredo, '/pedidos', { query: 'limite=20' })
  ]);
  const ids = [...x.corpo.pedidos, ...y.corpo.pedidos].map(p => p.id);
  assert.equal(ids.length, 15);
  assert.equal(new Set(ids).size, 15);
  assert.equal(await m.PontePedidoGm.countDocuments({ guildId: '830', status: 'entregue', entregas: 1 }), 15);
});

test('limite da busca vai de 1 a 20', async () => {
  const { conexao, segredo } = await guildGm('831');
  await punicaoComPedidos('831', 25);
  assert.equal((await chamar(conexao, segredo, '/pedidos', { query: 'limite=99' })).corpo.pedidos.length, 20);
  assert.equal((await chamar(conexao, segredo, '/pedidos', { query: 'limite=1' })).corpo.pedidos.length, 1);
  assert.equal((await chamar(conexao, segredo, '/pedidos', { query: 'limite=0' })).corpo.pedidos.length, 4);
});

// ---------- 5. Idempotência ----------

test('resultado: repetição idêntica dá 200, resultado diferente dá 409', async () => {
  const { conexao, segredo } = await guildGm('840');
  const { punicao, pedidos } = await punicaoComPedidos('840', 1);
  await chamar(conexao, segredo, '/pedidos');
  const caminho = `/resultados/${pedidos[0]._id}`;
  assert.equal((await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('aplicada', 'OK') })).status, 200);
  assert.equal((await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('aplicada', 'OK') })).status, 200);
  assert.equal((await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('recusada', 'JA_BANIDO') })).status, 409);
  const p = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(p.resultado.length, 1);
  assert.equal(p.status, 'aplicada');
  assert.equal(await m.PonteUso.countDocuments({ acao: 'gm_resultado', punicaoId: punicao._id }), 1);

  const invalido = await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('aplicada', 'JA_BANIDO') });
  assert.equal(invalido.status, 400);
  const inexistente = await chamar(conexao, segredo, `/resultados/${new mongoose.Types.ObjectId()}`, { metodo: 'POST', corpo: resultado('aplicada', 'OK') });
  assert.equal(inexistente.status, 404);
});

test('nenhum alvo aplicado (recusada ou simulada): a punição volta para aceita', async () => {
  const { conexao, segredo } = await guildGm('841');
  const { punicao, pedidos } = await punicaoComPedidos('841', 2);
  await chamar(conexao, segredo, '/pedidos');
  await chamar(conexao, segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo: resultado('recusada', 'CONTA_PROTEGIDA') });
  assert.equal((await m.PontePunicao.findById(punicao._id).lean()).status, 'executando');
  await chamar(conexao, segredo, `/resultados/${pedidos[1]._id}`, { metodo: 'POST', corpo: resultado('simulada', 'SIMULADA') });
  const p = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(p.status, 'aceita');
  assert.equal(p.resultado.length, 0);
});

test('selo inválido pausa a conexão no Althea e fica auditado', async () => {
  const { conexao, segredo } = await guildGm('842');
  const { pedidos } = await punicaoComPedidos('842', 1);
  await chamar(conexao, segredo, '/pedidos');
  assert.equal((await chamar(conexao, segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo: resultado('recusada', 'SELO_INVALIDO') })).status, 200);
  assert.equal((await m.PonteConexaoGm.findById(conexao._id).lean()).pausada, true);
  assert.ok(await m.PonteUso.exists({ acao: 'gm_selo_invalido', guildId: '842' }));
  assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.pausado, true);
});

// ---------- 6. Devolvida, erro e lease ----------

test('devolvida volta para aprovado até 5 vezes; na 6ª vira erro', async () => {
  const { conexao, segredo } = await guildGm('850');
  const { punicao, pedidos } = await punicaoComPedidos('850', 1);
  const caminho = `/resultados/${pedidos[0]._id}`;
  for (let i = 1; i <= 5; i++) {
    assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.pedidos.length, 1, `entrega ${i}`);
    assert.equal((await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('devolvida', 'PAUSADO') })).status, 200);
    const p = await m.PontePedidoGm.findById(pedidos[0]._id).lean();
    assert.deepEqual([p.status, p.devolucoes], ['aprovado', i]);
  }
  // Repetição da mesma devolução não conta de novo.
  assert.equal((await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('devolvida', 'PAUSADO') })).status, 200);
  assert.equal((await m.PontePedidoGm.findById(pedidos[0]._id).lean()).devolucoes, 5);

  await chamar(conexao, segredo, '/pedidos');
  await chamar(conexao, segredo, caminho, { metodo: 'POST', corpo: resultado('devolvida', 'LIMITE_HORA') });
  const p = await m.PontePedidoGm.findById(pedidos[0]._id).lean();
  assert.deepEqual([p.status, p.devolucoes, p.entregas], ['erro', 6, 6]);
  assert.equal((await m.PontePunicao.findById(punicao._id).lean()).status, 'aceita');
});

test('TIMEOUT_GAMEMODE e lease vencido viram incerto e não voltam sozinhos; resposta atrasada resolve', async () => {
  const { conexao, segredo } = await guildGm('851');
  const { pedidos } = await punicaoComPedidos('851', 2);
  await chamar(conexao, segredo, '/pedidos');

  await chamar(conexao, segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo: resultado('erro', 'TIMEOUT_GAMEMODE') });
  assert.equal((await m.PontePedidoGm.findById(pedidos[0]._id).lean()).status, 'incerto');

  // Antes do lease vencer nada muda; depois, o entregue sem resposta vira incerto.
  // (o job é global: outros testes deixam entregues em outras guilds)
  const daGuild = (lista) => lista.filter(p => p.guildId === '851').map(p => String(p._id));
  assert.deepEqual(daGuild(await m.pedidosGm.marcarIncertos(Date.now())), []);
  const marcados = await m.pedidosGm.marcarIncertos(Date.now() + (m.pedidosGm.LEASE_S + 1) * 1000);
  assert.deepEqual(daGuild(marcados), [String(pedidos[1]._id)]);

  // Incerto não é entregue de novo.
  assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.pedidos.length, 0);
  assert.equal(await m.PontePedidoGm.countDocuments({ guildId: '851', status: 'incerto' }), 2);

  // A resposta atrasada da gamemode resolve o incerto.
  assert.equal((await chamar(conexao, segredo, `/resultados/${pedidos[1]._id}`, { metodo: 'POST', corpo: resultado('aplicada', 'DUPLICADO') })).status, 200);
  assert.equal((await m.PontePedidoGm.findById(pedidos[1]._id).lean()).status, 'aplicada');
});

// ---------- Etapa 3: Discord (enviar, editar, cancelar) ----------

const discordGm = () => require('../services/ponteSamp/discordGm');
const staffA = { id: '300000000000000001', nome: 'João Staff' };

// Punição recém-aceita (como o registrarAceite deixa), sem pedidos.
async function punicaoAceita(guildId, alvos = [{ contaId: '472860', cmd: 'ban', tempo: 5, avisos: 1, motivo: 'DM + RK', regra: 'DM' }]) {
  return m.PontePunicao.create({ denunciaId: new mongoose.Types.ObjectId(), guildId, origem: 'canal_staff', status: 'aceita', alvos });
}

// Mensagens que o "Discord" recebeu e editou.
function clienteDiscord() {
  const enviadas = [];
  const editadas = [];
  const canal = {
    id: '400000000000000001',
    send: async (msg) => { enviadas.push(msg); return { id: '500000000000000001' }; },
    messages: { fetch: async () => ({ content: '', edit: async (msg) => editadas.push(msg) }) }
  };
  return { enviadas, editadas, client: { channels: { fetch: async () => canal } } };
}

test('9. motivoParaGamemode(motivoComSufixo(...)) sempre passa na regra do Alt_MotivoValido', () => {
  const { motivoComSufixo } = require('../services/ponteSamp/validacao');
  const { motivoGmValido, RE_MOTIVO_GM } = discordGm();
  const entradas = ['DM + RK', 'assédio à staff', '/kick todo mundo', '  espaço antes', 'ação em safezone 😡💥', 'x'.repeat(200),
    'MG|PG', '50% de "bug"', 'C-BUG', 'mal uso /eu', '{FF0000}cor', 'ÁÉÍÓÚ ç ñ', 'a\r\nb', '#1 @staff & cia', '[DC]', 'ok [DC]'];
  for (const texto of entradas) {
    const motivo = protocolo.motivoParaGamemode(motivoComSufixo(texto));
    assert.ok(RE_MOTIVO_GM.test(motivo), `${JSON.stringify(texto)} → ${JSON.stringify(motivo)}`);
    if (texto.trim() !== '[DC]') assert.ok(motivoGmValido(motivo), `termina com " [DC]": ${motivo}`);
    assert.ok(!motivo.includes('|'));
  }
  // Sem motivo nenhum sobra só "[DC]": o envio é bloqueado até editar.
  assert.equal(motivoGmValido(protocolo.motivoParaGamemode(motivoComSufixo(''))), false);
});

test('pedido do alvo respeita os limites gm.* da guild', () => {
  const { pedidoDoAlvo } = discordGm();
  const servidor = { gm: { maxBanDias: 30, permitirPermanente: true, maxCadeiaMin: 300, maxAvisos: 3 } };
  const alvo = (extra) => ({ _id: new mongoose.Types.ObjectId(), contaId: '472860', nick: '', cmd: 'ban', tempo: 5, avisos: 1, motivo: 'DM', regra: 'DM', ...extra });

  const ok = pedidoDoAlvo(alvo(), servidor).pedido;
  assert.deepEqual([ok.tipo, ok.conta, ok.nick, ok.tempo, ok.avisos, ok.somar, ok.motivo], ['ban', 472860, '', 5, 1, true, 'DM [DC]']);
  assert.ok(pedidoDoAlvo(alvo({ tempo: 0 }), servidor).pedido, 'permanente liberado');
  assert.match(pedidoDoAlvo(alvo({ tempo: 0 }), { gm: { ...servidor.gm, permitirPermanente: false } }).erro, /permanente/);
  assert.match(pedidoDoAlvo(alvo({ tempo: 31 }), servidor).erro, /máximo/);
  assert.match(pedidoDoAlvo(alvo({ avisos: 4 }), servidor).erro, /avisos/);
  assert.match(pedidoDoAlvo(alvo({ regra: '' }), servidor).erro, /fora da tabela/);
  assert.match(pedidoDoAlvo(alvo({ cmd: 'cadeia', tempo: 301 }), servidor).erro, /cadeia/);
  const cadeia = pedidoDoAlvo(alvo({ cmd: 'cadeia', tempo: 120, avisos: 0 }), servidor).pedido;
  assert.deepEqual([cadeia.tipo, cadeia.somar], ['cadeia', false], 'cadeia nunca soma (a gamemode recusa)');
  const soNick = pedidoDoAlvo(alvo({ contaId: '', nick: 'Fulano_Tal' }), servidor).pedido;
  assert.deepEqual([soNick.conta, soNick.nick], [0, 'Fulano_Tal']);
});

test('aceite em guild gamemode posta o embed com os botões no Relatório de punições', async () => {
  await guildGm('860');
  const Config = require('../models/Config');
  await Config.create({ guildId: '860', channels: { relatorioPunicoes: '400000000000000001' } });
  const { client, enviadas } = clienteDiscord();
  const punicao = await punicaoAceita('860');
  await discordGm().postarPunicaoGm(client, punicao.toObject(), await m.PonteServidor.findOne({ guildId: '860' }).lean());
  assert.equal(enviadas.length, 1);
  const embed = enviadas[0].embeds[0].toJSON();
  assert.equal(embed.title, '🎮 Punição para o jogo');
  assert.match(embed.description, /ban 5 dias \+ 1 aviso: DM \+ RK \[DC\]/);
  const ids = enviadas[0].components[0].toJSON().components.map(b => b.custom_id);
  assert.deepEqual(ids, [`ponte_gm_enviar:${punicao._id}`, `ponte_gm_editar:${punicao._id}`, `ponte_gm_cancelar:${punicao._id}`]);
  assert.deepEqual((await m.PontePunicao.findById(punicao._id).lean()).mensagemGm, { canalId: '400000000000000001', msgId: '500000000000000001' });

  // Guild que aplica pelo PC não recebe o embed.
  const pc = await guildGm('861', { executor: 'pc' });
  assert.equal(await discordGm().postarPunicaoGm(client, (await punicaoAceita('861')).toObject(), { ...pc, executor: 'pc' }), null);
  assert.equal(enviadas.length, 1);
});

test('enviar ao jogo cria um pedido por alvo, tira da fila do PC e só funciona uma vez', async () => {
  await guildGm('862');
  const punicao = await punicaoAceita('862', [
    { contaId: '472860', cmd: 'ban', tempo: 5, avisos: 1, motivo: 'DM', regra: 'DM' },
    { contaId: '', nick: 'Fulano_Tal', cmd: 'cadeia', tempo: 120, avisos: 0, motivo: 'MIX', regra: 'MIX' },
    { contaId: '9', cmd: 'ban', tempo: 1, motivo: 'x', regra: 'x', removido: true }
  ]);
  const [a, b] = await Promise.all([
    discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '862', staff: staffA }),
    discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '862', staff: staffA })
  ]);
  assert.equal([a, b].filter(r => r.ok).length, 1, 'dois cliques: só um envia');
  assert.equal([a, b].filter(r => r.erro).length, 1);

  const pedidos = await m.PontePedidoGm.find({ punicaoId: punicao._id }).sort({ criadoEm: 1 }).lean();
  assert.equal(pedidos.length, 2, 'alvo removido não vai');
  assert.deepEqual(pedidos.map(p => [p.tipo, p.conta, p.nick, p.status, p.rodada, p.aprovadoPor, p.teste]), [
    ['ban', 472860, '', 'aprovado', 1, 'Joao_Staff', true],
    ['cadeia', 0, 'Fulano_Tal', 'aprovado', 1, 'Joao_Staff', true]
  ]);
  assert.equal(pedidos[0].confirmadoPor[0].id, staffA.id);
  const atual = await m.PontePunicao.findById(punicao._id).lean();
  assert.deepEqual([atual.status, atual.executor, atual.executandoPor, atual.executandoDesde], ['executando', 'gamemode', null, null]);
  assert.ok(await m.PonteUso.exists({ acao: 'gm_enviar', punicaoId: punicao._id }));
});

test('enviar: motivo fora da tabela bloqueia até editar; guild do PC recusa', async () => {
  await guildGm('863');
  const semRegra = await punicaoAceita('863', [{ contaId: '1', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'coisa estranha', regra: '' }]);
  assert.match((await discordGm().enviarAoJogo({ punicaoId: semRegra._id, guildId: '863', staff: staffA })).erro, /fora da tabela/);
  assert.equal((await m.PontePunicao.findById(semRegra._id).lean()).status, 'aceita');

  const editado = await discordGm().editarAlvoGm({
    punicaoId: semRegra._id, guildId: '863', alvoId: semRegra.alvos[0]._id, versao: 0,
    campos: { tipo: 'Cadeia', tempo: '60', avisos: '', motivo: 'Anúncio indevido' }, staff: staffA
  });
  assert.equal(editado.ok, true);
  assert.deepEqual([editado.punicao.alvos[0].cmd, editado.punicao.alvos[0].tempo, editado.punicao.versao], ['cadeia', 60, 1]);
  assert.match(editado.punicao.alvos[0].regra, /editado por/);
  // Versão velha (outra pessoa editou antes) é recusada.
  assert.match((await discordGm().editarAlvoGm({
    punicaoId: semRegra._id, guildId: '863', alvoId: semRegra.alvos[0]._id, versao: 0, campos: { tipo: 'ban', tempo: '1', motivo: 'x' }, staff: staffA
  })).erro, /mudou/);
  assert.match((await discordGm().editarAlvoGm({
    punicaoId: semRegra._id, guildId: '863', alvoId: semRegra.alvos[0]._id, versao: 1, campos: { tipo: 'kick', tempo: '1', motivo: 'x' }, staff: staffA
  })).erro, /tipo/);
  assert.equal((await discordGm().enviarAoJogo({ punicaoId: semRegra._id, guildId: '863', staff: staffA })).ok, true);

  await guildGm('864', { executor: 'pc' });
  const doPc = await punicaoAceita('864');
  assert.match((await discordGm().enviarAoJogo({ punicaoId: doPc._id, guildId: '864', staff: staffA })).erro, /PC/);
});

test('cancelar: antes do envio cancela a punição; depois, cancela o que a gamemode não buscou', async () => {
  const { conexao, segredo } = await guildGm('865');
  const antes = await punicaoAceita('865');
  assert.equal((await discordGm().cancelarGm({ punicaoId: antes._id, guildId: '865', staff: staffA })).status, 'cancelada');
  assert.equal((await m.PontePunicao.findById(antes._id).lean()).status, 'cancelada');

  const depois = await punicaoAceita('865', [
    { contaId: '1', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' },
    { contaId: '2', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' }
  ]);
  await discordGm().enviarAoJogo({ punicaoId: depois._id, guildId: '865', staff: staffA });
  // A gamemode busca um dos dois; o outro ainda está na fila.
  await chamar(conexao, segredo, '/pedidos', { query: 'limite=1' });
  const r = await discordGm().cancelarGm({ punicaoId: depois._id, guildId: '865', staff: staffA });
  assert.deepEqual([r.cancelados, r.emAndamento], [1, 1]);
  assert.equal((await m.PontePunicao.findById(depois._id).lean()).status, 'executando', 'espera a resposta do entregue');
  assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.pedidos.length, 0, 'cancelado não é entregue');

  const entregue = await m.PontePedidoGm.findOne({ punicaoId: depois._id, status: 'entregue' }).lean();
  await chamar(conexao, segredo, `/resultados/${entregue._id}`, { metodo: 'POST', corpo: resultado('recusada', 'JA_BANIDO') });
  const fechada = await m.PontePunicao.findById(depois._id).lean();
  assert.deepEqual([fechada.status, fechada.executor], ['aceita', ''], 'nenhum aplicado: volta a esperar envio');
});

test('reenvio depois de simulada cria a rodada 2; embed mostra o estado de cada alvo', async () => {
  const { conexao, segredo } = await guildGm('866');
  const punicao = await punicaoAceita('866');
  await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '866', staff: staffA });
  const [entregue] = (await chamar(conexao, segredo, '/pedidos')).corpo.pedidos;
  await chamar(conexao, segredo, `/resultados/${entregue.id}`, { metodo: 'POST', corpo: resultado('simulada', 'SIMULADA') });
  assert.equal((await m.PontePunicao.findById(punicao._id).lean()).status, 'aceita');

  const servidor = await m.PonteServidor.findOne({ guildId: '866' }).lean();
  let msg = discordGm().montarMensagemGm(await m.PontePunicao.findById(punicao._id).lean(), await m.PontePedidoGm.find({ punicaoId: punicao._id }).lean(), servidor);
  assert.match(msg.embeds[0].toJSON().description, /última tentativa: 🧪 simulada/);
  assert.equal(msg.components[0].toJSON().components.length, 3, 'pode enviar de novo');

  assert.equal((await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '866', staff: staffA })).ok, true);
  const rodadas = (await m.PontePedidoGm.find({ punicaoId: punicao._id }).lean()).map(p => p.rodada).sort();
  assert.deepEqual(rodadas, [1, 2]);

  const [segundo] = (await chamar(conexao, segredo, '/pedidos')).corpo.pedidos;
  await chamar(conexao, segredo, `/resultados/${segundo.id}`, { metodo: 'POST', corpo: resultado('aplicada', 'OK') });
  msg = discordGm().montarMensagemGm(await m.PontePunicao.findById(punicao._id).lean(), await m.PontePedidoGm.find({ punicaoId: punicao._id }).lean(), servidor);
  const texto = msg.embeds[0].toJSON().description;
  assert.match(texto, /✅ aplicada/);
  assert.match(texto, /Aplicada pela gamemode/);
  assert.deepEqual(msg.components, [], 'aplicada: sem botões');
});

test('8. em executor gamemode, o PC recebe 409 ao executar; a liberação de presas não mexe na gamemode', async () => {
  const gestao = require('../services/ponteSamp/gestao');
  const { liberarExecucoesPresas, criarApiJogo } = require('../site/ponte/apiJogo');
  await guildGm('867');
  const { token } = await gestao.criarInstalacao({ guildId: '867', nome: 'PC 1', criadoPor: '1' });
  const punicao = await punicaoAceita('867');

  const app = express();
  app.use('/ponte/api', criarApiJogo({ limites: { ip: 10000, token: 10000, falhas: 10000 } }));
  const servidor = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/ponte/api/fila/${punicao._id}/executar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-HWID': 'c'.repeat(64), 'Content-Type': 'application/json' },
      body: JSON.stringify({ versao: 0 })
    });
    assert.equal(r.status, 409);
    assert.match((await r.json()).erro, /gamemode/);
  } finally {
    servidor.close();
  }

  await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '867', staff: staffA });
  // Mesmo com executandoDesde antigo, a da gamemode não volta para a fila do PC.
  await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { executandoDesde: new Date(Date.now() - 3600e3) } });
  await liberarExecucoesPresas('867');
  assert.equal((await m.PontePunicao.findById(punicao._id).lean()).status, 'executando');
});

test('resultado da gamemode edita o embed da punição', async () => {
  const { conexao, segredo } = await guildGm('868');
  const { client, editadas } = clienteDiscord();
  const app = express();
  app.use('/ponte/gm/v1', m.criarApiGamemode({ client, limites: { buscas: 10000, resultados: 10000, falhas: 10000 } }));
  const servidor = app.listen(0);
  const baseOriginal = base;
  base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const punicao = await punicaoAceita('868');
    await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { mensagemGm: { canalId: '400000000000000001', msgId: '500000000000000001' } } });
    await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '868', staff: staffA });
    const [p] = (await chamar(conexao, segredo, '/pedidos')).corpo.pedidos;
    await chamar(conexao, segredo, `/resultados/${p.id}`, { metodo: 'POST', corpo: resultado('recusada', 'CONTA_PROTEGIDA') });
    // As edições são em segundo plano.
    for (let i = 0; i < 50 && !editadas.some(e => /CONTA_PROTEGIDA/.test(e.embeds[0].toJSON().description)); i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(editadas.some(e => /❌ recusada \(CONTA_PROTEGIDA\)/.test(e.embeds[0].toJSON().description)));
  } finally {
    base = baseOriginal;
    servidor.close();
  }
});

// ---------- Etapa 4: incertos e alertas ----------

const incertosGm = () => require('../services/ponteSamp/incertosGm');

// Discord falso com canal (envia/edita) e DM do dono.
function discordComDm() {
  const enviadas = [];
  const editadas = [];
  const dms = [];
  const canal = {
    id: '400000000000000009',
    send: async (msg) => { enviadas.push(msg); return { id: `6000000000000000${enviadas.length}` }; },
    messages: { fetch: async () => ({ content: '', edit: async (msg) => editadas.push(msg) }) }
  };
  return {
    enviadas, editadas, dms,
    client: { channels: { fetch: async () => canal }, users: { fetch: async () => ({ send: async (msg) => dms.push(msg) }) } }
  };
}

async function comLogAdmin(guildId) {
  const Config = require('../models/Config');
  await Config.create({ guildId, channels: { log: '400000000000000009' }, roles: { responsavel_admin: '200000000000000003' } });
}

test('job de incerto: lease vencido e TIMEOUT vão uma vez só para o Log Admin, com os dois botões', async () => {
  const { conexao, segredo } = await guildGm('870');
  await comLogAdmin('870');
  const { client, enviadas } = discordComDm();
  const punicao = await punicaoAceita('870', [
    { contaId: '1', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' },
    { contaId: '2', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' }
  ]);
  await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '870', staff: staffA });
  const [primeiro] = (await chamar(conexao, segredo, '/pedidos', { query: 'limite=2' })).corpo.pedidos;
  await chamar(conexao, segredo, `/resultados/${primeiro.id}`, { metodo: 'POST', corpo: resultado('erro', 'TIMEOUT_GAMEMODE') });

  const depoisDoLease = Date.now() + 121 * 1000;
  // O job avisa até 20 por ciclo, e os outros testes deixaram entregues em outras guilds.
  for (let i = 0; i < 10; i++) {
    await incertosGm().verificarIncertos(client, depoisDoLease);
    if (!(await m.PontePedidoGm.exists({ status: 'incerto', alertaIncertoEm: null }))) break;
  }
  const daGuild = enviadas.filter(e => /Pedido/.test(e.embeds[0].toJSON().footer.text));
  assert.equal(daGuild.length >= 2, true);
  const ids = await m.PontePedidoGm.find({ punicaoId: punicao._id }).lean();
  assert.ok(ids.every(p => p.status === 'incerto' && p.alertaIncertoEm && p.mensagemIncerto.msgId));
  const botoes = daGuild[0].components[0].toJSON().components.map(b => b.custom_id.split(':')[0] + ':');
  assert.deepEqual(botoes, ['ponte_gm_incerto_ok:', 'ponte_gm_incerto_reenviar:']);
  assert.equal(daGuild[0].content, '<@&200000000000000003>');

  const total = enviadas.length;
  await incertosGm().verificarIncertos(client, depoisDoLease + 30e3);
  assert.equal(enviadas.length, total, 'não avisa de novo');
});

test('incerto: "foi aplicada" fecha a punição; "reenviar" cria a rodada seguinte; cada um só uma vez', async () => {
  const { conexao, segredo } = await guildGm('871');
  const { client, editadas } = discordComDm();
  const punicao = await punicaoAceita('871', [
    { contaId: '1', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' },
    { contaId: '2', cmd: 'ban', tempo: 1, avisos: 1, motivo: 'MG', regra: 'MG' }
  ]);
  await discordGm().enviarAoJogo({ punicaoId: punicao._id, guildId: '871', staff: staffA });
  const [a, b] = (await chamar(conexao, segredo, '/pedidos', { query: 'limite=2' })).corpo.pedidos;
  for (const p of [a, b]) await chamar(conexao, segredo, `/resultados/${p.id}`, { metodo: 'POST', corpo: resultado('erro', 'ERRO_GAMEMODE') });
  await m.PontePedidoGm.updateMany({ punicaoId: punicao._id }, { $set: { mensagemIncerto: { canalId: 'c', msgId: 'm' } } });

  const ok = await incertosGm().resolverIncerto({ client, pedidoId: a.id, guildId: '871', staff: staffA, aplicada: true });
  assert.equal(ok.ok, true);
  assert.match((await incertosGm().resolverIncerto({ client, pedidoId: a.id, guildId: '871', staff: staffA, aplicada: true })).erro, /não está mais incerto/);
  assert.match((await incertosGm().resolverIncerto({ client, pedidoId: b.id, guildId: '999', staff: staffA, aplicada: true })).erro, /não está mais incerto/, 'outra guild não resolve');
  assert.equal((await m.PontePunicao.findById(punicao._id).lean()).status, 'executando', 'o outro alvo segue incerto');

  const reenvio = await incertosGm().resolverIncerto({ client, pedidoId: b.id, guildId: '871', staff: staffA, aplicada: false });
  assert.equal(reenvio.novo.rodada, 2);
  assert.equal(reenvio.novo.status, 'aprovado');
  assert.equal(reenvio.novo.confirmadoPor[0].id, staffA.id);
  assert.equal((await m.PontePedidoGm.findById(b.id).lean()).status, 'cancelado');
  // A resposta atrasada do pedido antigo não vale mais.
  assert.equal((await chamar(conexao, segredo, `/resultados/${b.id}`, { metodo: 'POST', corpo: resultado('aplicada', 'OK') })).status, 409);

  const [novo] = (await chamar(conexao, segredo, '/pedidos')).corpo.pedidos;
  assert.equal(novo.id, String(reenvio.novo._id));
  await chamar(conexao, segredo, `/resultados/${novo.id}`, { metodo: 'POST', corpo: resultado('aplicada', 'OK') });
  const fechada = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(fechada.status, 'aplicada');
  assert.equal(fechada.resultado.length, 2);
  assert.match(fechada.resultado.find(r => String(r.alvoId) === String(punicao.alvos[0]._id)).pc, /confirmado por João Staff/);
  assert.ok(await m.PonteUso.exists({ acao: 'gm_incerto_ok', punicaoId: punicao._id }));
  assert.ok(await m.PonteUso.exists({ acao: 'gm_incerto_reenviar', punicaoId: punicao._id }));
  assert.ok(editadas.some(e => /Marcada como aplicada/.test(e.embeds[0].toJSON().description)));
  assert.ok(editadas.every(e => e.components.length === 0), 'aviso resolvido perde os botões');
});

test('alertas: selo inválido avisa o dono por DM e o canal; devolução demais avisa o canal', async () => {
  process.env.OWNER_DISCORD_ID = '900000000000000001';
  const { conexao, segredo } = await guildGm('872');
  await comLogAdmin('872');
  const alvo = discordComDm();
  const app = express();
  app.use('/ponte/gm/v1', m.criarApiGamemode({ client: alvo.client, limites: { buscas: 10000, resultados: 10000, falhas: 10000 } }));
  const servidor = app.listen(0);
  const baseOriginal = base;
  base = `http://127.0.0.1:${servidor.address().port}`;
  const esperar = async (cond) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); };
  try {
    const { pedidos } = await punicaoComPedidos('872', 2);
    await chamar(conexao, segredo, '/pedidos', { query: 'limite=1' });
    await chamar(conexao, segredo, `/resultados/${pedidos[0]._id}`, { metodo: 'POST', corpo: resultado('recusada', 'SELO_INVALIDO') });
    await esperar(() => alvo.dms.length && alvo.enviadas.some(e => /Selo inválido/.test(e.embeds?.[0]?.toJSON().title)));
    assert.match(alvo.dms[0].content, /recusou o selo/);
    assert.ok(alvo.enviadas.some(e => /Selo inválido/.test(e.embeds?.[0]?.toJSON().title)));
    assert.equal(alvo.dms[0].content.includes(segredo), false, 'o segredo nunca aparece');

    await m.PonteConexaoGm.updateOne({ _id: conexao._id }, { $set: { pausada: false } });
    await m.PontePedidoGm.updateOne({ _id: pedidos[1]._id }, { $set: { devolucoes: 5 } });
    await chamar(conexao, segredo, '/pedidos');
    await chamar(conexao, segredo, `/resultados/${pedidos[1]._id}`, { metodo: 'POST', corpo: resultado('devolvida', 'LIMITE_HORA') });
    await esperar(() => alvo.enviadas.some(e => /devolvido demais/.test(e.embeds?.[0]?.toJSON().title)));
    assert.ok(alvo.enviadas.some(e => /devolvido demais/.test(e.embeds?.[0]?.toJSON().title)));
  } finally {
    base = baseOriginal;
    servidor.close();
  }
});

test('alertas: IP bloqueado por falhas avisa uma vez por bloqueio', async () => {
  const alvo = discordComDm();
  const app = express();
  app.use('/ponte/gm/v1', m.criarApiGamemode({ client: alvo.client, limites: { falhas: 2 } }));
  const servidor = app.listen(0);
  try {
    const url = `http://127.0.0.1:${servidor.address().port}/ponte/gm/v1/pedidos?id=x`;
    for (let i = 0; i < 6; i++) await fetch(url).then(r => r.arrayBuffer());
    for (let i = 0; i < 50 && !alvo.dms.length; i++) await new Promise(r => setTimeout(r, 20));
    // Credencial inexistente: não dá para saber a guild, então o aviso vai só para o dono.
    assert.equal(alvo.dms.length, 1);
    assert.match(alvo.dms[0].content, /bloqueado por 10 minutos/);
  } finally {
    servidor.close();
  }
});

// ---------- Etapa 5: /ponte gamemode ----------

const conexoesGm = () => require('../services/ponteSamp/conexoesGm');
const DONO = '900000000000000001';

// Interação falsa de /ponte gamemode <sub>, com o que o handler responde.
function interacaoGm(sub, { usuario = DONO, opcoes = {}, guildId = '880', gerencia = false, cargos = [] } = {}) {
  const respostas = [];
  return {
    respostas,
    user: { id: usuario, tag: 'teste#0001' },
    guild: { id: guildId, name: 'Teste' },
    memberPermissions: { has: () => gerencia },
    member: { roles: { cache: new Map(cargos.map(id => [id, {}])) } },
    options: {
      getSubcommandGroup: () => 'gamemode',
      getSubcommand: () => sub,
      getString: (nome) => opcoes[nome] ?? null
    },
    reply: async (msg) => respostas.push(msg),
    deferReply: async () => {},
    editReply: async (msg) => respostas.push(msg),
    showModal: async (modal) => respostas.push({ modal })
  };
}

const textoDe = (resposta) => (typeof resposta === 'string' ? resposta : resposta?.content || '');

test('credencial: IPs validados, segredo só no retorno e cifrado no banco', async () => {
  const { lerIps } = conexoesGm();
  assert.deepEqual(lerIps(' 1.2.3.4, 1.2.3.4;2001:db8::1 ').ips, ['1.2.3.4', '2001:db8::1']);
  assert.deepEqual(lerIps('').ips, []);
  assert.match(lerIps('1.2.3.4, 999.1.1.1').erro, /IP inválido/);
  assert.match(lerIps(Array.from({ length: 11 }, (_, i) => `10.0.0.${i}`).join(',')).erro, /Até 10/);

  await guildGm('880');
  const { segredo, conexao } = await conexoesGm().criarConexao({ guildId: '880', nome: 'Brasil RP <script>', ips: '203.0.113.7', criadoPor: DONO });
  assert.match(segredo, /^[0-9a-f]{64}$/);
  assert.equal(conexao.nome, 'Brasil RP script');
  const salvo = await m.PonteConexaoGm.findById(conexao._id).lean();
  assert.equal(JSON.stringify(salvo).includes(segredo), false, 'o segredo não fica em texto no banco');
  assert.equal(cifra.decifrar(salvo.segredoCifrado), segredo);
  assert.equal(salvo.ultimos4, segredo.slice(-4));
  assert.deepEqual(salvo.ipsPermitidos, ['203.0.113.7']);
  assert.equal(conexoesGm().arquivoCredenciais(conexao, segredo), `id=${conexao._id}\nsegredo=${segredo}\n`);
  assert.equal((await conexoesGm().listarConexoes('880')).some(c => c.segredoCifrado), false, 'listar não traz o segredo');

  assert.match((await conexoesGm().criarConexao({ guildId: '889', nome: 'x', criadoPor: DONO })).erro, /não está ativa/);
  const original = process.env.PONTE_CHAVE_MESTRA;
  try {
    process.env.PONTE_CHAVE_MESTRA = '';
    assert.match((await conexoesGm().criarConexao({ guildId: '880', nome: 'x', criadoPor: DONO })).erro, /PONTE_CHAVE_MESTRA/);
  } finally {
    process.env.PONTE_CHAVE_MESTRA = original;
  }
});

test('renovar: o segredo antigo para de valer na hora; revogar só uma vez', async () => {
  await guildGm('881');
  const { segredo, conexao } = await conexoesGm().criarConexao({ guildId: '881', nome: 'GM', criadoPor: DONO });
  assert.equal((await chamar(conexao, segredo, '/pedidos')).status, 200);

  const renovada = await conexoesGm().renovarConexao({ guildId: '881', id: String(conexao._id) });
  assert.notEqual(renovada.segredo, segredo);
  assert.equal((await chamar(conexao, segredo, '/pedidos')).corpo.codigo, 'ASSINATURA');
  assert.equal((await chamar(conexao, renovada.segredo, '/pedidos')).status, 200);
  assert.match((await conexoesGm().renovarConexao({ guildId: '999', id: String(conexao._id) })).erro, /não encontrada/, 'outra guild não renova');

  assert.ok(await conexoesGm().revogarConexao({ guildId: '881', id: String(conexao._id), por: DONO }));
  assert.equal(await conexoesGm().revogarConexao({ guildId: '881', id: String(conexao._id), por: DONO }), null);
  assert.match((await conexoesGm().renovarConexao({ guildId: '881', id: String(conexao._id) })).erro, /não encontrada/);
});

test('/ponte gamemode criar: só o dono; a credencial vem num anexo efêmero', async () => {
  process.env.OWNER_DISCORD_ID = DONO;
  const { handlePonteGamemode } = require('../commands/ponteGamemode');
  await guildGm('882');

  const intruso = interacaoGm('criar', { usuario: '123', guildId: '882', opcoes: { nome: 'GM' }, gerencia: true });
  await handlePonteGamemode(intruso);
  assert.match(textoDe(intruso.respostas[0]), /Só o dono/);
  assert.ok(await m.PonteUso.exists({ guildId: '882', acao: 'gm_credencial', 'detalhes.negado': true }));
  assert.equal(await m.PonteConexaoGm.countDocuments({ guildId: '882', nome: 'GM' }), 0);

  const dono = interacaoGm('criar', { guildId: '882', opcoes: { nome: 'GM' } });
  await handlePonteGamemode(dono);
  const resposta = dono.respostas[0];
  assert.deepEqual(resposta.flags, [64]);
  assert.equal(resposta.files[0].name, 'althea_credenciais.txt');
  const arquivo = resposta.files[0].attachment.toString('utf8');
  assert.match(arquivo, /^id=[0-9a-f]{24}\nsegredo=[0-9a-f]{64}\n$/);
  assert.equal(resposta.content.includes(arquivo.split('segredo=')[1].trim()), false, 'o segredo só vai no anexo');
  assert.match(resposta.content, /qualquer IP/);

  const listar = interacaoGm('listar', { guildId: '882' });
  await handlePonteGamemode(listar);
  assert.match(textoDe(listar.respostas[0]), /GM.*⚠️ qualquer IP/);
});

test('/ponte gamemode pausar, retomar e executor: só o responsável', async () => {
  const { handlePonteGamemode } = require('../commands/ponteGamemode');
  const { conexao } = await guildGm('883');
  await m.PonteConexaoGm.updateOne({ _id: conexao._id }, { $set: { pausada: true } });

  const semCargo = interacaoGm('pausar', { usuario: '123', guildId: '883' });
  await handlePonteGamemode(semCargo);
  assert.match(textoDe(semCargo.respostas[0]), /Só o responsável/);

  await handlePonteGamemode(interacaoGm('pausar', { usuario: '123', guildId: '883', gerencia: true }));
  assert.equal((await m.PonteServidor.findOne({ guildId: '883' }).lean()).gm.pausado, true);
  const retomar = interacaoGm('retomar', { usuario: '123', guildId: '883', gerencia: true });
  await handlePonteGamemode(retomar);
  assert.equal((await m.PonteServidor.findOne({ guildId: '883' }).lean()).gm.pausado, false);
  assert.equal((await m.PonteConexaoGm.findById(conexao._id).lean()).pausada, false, 'retomar solta a credencial pausada por selo');
  assert.match(textoDe(retomar.respostas[0]), /1 credencial/);

  await handlePonteGamemode(interacaoGm('executor', { usuario: '123', guildId: '883', gerencia: true, opcoes: { tipo: 'ambos' } }));
  assert.equal((await m.PonteServidor.findOne({ guildId: '883' }).lean()).executor, 'ambos');
  assert.ok(await m.PonteUso.exists({ guildId: '883', acao: 'gm_config', 'detalhes.sub': 'executor' }));

  const limites = interacaoGm('limites', { usuario: '123', guildId: '883', gerencia: true });
  await handlePonteGamemode(limites);
  assert.equal(limites.respostas[0].modal.toJSON().custom_id, 'ponte_gm_limites_modal');
});

test('modal de limites: lê números e sim/não, recusa fora da faixa', () => {
  const { lerLimites } = require('../commands/ponteGamemode');
  const base = { maxBanDias: '30', maxCadeiaMin: '300', maxAvisos: '3', permitirPermanente: 'Sim', modoTeste: 'não' };
  assert.deepEqual(lerLimites(base).gm, { maxBanDias: 30, maxCadeiaMin: 300, maxAvisos: 3, permitirPermanente: true, modoTeste: false });
  assert.match(lerLimites({ ...base, maxAvisos: '11' }).erro, /Avisos/);
  assert.match(lerLimites({ ...base, maxBanDias: '0' }).erro, /Ban máximo/);
  assert.match(lerLimites({ ...base, maxCadeiaMin: '1.5' }).erro, /Cadeia/);
  assert.match(lerLimites({ ...base, modoTeste: 'talvez' }).erro, /Modo teste/);
});

// ---------- Etapa 6: painel do dono (/admin → Gamemode) ----------

// /admin com o usuário logado escolhido pelo cabeçalho X-Usuario (só no teste).
async function comAdmin(fn) {
  const { criarAdmin } = require('../site/ponte/admin');
  const app = express();
  app.use((req, res, next) => {
    const id = req.get('X-Usuario');
    req.usuario = id ? { id, nome: 'Dono' } : null;
    req.sid = id ? `sid-${id}` : null;
    next();
  });
  app.use('/admin', criarAdmin({ client: null, config: { segredo: 'z'.repeat(40) }, log: null }));
  const servidor = app.listen(0);
  const url = `http://127.0.0.1:${servidor.address().port}/admin/api`;
  const pedir = async (caminho, { usuario = DONO, metodo = 'GET', corpo, csrf } = {}) => {
    const r = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: { 'X-Usuario': usuario, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF': csrf } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json() };
  };
  try {
    await fn(pedir);
  } finally {
    servidor.close();
  }
}

test('/admin gamemode: só o dono vê; conexões sem segredo, online e sem IP', async () => {
  process.env.OWNER_DISCORD_ID = DONO;
  const { conexao } = await guildGm('890');
  await m.PonteConexaoGm.updateOne({ _id: conexao._id }, { $set: { ultimoContatoEm: new Date(), versaoInclude: '1.0.0', modoTesteInformado: true } });
  await comAdmin(async (pedir) => {
    assert.equal((await pedir('/gamemode/conexoes', { usuario: '123' })).status, 404, 'outra pessoa não descobre a rota');

    const { status, corpo } = await pedir('/gamemode/conexoes');
    assert.equal(status, 200);
    const item = corpo.find(c => c.id === String(conexao._id));
    assert.deepEqual([item.online, item.versaoInclude, item.modoTesteInformado, item.ipsPermitidos, item.executor], [true, '1.0.0', true, [], 'gamemode']);
    assert.equal(JSON.stringify(corpo).includes('segredoCifrado'), false);
    assert.equal(JSON.stringify(corpo).includes('"dados"'), false);
  });
});

test('/admin gamemode: pausar e revogar exigem CSRF e ficam auditados', async () => {
  const { conexao } = await guildGm('891');
  await comAdmin(async (pedir) => {
    assert.equal((await pedir(`/gamemode/conexoes/${conexao._id}/pausar`, { metodo: 'POST', corpo: {} })).status, 403, 'sem CSRF');
    const { csrf } = (await pedir('/csrf')).corpo;

    assert.equal((await pedir(`/gamemode/conexoes/${conexao._id}/pausar`, { metodo: 'POST', corpo: { pausada: true }, csrf })).corpo.ok, true);
    assert.equal((await m.PonteConexaoGm.findById(conexao._id).lean()).pausada, true);
    await pedir(`/gamemode/conexoes/${conexao._id}/pausar`, { metodo: 'POST', corpo: { pausada: false }, csrf });
    assert.equal((await m.PonteConexaoGm.findById(conexao._id).lean()).pausada, false);

    assert.equal((await pedir(`/gamemode/conexoes/${conexao._id}/revogar`, { metodo: 'POST', csrf })).corpo.ok, true);
    assert.equal((await pedir(`/gamemode/conexoes/${conexao._id}/revogar`, { metodo: 'POST', csrf })).corpo.ok, false, 'já revogada');
    assert.equal((await m.PonteConexaoGm.findById(conexao._id).lean()).status, 'revogada');
    assert.ok(await m.PonteUso.exists({ guildId: '891', acao: 'gm_credencial', 'detalhes.via': 'admin' }));
    assert.equal((await pedir('/gamemode/conexoes/xyz/revogar', { metodo: 'POST', csrf })).status, 400);
  });
});

test('/admin gamemode: pedidos recentes com filtro por status e auditoria gm_*', async () => {
  await guildGm('100000000000000892');
  const { pedidos } = await punicaoComPedidos('100000000000000892', 2);
  await m.PontePedidoGm.updateOne({ _id: pedidos[0]._id }, { $set: { status: 'incerto', codigo: 'TIMEOUT_GAMEMODE' } });
  await m.PonteUso.create({ guildId: '100000000000000892', acao: 'gm_enviar' });
  await m.PonteUso.create({ guildId: '100000000000000892', acao: 'fila' });
  await comAdmin(async (pedir) => {
    const incertos = (await pedir('/gamemode/pedidos?status=incerto&guildId=100000000000000892')).corpo;
    assert.deepEqual(incertos.map(p => [p.id, p.codigo]), [[String(pedidos[0]._id), 'TIMEOUT_GAMEMODE']]);
    assert.equal((await pedir('/gamemode/pedidos?guildId=100000000000000892')).corpo.length, 2);
    assert.equal((await pedir('/gamemode/pedidos?status=qualquer&guildId=100000000000000892')).corpo.length, 2, 'status desconhecido não filtra');

    const uso = (await pedir('/uso?acao=gm&guildId=100000000000000892')).corpo;
    assert.ok(uso.length >= 1);
    assert.ok(uso.every(u => u.acao.startsWith('gm_')));
  });
});
