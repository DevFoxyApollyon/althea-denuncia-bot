require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { iniciarMongoMemoria } = require('./helpers/mongoMemoria');
const seguranca = require('../services/ponteSamp/seguranca');
const validacao = require('../services/ponteSamp/validacao');

process.env.PONTE_SAMP_ATIVA = '1';
process.env.OWNER_DISCORD_ID = '900000000000000001';

let mongo;
let base;
let http;
let m; // models e serviços, carregados depois do Mongo subir

const HWID_A = 'a'.repeat(64);
const HWID_B = 'b'.repeat(64);

test.before(async () => {
  mongo = await iniciarMongoMemoria();
  m = {
    PontePunicao: require('../models/PontePunicao'),
    PonteInstalacao: require('../models/PonteInstalacao'),
    PonteServidor: require('../models/PonteServidor'),
    PonteCodigo: require('../models/PonteCodigo'),
    PonteUso: require('../models/PonteUso'),
    gestao: require('../services/ponteSamp/gestao'),
    aceite: require('../services/ponteSamp/aceite'),
    criarApiJogo: require('../site/ponte/apiJogo').criarApiJogo
  };
  // Os índices únicos precisam existir antes dos testes de corrida.
  await Promise.all(['PontePunicao', 'PonteInstalacao', 'PonteServidor', 'PonteCodigo'].map(nome => m[nome].init()));

  const app = express();
  app.use('/ponte/api', m.criarApiJogo({ limites: { ip: 10000, token: 10000, falhas: 10000 } }));
  http = app.listen(0);
  base = `http://127.0.0.1:${http.address().port}/ponte/api`;
});

test.after(async () => {
  http?.close();
  await mongo?.parar();
});

const clienteFalso = { channels: { fetch: async () => null } };

async function guildAtiva(guildId) {
  const { codigo } = await m.gestao.criarCodigo({ criadoPor: process.env.OWNER_DISCORD_ID, limitePcs: 5 });
  const { servidor, erro } = await m.gestao.ativarGuild({ codigo, guildId, userId: '1' });
  assert.equal(erro, undefined);
  return servidor;
}

function denunciaFalsa(guildId, acusadoId = '1039+2471') {
  return {
    _id: new mongoose.Types.ObjectId(), guildId, threadId: '', acusadoId,
    motivoAceite: 'DM\n{FF0000}/kick', motivo: 'matou sem motivo', acusado: 'Fulano', provas: 'link'
  };
}

const chamar = (caminho, { token, hwid = HWID_A, metodo = 'GET', corpo } = {}) => fetch(`${base}${caminho}`, {
  method: metodo,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(hwid ? { 'X-HWID': hwid } : {}),
    ...(corpo ? { 'Content-Type': 'application/json' } : {})
  },
  body: corpo ? JSON.stringify(corpo) : undefined
}).then(async r => ({ status: r.status, corpo: await r.json() }));

// ---------- funções puras ----------

test('código e token: hash estável, só o final fica visível', () => {
  const codigo = seguranca.gerarCodigo();
  assert.match(codigo, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(seguranca.hashCodigo(codigo), seguranca.hashCodigo(codigo.toLowerCase().replace(/-/g, ' ')));
  assert.equal(seguranca.ultimos4('ABCD-EFGH'), 'EFGH');
  assert.ok(seguranca.gerarToken().length >= 40);
});

test('motivo é limpo de quebras, cores, barra inicial e cortado em 60', () => {
  assert.equal(validacao.limparMotivo('/kick\r\n{FF0000}DM   x'), 'kick FF0000 DM x');
  assert.equal(validacao.limparMotivo('a'.repeat(100)).length, 60);
});

test('template só aceita marcadores conhecidos e o comando respeita 128 caracteres', () => {
  assert.equal(validacao.templateValido('/prender {id} {tempo} {motivo}'), true);
  assert.equal(validacao.templateValido('prender {id}'), false);
  assert.equal(validacao.templateValido('/x {id} {senha}'), false);
  assert.equal(validacao.montarComando('/tempban {id} {tempo} {motivo}', { contaId: '472860', tempo: 5, motivo: 'DM' }, 'ban'), '/tempban 472860 5 DM [DC]');
  assert.equal(validacao.montarComando('/agendacadeia {id} {tempo} {motivo}', { contaId: '1', tempo: 120, motivo: 'MIX [DC]' }, 'cadeia'), '/agendacadeia 1 120 MIX [DC]');
});

test('motivo do Discord define comando e tempo pela tabela de punições', () => {
  const c = validacao.classificarMotivo;
  assert.deepEqual([c('DM').cmd, c('DM').tempo], ['ban', 5]);
  assert.equal(c('foi ADB').tempo, 5);          // ADB não vira DB (30 dias)
  assert.equal(c('venda de conta').tempo, 0);   // permanente
  assert.deepEqual([c('MIX').cmd, c('MIX').tempo], ['cadeia', 120]);
  assert.equal(c('assédio').tempo, 0);          // sem acento também casa
  assert.equal(c('qualquer coisa').regra, '');  // sem regra: staff confere
});

test('guild com templates provisórios passa a usar os comandos reais', () => {
  const t = validacao.templatesEfetivos({ jail: '/prender {id} {tempo} {motivo}', ban: '/ban {id} {tempo} {motivo}', kick: '/kick {id} {motivo}' });
  assert.equal(t.ban, '/tempban {id} {tempo} {motivo}');
  assert.equal(t.cadeia, '/agendacadeia {id} {tempo} {motivo}');
  // Guild que ficou com o nome errado salvo passa ao comando certo.
  assert.equal(validacao.templatesEfetivos({ cadeia: '/agendarcadeia {id} {tempo} {motivo}' }).cadeia, '/agendacadeia {id} {tempo} {motivo}');
});

test('validarAlvos recusa conta, nick, tipo, tempo e avisos inválidos', () => {
  const tpl = {};
  assert.ok(validacao.validarAlvos([{ contaId: '12a', cmd: 'ban' }], tpl).erro);
  assert.ok(validacao.validarAlvos([{ contaId: '1', nick: 'a b', cmd: 'ban' }], tpl).erro);
  assert.ok(validacao.validarAlvos([{ contaId: '1', cmd: 'aviso' }], tpl).erro); // auxiliar não é tipo
  assert.ok(validacao.validarAlvos([{ contaId: '1', cmd: 'ban', tempo: 100000 }], tpl).erro);
  assert.ok(validacao.validarAlvos([{ contaId: '1', cmd: 'ban', avisos: 11 }], tpl).erro);
  assert.equal(validacao.validarAlvos([{ contaId: '1', nick: 'Nick_Bom', cmd: 'cadeia', tempo: 120 }], tpl).alvos.length, 1);
});

// ---------- banco ----------

test('código de ativação: dois /ativar simultâneos, só um ganha', async () => {
  const { codigo } = await m.gestao.criarCodigo({ criadoPor: '1' });
  const [a, b] = await Promise.all([
    m.gestao.ativarGuild({ codigo, guildId: '700', userId: '1' }),
    m.gestao.ativarGuild({ codigo, guildId: '701', userId: '1' })
  ]);
  assert.equal([a, b].filter(r => r.servidor).length, 1);
  assert.equal([a, b].filter(r => r.erro).length, 1);
});

test('código expirado não ativa', async () => {
  const { codigo } = await m.gestao.criarCodigo({ criadoPor: '1', validadeDias: 1, agora: new Date(Date.now() - 2 * 864e5) });
  assert.ok((await m.gestao.ativarGuild({ codigo, guildId: '702', userId: '1' })).erro);
});

test('instalação respeita o limite de PCs e grava só o hash do token', async () => {
  await guildAtiva('710');
  await m.PonteServidor.updateOne({ guildId: '710' }, { $set: { limitePcs: 1 } });
  const { token, instalacao } = await m.gestao.criarInstalacao({ guildId: '710', nome: 'PC 1', criadoPor: '1' });
  assert.equal(instalacao.tokenHash, seguranca.sha256(token));
  assert.equal(JSON.stringify(instalacao).includes(token), false);
  assert.ok((await m.gestao.criarInstalacao({ guildId: '710', nome: 'PC 2', criadoPor: '1' })).erro);
});

test('registrarAceite: dois aceites em paralelo geram uma punição só', async () => {
  await guildAtiva('720');
  const denuncia = denunciaFalsa('720');
  const staff = { id: '5', nome: 'Staff' };
  const resultados = await Promise.all([
    m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff }),
    m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff })
  ]);
  assert.equal(await m.PontePunicao.countDocuments({ denunciaId: denuncia._id }), 1);
  assert.equal(resultados.filter(r => r?.criado).length, 1);
  assert.equal(resultados.filter(r => r?.jaExistia).length, 1);

  const punicao = await m.PontePunicao.findOne({ denunciaId: denuncia._id }).lean();
  assert.deepEqual(punicao.alvos.map(a => a.contaId), ['1039', '2471']);
  assert.equal(punicao.alvos[0].motivo, 'DM FF0000 /kick');
  assert.deepEqual([punicao.alvos[0].cmd, punicao.alvos[0].tempo], ['ban', 5]);
});

test('registrarAceite não faz nada em guild sem ponte ativa', async () => {
  const r = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('729'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  assert.equal(r, null);
});

// ---------- API do jogo ----------

test('API: sem token 401, guild desativada 403', async () => {
  assert.equal((await chamar('/fila')).status, 401);
  assert.equal((await chamar('/fila', { token: 'x'.repeat(43) })).status, 401);

  await guildAtiva('730');
  const { token } = await m.gestao.criarInstalacao({ guildId: '730', nome: 'PC', criadoPor: '1' });
  assert.equal((await chamar('/fila', { token })).status, 200);
  await m.gestao.desativarGuild({ guildId: '730', por: '1' });
  assert.equal((await chamar('/fila', { token })).status, 403);
  assert.ok(await m.PonteUso.exists({ guildId: '730', acao: 'guild_inativa' }));
});

test('API: token da guild A não enxerga nem edita a fila da guild B', async () => {
  await guildAtiva('740');
  await guildAtiva('741');
  const { token: tokenA } = await m.gestao.criarInstalacao({ guildId: '740', nome: 'A', criadoPor: '1' });
  await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('740', '1'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const { punicao: deB } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('741', '2'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });

  const fila = await chamar('/fila', { token: tokenA });
  assert.equal(fila.status, 200);
  assert.deepEqual(fila.corpo.punicoes.map(p => p.alvos[0].contaId), ['1']);

  const patch = await chamar(`/fila/${deB._id}`, { token: tokenA, metodo: 'PATCH', corpo: { versao: 0, alvos: [{ contaId: '9', cmd: 'ban' }] } });
  assert.equal(patch.status, 409);
  assert.equal((await m.PontePunicao.findById(deB._id).lean()).alvos[0].contaId, '2');
});

test('API: PATCH com versão velha responde 409', async () => {
  await guildAtiva('750');
  const { token } = await m.gestao.criarInstalacao({ guildId: '750', nome: 'PC', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('750', '10'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });

  const alvos = [{ contaId: '10', cmd: 'ban', tempo: 30, motivo: 'DM' }, { contaId: '11', cmd: 'cadeia', tempo: 120, adicionadoNoJogo: true }];
  const ok = await chamar(`/fila/${punicao._id}`, { token, metodo: 'PATCH', corpo: { versao: 0, alvos } });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.punicao.versao, 1);
  assert.equal(ok.corpo.punicao.previa[0].comando, '/tempban 10 30 DM [DC]');

  const velho = await chamar(`/fila/${punicao._id}`, { token, metodo: 'PATCH', corpo: { versao: 0, alvos } });
  assert.equal(velho.status, 409);
});

test('API: dois PCs executando ao mesmo tempo, só um ganha; aplicada fecha a punição', async () => {
  await guildAtiva('760');
  const pc1 = await m.gestao.criarInstalacao({ guildId: '760', nome: 'PC1', criadoPor: '1' });
  const pc2 = await m.gestao.criarInstalacao({ guildId: '760', nome: 'PC2', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('760', '20+21'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });

  const [r1, r2] = await Promise.all([
    chamar(`/fila/${punicao._id}/executar`, { token: pc1.token, hwid: HWID_A, metodo: 'POST', corpo: { versao: 0 } }),
    chamar(`/fila/${punicao._id}/executar`, { token: pc2.token, hwid: HWID_B, metodo: 'POST', corpo: { versao: 0 } })
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);

  const vencedor = r1.status === 200 ? pc1 : pc2;
  const hwid = r1.status === 200 ? HWID_A : HWID_B;
  const [alvo1, alvo2] = (await m.PontePunicao.findById(punicao._id).lean()).alvos;

  // Um alvo offline: volta para a fila só com ele.
  const parcial = await chamar(`/fila/${punicao._id}/aplicada`, {
    token: vencedor.token, hwid, metodo: 'POST',
    corpo: { manterPendentes: true, resultado: [{ alvoId: alvo1._id, comando: '/prender 20 0 x', ok: true }, { alvoId: alvo2._id, ok: false, erro: 'offline' }] }
  });
  assert.equal(parcial.status, 200);
  assert.equal(parcial.corpo.status, 'aceita');
  assert.equal(parcial.corpo.pendentes, 1);
  const depois = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(depois.alvos.find(a => a.contaId === '20').removido, true);
  assert.equal(depois.alvos.find(a => a.contaId === '21').removido, false);

  await chamar(`/fila/${punicao._id}/executar`, { token: vencedor.token, hwid, metodo: 'POST', corpo: { versao: depois.versao } });
  const final = await chamar(`/fila/${punicao._id}/aplicada`, {
    token: vencedor.token, hwid, metodo: 'POST', corpo: { resultado: [{ alvoId: alvo2._id, comando: '/prender 21 0 x', ok: true }] }
  });
  assert.equal(final.corpo.status, 'aplicada');
  assert.equal(await m.PonteUso.countDocuments({ punicaoId: punicao._id, acao: 'aplicar' }), 2);
});

test('API: execução presa há mais de 10 minutos volta para a fila', async () => {
  await guildAtiva('770');
  const { token } = await m.gestao.criarInstalacao({ guildId: '770', nome: 'PC', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('770', '30'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { status: 'executando', executandoDesde: new Date(Date.now() - 11 * 60 * 1000) } });
  const fila = await chamar('/fila', { token });
  assert.equal(fila.corpo.punicoes.length, 1);
});

test('API: token usado em outro PC (HWID diferente) bloqueia a instalação', async () => {
  await guildAtiva('780');
  const { token, instalacao } = await m.gestao.criarInstalacao({ guildId: '780', nome: 'PC', criadoPor: '1' });
  assert.equal((await chamar('/ping', { token, hwid: HWID_A, metodo: 'POST', corpo: { versao: '1.0.0' } })).status, 200);
  assert.equal((await chamar('/fila', { token, hwid: HWID_B })).status, 403);
  assert.equal((await m.PonteInstalacao.findById(instalacao._id).lean()).status, 'bloqueada');
  assert.equal((await chamar('/fila', { token, hwid: HWID_A })).status, 401);

  // Renovar libera o próximo PC.
  const renovado = await m.gestao.renovarInstalacao({ guildId: '780', id: instalacao._id });
  assert.equal((await chamar('/fila', { token: renovado.token, hwid: HWID_B })).status, 200);
});

test('dois motivos somam tempo e avisos; permanente e banimento prevalecem', () => {
  const c = validacao.classificarMotivo;
  assert.deepEqual([c('SAAV+RUSH').tempo, c('SAAV+RUSH').avisos], [6, 2]);
  assert.deepEqual([c('DM + MIX').cmd, c('DM + MIX').tempo], ['ban', 5]);
  assert.deepEqual([c('MIX e CJ').cmd, c('MIX e CJ').tempo], ['cadeia', 240]);
  assert.equal(c('venda de conta + dm').tempo, 0);
  assert.equal(c('money farm (MF)').tempo, 30); // sinônimos não somam duas vezes
});

test('API: histórico mostra o aplicado e só um PC consegue retirar', async () => {
  await guildAtiva('790');
  const pc1 = await m.gestao.criarInstalacao({ guildId: '790', nome: 'PC1', criadoPor: '1' });
  const pc2 = await m.gestao.criarInstalacao({ guildId: '790', nome: 'PC2', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('790', '40'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const alvo = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];

  await chamar(`/fila/${punicao._id}/executar`, { token: pc1.token, hwid: HWID_A, metodo: 'POST', corpo: { versao: 0 } });
  await chamar(`/fila/${punicao._id}/aplicada`, {
    token: pc1.token, hwid: HWID_A, metodo: 'POST',
    corpo: { resultado: [{ alvoId: alvo._id, comando: '/tempban 40 5 DM [DC]', ok: true, nome: 'Fulano_Tal', organizacao: 'PM' }] }
  });

  const hist = await chamar('/historico', { token: pc2.token, hwid: HWID_B });
  assert.equal(hist.status, 200);
  assert.equal(hist.corpo.itens[0].nome, 'Fulano_Tal');
  assert.equal(hist.corpo.itens[0].pc, 'PC1');

  const caminho = `/historico/${punicao._id}/${alvo._id}/retirar`;
  const [r1, r2] = await Promise.all([
    chamar(caminho, { token: pc1.token, hwid: HWID_A, metodo: 'POST', corpo: {} }),
    chamar(caminho, { token: pc2.token, hwid: HWID_B, metodo: 'POST', corpo: {} })
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal((r1.status === 200 ? r1 : r2).corpo.alvo.contaId, '40');
});

test('API: o jogo registra motivo novo na tabela global (só acrescenta)', async () => {
  await guildAtiva('810');
  const { token } = await m.gestao.criarInstalacao({ guildId: '810', nome: 'PC', criadoPor: '1' });
  const motivos = require('../services/ponteSamp/motivos');
  const antes = (await motivos.obterTabela()).tabela.length;

  const ok = await chamar('/motivos', { token, metodo: 'POST', corpo: { nome: 'flood de som', sinonimos: ['som alto'], cmd: 'cadeia', tempo: 45, avisos: 0 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.total, antes + 1);
  const tabela = (await motivos.obterTabela()).tabela;
  const novo = tabela.find(t => t.nome === 'FLOOD DE SOM');
  assert.deepEqual([novo.cmd, novo.tempo, novo.avisos], ['cadeia', 45, 0]);
  assert.ok(novo.sinonimos.includes('SOM ALTO'));
  assert.ok(tabela.some(t => t.nome === 'DM'), 'os motivos que já existiam continuam');

  // repetido, tipo inválido e sem token: recusados
  assert.equal((await chamar('/motivos', { token, metodo: 'POST', corpo: { nome: 'Flood de som', cmd: 'ban', tempo: 1 } })).status, 400);
  assert.equal((await chamar('/motivos', { token, metodo: 'POST', corpo: { nome: 'x y', cmd: 'kick', tempo: 1 } })).status, 400);
  assert.equal((await chamar('/motivos', { metodo: 'POST', corpo: { nome: 'abc', cmd: 'ban', tempo: 1 } })).status, 401);

  await motivos.salvarTabela([], 'teste'); // volta ao padrão para não afetar os outros testes
});

test('API: tirar da fila e tabela de motivos própria da guild', async () => {
  await guildAtiva('800');
  const { token } = await m.gestao.criarInstalacao({ guildId: '800', nome: 'PC', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('800', '50'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });

  assert.equal((await chamar(`/fila/${punicao._id}/remover`, { token, metodo: 'POST', corpo: {} })).status, 200);
  assert.equal((await chamar('/fila', { token })).corpo.punicoes.length, 0);
  assert.equal((await chamar(`/fila/${punicao._id}/remover`, { token, metodo: 'POST', corpo: {} })).status, 409);

  // Limpar a fila inteira: só os ids enviados e só os da própria guild.
  const a = (await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('800', '51'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } })).punicao;
  const b = (await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('800', '52'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } })).punicao;
  const c = (await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('800', '53'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } })).punicao;
  assert.equal((await chamar('/fila/limpar', { token, metodo: 'POST', corpo: { ids: [] } })).status, 400);
  const limpou = await chamar('/fila/limpar', { token, metodo: 'POST', corpo: { ids: [a._id, b._id, punicao._id] } });
  assert.equal(limpou.status, 200);
  assert.equal(limpou.corpo.removidas, 2);
  assert.deepEqual((await chamar('/fila', { token })).corpo.punicoes.map(p => p.id), [String(c._id)]);
  await chamar(`/fila/${c._id}/remover`, { token, metodo: 'POST', corpo: {} });

  // DM passa a ser cadeia de 60 min sem aviso; motivo novo "ANTI RP" com 2 dias.
  const tabela = [
    { nome: 'DM', cmd: 'cadeia', tempo: 60, avisos: 0 },
    { nome: 'anti rp', sinonimos: ['antirp'], cmd: 'ban', tempo: 2, avisos: 1 }
  ];
  const motivos = require('../services/ponteSamp/motivos');
  const salvo = await motivos.salvarTabela(tabela, 'teste');
  assert.equal(salvo.tabela[1].nome, 'ANTI RP');
  assert.ok((await motivos.salvarTabela([{ nome: 'X', cmd: 'kick', tempo: 1 }], 'teste')).erro);
  // O jogo não altera a tabela (só lê): a rota não existe mais.
  assert.equal((await chamar('/regras', { token, metodo: 'PUT', corpo: { tabela } })).status, 404);

  const { punicao: nova } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('800', '51'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const alvo = (await m.PontePunicao.findById(nova._id).lean()).alvos[0];
  assert.deepEqual([alvo.cmd, alvo.tempo, alvo.avisos], ['cadeia', 60, 0]);

  // Lista vazia volta para a tabela padrão.
  const padrao = await motivos.salvarTabela([], 'teste');
  assert.equal(padrao.propria, false);
});

test('toda punição aplicada vai para o Log Admin; organização marca o responsável', async () => {
  const Config = require('../models/Config');
  const { avisarAplicadas, temOrganizacao } = require('../services/ponteSamp/avisoOrganizacao');
  await Config.create({ guildId: '810', channels: { log: '555' }, roles: { responsavel_admin: '777' } });
  const enviados = [];
  const client = { channels: { fetch: async (id) => (id === '555' ? { send: async (msg) => enviados.push(msg) } : null) } };
  const alvoId = new mongoose.Types.ObjectId();
  const punicao = { guildId: '810', msgDiscord: { link: 'https://discord.com/channels/810/1' }, alvos: [{ _id: alvoId, contaId: '472860' }] };

  const total = await avisarAplicadas(client, punicao, [
    { alvoId, ok: true, erro: '', comando: '/tempban 472860 5 DM [DC]', nome: 'Fulano_Tal', discord: 'fulano.dc', organizacao: 'Policia Militar' },
    { alvoId, ok: true, erro: '', comando: '/tempban 1 5 DM [DC]', nome: 'Civil_Um', organizacao: 'Nenhuma' }
  ], 'PC1');

  assert.equal(total, 2);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].content, '<@&777>');
  assert.equal(enviados[1].content, undefined); // sem organização: registra sem marcar
  const campos = enviados[0].embeds[0].toJSON().fields.map(f => f.value).join(' ');
  assert.match(campos, /Policia Militar/);
  assert.match(campos, /Fulano_Tal/);
  assert.match(campos, /fulano\.dc/);
  assert.match(campos, /472860/);
  assert.match(campos, /discord\.com\/channels\/810\/1/);
  assert.equal(temOrganizacao('civil'), false);

  // Cargo 6 a 12: "Organização - cargo", marca o responsável e quem aceitou na Cadeia Staff.
  enviados.length = 0;
  const comCargo = { ...punicao, origem: 'topico', aceitoPor: { id: '11' }, cadeiaStaffPor: { id: '22' } };
  await avisarAplicadas(client, comCargo, [
    { alvoId, ok: true, erro: '', comando: '/tempban 1 5 DM [DC]', nome: 'Lider', organizacao: 'equipe angola (lider - 12)' },
    { alvoId, ok: true, erro: '', comando: '/tempban 1 5 DM [DC]', nome: 'Membro', organizacao: 'Tropa da Holanda ( Membro - 4)' }
  ], 'PC1');
  assert.equal(enviados[0].content, '<@&777> <@22>');
  assert.deepEqual(enviados[0].allowedMentions, { roles: ['777'], users: ['22'] });
  assert.match(enviados[0].embeds[0].toJSON().fields.map(f => f.value).join(' '), /equipe angola - 12/);
  assert.equal(enviados[1].content, undefined); // cargo 4: registra sem marcar
  assert.match(enviados[1].embeds[0].toJSON().fields[0].value, /^Tropa da Holanda - 4$/);
});

test('API: nova denúncia da mesma conta traz o ban anterior para somar e marca o antigo como somado', async () => {
  await guildAtiva('820');
  const { token } = await m.gestao.criarInstalacao({ guildId: '820', nome: 'PC', criadoPor: '1' });
  const staff = { id: '1', nome: 'x' };
  const den1 = { ...denunciaFalsa('820', '60'), motivoAceite: 'SAAV' };
  const { punicao: p1 } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: den1, origem: 'canal_staff', staff });
  const alvo1 = (await m.PontePunicao.findById(p1._id).lean()).alvos[0];
  await chamar(`/fila/${p1._id}/executar`, { token, metodo: 'POST', corpo: { versao: 0 } });
  await chamar(`/fila/${p1._id}/aplicada`, { token, metodo: 'POST', corpo: { resultado: [{ alvoId: alvo1._id, comando: '/tempban 60 3 SAAV [DC]', ok: true }] } });

  const den2 = { ...denunciaFalsa('820', '60'), motivoAceite: 'SAAV' };
  const { punicao: p2 } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: den2, origem: 'canal_staff', staff });
  const fila = await chamar('/fila', { token });
  const anterior = fila.corpo.punicoes[0].alvos[0].anterior;
  assert.deepEqual([anterior.tempo, anterior.motivo, anterior.punicaoId], [3, 'SAAV', String(p1._id)]);

  const alvo2 = (await m.PontePunicao.findById(p2._id).lean()).alvos[0];
  await chamar(`/fila/${p2._id}/executar`, { token, metodo: 'POST', corpo: { versao: 0 } });
  await chamar(`/fila/${p2._id}/aplicada`, {
    token, metodo: 'POST',
    corpo: { resultado: [{ alvoId: alvo2._id, comando: '/tempban 60 6 SAAV + SAAV [DC]', ok: true, acumulouDe: { punicaoId: p1._id, alvoId: alvo1._id } }] }
  });
  const antigo = (await m.PontePunicao.findById(p1._id).lean()).resultado[0];
  assert.match(antigo.retiradaPor, /somado/);

  // A próxima denúncia soma a partir do total (6), não do ban antigo.
  await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('820', '60'), motivoAceite: 'RUSH' }, origem: 'canal_staff', staff });
  const fila3 = await chamar('/fila', { token });
  assert.equal(fila3.corpo.punicoes[0].alvos[0].anterior.tempo, 6);
});

test('motivo fora da tabela avisa na Cadeia Staff e o Aplicado substitui o aviso', async () => {
  await guildAtiva('830');
  const msg = { content: 'Denúncia aceita ||12/10|| por @x' };
  msg.edit = async ({ content }) => { msg.content = content; };
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => msg } }) } };
  const den = { ...denunciaFalsa('830', '70'), motivoAceite: 'motivo inventado' };
  const { punicao } = await m.aceite.registrarAceite({ client, denuncia: den, origem: 'canal_staff', staff: { id: '1', nome: 'x' }, canalMensagem: { id: 'm1', channelId: 'c1' } });
  assert.equal(punicao.alvos[0].regra, '');
  assert.match(msg.content, /Motivo fora da tabela: aguardando no painel/);
  await m.aceite.atualizarMensagensDiscord(client, punicao, '➱ Aplicado (painel: PC)');
  assert.doesNotMatch(msg.content, /aguardando/);
  assert.match(msg.content, /➱ Aplicado \(painel: PC\)/);
});

test('tirada da fila: só some o "aguardando no painel" da Cadeia Staff, sem texto no lugar', async () => {
  await guildAtiva('835');
  const msg = { content: 'Denúncia aceita ||12/10|| por @x' };
  msg.edit = async ({ content }) => { msg.content = content; };
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => msg } }) } };
  const den = { ...denunciaFalsa('835', '71'), motivoAceite: 'motivo inventado' };
  const { punicao } = await m.aceite.registrarAceite({ client, denuncia: den, origem: 'canal_staff', staff: { id: '1', nome: 'x' }, canalMensagem: { id: 'm1', channelId: 'c1' } });
  assert.match(msg.content, /aguardando no painel/);
  await m.aceite.limparAguardando(client, punicao);
  assert.equal(msg.content, 'Denúncia aceita ||12/10|| por @x');
  // sem o aviso na mensagem: não edita nada
  msg.edit = async () => { throw new Error('não devia editar'); };
  await m.aceite.limparAguardando(client, punicao);
});

test('acusado só pelo nick: o jogo descobre o ID; se não achar, fica pausado e avisa o Log Admin', async () => {
  const Config = require('../models/Config');
  await guildAtiva('840');
  await Config.create({ guildId: '840', channels: { log: '901' }, roles: { responsavel_admin: '902' } });
  const { token } = await m.gestao.criarInstalacao({ guildId: '840', nome: 'PC', criadoPor: '1' });
  const den = { ...denunciaFalsa('840', 'Fulano_Tal+472860'), motivoAceite: 'DM' };
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: den, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const [porNick, porId] = (await m.PontePunicao.findById(punicao._id).lean()).alvos;
  assert.deepEqual([porNick.contaId, porNick.nick], ['', 'Fulano_Tal']);
  assert.equal(porId.contaId, '472860');

  // Primeira tentativa: nick não encontrado -> pausado na fila
  await chamar(`/fila/${punicao._id}/executar`, { token, metodo: 'POST', corpo: { versao: 0 } });
  const r1 = await chamar(`/fila/${punicao._id}/aplicada`, {
    token, metodo: 'POST',
    corpo: { manterPendentes: true, resultado: [
      { alvoId: porNick._id, ok: false, erro: 'nick nao encontrado', nome: 'Fulano_Tal' },
      { alvoId: porId._id, ok: true, comando: '/tempban 472860 5 DM [DC]' }
    ] }
  });
  assert.equal(r1.corpo.status, 'aceita');

  // Segunda: o jogo achou o ID pelo /vercontanick
  const versao = (await m.PontePunicao.findById(punicao._id).lean()).versao;
  await chamar(`/fila/${punicao._id}/executar`, { token, metodo: 'POST', corpo: { versao } });
  const r2 = await chamar(`/fila/${punicao._id}/aplicada`, {
    token, metodo: 'POST', corpo: { resultado: [{ alvoId: porNick._id, ok: true, contaId: '555123', comando: '/tempban 555123 5 DM [DC]' }] }
  });
  assert.equal(r2.corpo.status, 'aplicada');
  const final = await m.PontePunicao.findById(punicao._id).lean();
  assert.equal(final.alvos.find(a => a.nick === 'Fulano_Tal').contaId, '555123');

  // Aviso do nick não encontrado no Log Admin, marcando o responsável
  const { avisarNicksNaoEncontrados } = require('../services/ponteSamp/avisoOrganizacao');
  const enviados = [];
  const client = { channels: { fetch: async (id) => (id === '901' ? { send: async (msg) => enviados.push(msg) } : null) } };
  await avisarNicksNaoEncontrados(client, final, [{ alvoId: porNick._id, erro: 'nick nao encontrado' }], 'PC');
  assert.equal(enviados[0].content, '<@&902>');
  assert.match(enviados[0].embeds[0].toJSON().description, /Fulano_Tal/);
});

test('motivo por acusado: quem fez o quê entre parênteses recebe a própria punição', () => {
  const den = { acusadoId: '1267697 + 1200445+1263958+1185367', motivoAceite: 'RUSH+Saav (1267697) + RUSH (1200445+1263958+1185367)' };
  const alvos = m.aceite.montarAlvos(den);
  assert.deepEqual(alvos.map(a => [a.contaId, a.tempo, a.avisos]), [
    ['1267697', 6, 2], ['1200445', 3, 1], ['1263958', 3, 1], ['1185367', 3, 1]
  ]);
  assert.equal(alvos[0].motivo, 'RUSH+Saav');
  // Sem parênteses: o motivo inteiro vale para todos.
  assert.deepEqual(m.aceite.montarAlvos({ acusadoId: '1+2', motivoAceite: 'DM' }).map(a => a.tempo), [5, 5]);

  // Sem parênteses, partes com "/": cada conta leva só o motivo da sua parte.
  const porParte = (acusadoId, motivoAceite) => m.aceite.montarAlvos({ acusadoId, motivoAceite }).map(a => [a.contaId, a.motivo]);
  assert.deepEqual(porParte('517416 + 520817', 'Dm 517416 / 520817 Kos'), [['517416', 'Dm'], ['520817', 'Kos']]);
  assert.deepEqual(porParte('10+20+30', 'RUSH+Saav 10 / KOS 20 e 30'), [['10', 'RUSH+Saav'], ['20', 'KOS'], ['30', 'KOS']]);
  // Motivo separado por conta e conta não citada: fica sem motivo e sem regra (staff decide no painel).
  assert.deepEqual(porParte('10+20', 'DM 10 / sem id aqui'), [['10', 'DM'], ['20', '']]);
  // Cada parênteses com o ID e o motivo, em qualquer ordem dentro dele.
  assert.deepEqual(m.aceite.montarAlvos({ acusadoId: '1223199 + 5050', motivoAceite: '(rush 1223199) + (5050 flaming))' })
    .map(a => [a.contaId, a.motivo, a.cmd, a.tempo, a.avisos, a.regra]), [
    ['1223199', 'rush', 'ban', 3, 1, 'RUSH: Banimento de 3 dias + 1 aviso'], ['5050', 'flaming', 'ban', 1, 1, '']
  ]);
  const real = m.aceite.montarAlvos({ acusadoId: '1267697+1200445+1263958+1185367', motivoAceite: 'RUSH+Saav (1267697) + RUSH (1185367)' });
  assert.deepEqual(real.map(a => [a.contaId, a.motivo, a.tempo, Boolean(a.regra)]), [
    ['1267697', 'RUSH+Saav', 6, true], ['1200445', '', 1, false], ['1263958', '', 1, false], ['1185367', 'RUSH', 3, true]
  ]);
  // Texto corrido citando só um: não separa, vale inteiro para os dois.
  const corrido = 'VDM, Rush + Saav de ambos e Slide do 1267835';
  assert.deepEqual(porParte('1267835+1267834', corrido).map(a => a[1]), [corrido, corrido]);
  // ID com o motivo entre parênteses, colado ou não, e parênteses sem fechar.
  assert.deepEqual(porParte('1921', '1921(saav rush)'), [['1921', 'saav rush']]);
  assert.deepEqual(porParte('1921+1922', '1921(saav rush) 1922(dm)'), [['1921', 'saav rush'], ['1922', 'dm']]);
  assert.deepEqual(porParte('1921+1922', '(1921 saav rush) (1922 dm'), [['1921', 'saav rush'], ['1922', 'dm']]);
  assert.deepEqual(porParte('1921+1922', '(1921 saav rush / 1922 dm'), [['1921', 'saav rush'], ['1922', 'dm']]);
  // Tudo corrido: cada ID leva o que vem depois dele até o próximo ID.
  assert.deepEqual(porParte('1039+1921', '1039 saav + rush + 1921 +saav'), [['1039', 'saav + rush'], ['1921', 'saav']]);
  assert.deepEqual(porParte('1039+1921+1922', '1039 saav 1921 + 1922 rush'), [['1039', 'saav'], ['1921', 'rush'], ['1922', 'rush']]);
  assert.deepEqual(porParte('10+20', 'DM 10 + 20'), [['10', 'DM'], ['20', 'DM']]);
});

test('conta que já estava banida sai da fila e vai para o Relatório de punições', async () => {
  const Config = require('../models/Config');
  const { avisarJaBanidos } = require('../services/ponteSamp/avisoOrganizacao');
  await guildAtiva('850');
  await Config.create({ guildId: '850', channels: { log: '951', relatorioPunicoes: '952' }, roles: { responsavel_admin: '953' } });
  const { token } = await m.gestao.criarInstalacao({ guildId: '850', nome: 'PC', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('850', '80'), motivoAceite: 'DM' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const alvo = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];
  await chamar(`/fila/${punicao._id}/executar`, { token, metodo: 'POST', corpo: { versao: 0 } });
  const r = await chamar(`/fila/${punicao._id}/aplicada`, {
    token, metodo: 'POST',
    corpo: { resultado: [{ alvoId: alvo._id, ok: true, erro: 'ja estava banido', comando: '/tempban 80 5 DM [DC]', resposta: 'Esse jogador ja esta banido.' }] }
  });
  assert.equal(r.corpo.status, 'aplicada'); // saiu da fila

  const enviados = [];
  const client = { channels: { fetch: async (id) => ({ send: async (msg) => enviados.push({ id, msg }) }) } };
  const doc = await m.PontePunicao.findById(punicao._id).lean();
  await avisarJaBanidos(client, doc, doc.resultado, 'PC');
  assert.equal(enviados[0].id, '952');
  assert.match(enviados[0].msg.embeds[0].toJSON().title, /Já estava banido/);
});

test('permanente usa /blackban no nick da conta', () => {
  const t = validacao.templatesEfetivos({});
  assert.equal(t.blackban, '/blackban {nick} {motivo}');
  assert.equal(validacao.templateValido(t.blackban), true);
  assert.equal(validacao.montarComando(t.blackban, { contaId: '1', nick: 'CVARTUR', motivo: 'VENDA DE CONTA' }, 'ban'), '/blackban CVARTUR VENDA DE CONTA [DC]');
  assert.equal(validacao.montarComando(t.blackban, { contaId: '1', nick: '', motivo: 'X' }, 'ban'), null); // sem nick, não monta
});

test('tabela de motivos é a mesma para todos os servidores e o texto do Discord vai e volta', async () => {
  const motivos = require('../services/ponteSamp/motivos');
  const { lista, erro } = motivos.textoParaTabela('DM|DEATHMATCH = cadeia 30 0\nPK = ban 2 1');
  assert.equal(erro, undefined);
  assert.equal((await motivos.salvarTabela(lista, 'teste')).propria, true);

  // Duas guilds diferentes usam a mesma tabela
  for (const guildId of ['860', '861']) {
    await guildAtiva(guildId);
    const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa(guildId, '90'), motivoAceite: 'deathmatch' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
    const alvo = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];
    assert.deepEqual([alvo.cmd, alvo.tempo], ['cadeia', 30]);
  }
  assert.match(motivos.textoParaTabela('DM = kick 1 1').erro, /Linha 1/);
  assert.equal((await motivos.salvarTabela([], 'teste')).propria, false); // volta ao padrão
});

test('ao ligar, a ponte copia do banco principal para o secundário só o que estiver vazio lá', async () => {
  const { migrarPonteParaSecundario } = require('../services/ponteSamp/migracao');
  const cliente = mongo.conexao.getClient();
  const principal = cliente.db('mig_principal');
  const secundario = cliente.db('mig_secundario');
  await principal.collection('ponteservidores').insertOne({ guildId: '900', ativo: true });
  await principal.collection('ponteinstalacoes').insertMany([{ tokenHash: 'a' }, { tokenHash: 'b' }]);
  await secundario.collection('ponteinstalacoes').insertOne({ tokenHash: 'ja-estava' }); // não sobrescreve

  const copiadas = await migrarPonteParaSecundario(principal, secundario);
  assert.deepEqual(copiadas, { ponteservidores: 1 });
  assert.equal(await secundario.collection('ponteservidores').countDocuments(), 1);
  assert.equal(await secundario.collection('ponteinstalacoes').countDocuments(), 1);
  assert.equal(await principal.collection('ponteservidores').countDocuments(), 1); // nada apagado
  assert.deepEqual(await migrarPonteParaSecundario(principal, secundario), {}); // segunda vez não copia de novo
});

test('motivo cadastrado depois do aceite: a fila reclassifica sozinha na próxima atualização', async () => {
  const motivos = require('../services/ponteSamp/motivos');
  await guildAtiva('870');
  const { token } = await m.gestao.criarInstalacao({ guildId: '870', nome: 'PC', criadoPor: '1' });
  await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('870', '95'), motivoAceite: 'mods proibido' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  let alvo = (await chamar('/fila', { token })).corpo.punicoes[0].alvos[0];
  assert.equal(alvo.regra, ''); // fora da tabela

  const padrao = (await motivos.obterTabela()).tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.slice(1), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos }));
  await motivos.salvarTabela([...padrao, { nome: 'MODS PROIBIDO', cmd: 'ban', tempo: 7, avisos: 1 }], 'teste');

  alvo = (await chamar('/fila', { token })).corpo.punicoes[0].alvos[0];
  assert.deepEqual([alvo.cmd, alvo.tempo, alvo.avisos], ['ban', 7, 1]);
  assert.match(alvo.regra, /MODS PROIBIDO/);
  await motivos.salvarTabela([], 'teste');

  // Salvar a tabela (site ou Discord) já reclassifica e troca o "aguardando" da Cadeia Staff.
  const mensagem = { content: 'Denúncia aceita por X\n➱ Motivo fora da tabela: aguardando no painel', edit: async ({ content }) => { mensagem.content = content; } };
  const client = { channels: { fetch: async (id) => (id === 'cadeia' ? { messages: { fetch: async () => mensagem } } : null) } };
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('870', '96'), motivoAceite: 'flaming' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' },
    canalMensagem: { channelId: 'cadeia', id: 'msg' } });
  assert.equal(punicao.alvos[0].regra, '');
  const salvo = await motivos.salvarTabela([...padrao, { nome: 'FLAMING', cmd: 'cadeia', tempo: 60, avisos: 0 }], 'teste');
  await m.aceite.reclassificarFila({ client, tabela: salvo.tabela });
  const depois = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];
  assert.deepEqual([depois.cmd, depois.tempo], ['cadeia', 60]);
  assert.match(mensagem.content, /liberado no painel/);
  assert.doesNotMatch(mensagem.content, /aguardando/);
  await motivos.salvarTabela([], 'teste');
});

test('API: anotação interna da punição, relatório e versão do mod no ping', async () => {
  await guildAtiva('9820');
  await guildAtiva('9821');
  const { token } = await m.gestao.criarInstalacao({ guildId: '9820', nome: 'PC da Lince', criadoPor: '1' });
  const outra = await m.gestao.criarInstalacao({ guildId: '9821', nome: 'PC outro', criadoPor: '1' });
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('9820', '60'), origem: 'canal_staff', staff: { id: '1', nome: 'Corvo' } });

  const ping = await chamar('/ping', { token, metodo: 'POST', corpo: { versao: '1.7.0' } });
  assert.equal(ping.status, 200);
  assert.match(ping.corpo.versaoMod, /^\d+\.\d+\.\d+$/);

  assert.equal((await chamar('/fila', { token })).corpo.punicoes[0].nota, null);
  const salva = await chamar(`/punicoes/${punicao._id}/nota`, { token, metodo: 'POST', corpo: { texto: '  vi o vídeo:\n reincidente  ' } });
  assert.equal(salva.status, 200);
  assert.equal(salva.corpo.nota.texto, 'vi o vídeo: reincidente');
  assert.equal(salva.corpo.nota.por, 'PC da Lince');
  assert.equal((await chamar('/fila', { token })).corpo.punicoes[0].nota.texto, 'vi o vídeo: reincidente');

  // outra guild não anota nem lê a punição; texto vazio apaga; nota é cortada em 300
  assert.equal((await chamar(`/punicoes/${punicao._id}/nota`, { token: outra.token, metodo: 'POST', corpo: { texto: 'x' } })).status, 404);
  const longa = await chamar(`/punicoes/${punicao._id}/nota`, { token, metodo: 'POST', corpo: { texto: 'a'.repeat(500) } });
  assert.equal(longa.corpo.nota.texto.length, 300);
  assert.equal((await chamar(`/punicoes/${punicao._id}/nota`, { token, metodo: 'POST', corpo: { texto: '' } })).corpo.nota, null);

  const relatorio = await chamar('/relatorio?dias=7', { token });
  assert.equal(relatorio.status, 200);
  assert.equal(relatorio.corpo.dias, 7);
  assert.equal(relatorio.corpo.total.aceitas, 1);
  assert.equal(relatorio.corpo.total.naFila, 1);
  assert.deepEqual(relatorio.corpo.porAceitante, [{ nome: 'Corvo', total: 1 }]);
  assert.equal((await chamar('/relatorio?dias=9999', { token })).corpo.dias, 90);
  assert.equal((await chamar('/relatorio', { metodo: 'GET' })).status, 401);
});

test('relatório: conta por aceitante e por PC e ignora o que é mais velho que o período', () => {
  const { montarRelatorio } = require('../services/ponteSamp/relatorio');
  const agora = Date.parse('2026-10-22T20:00:00Z');
  const h = (n) => new Date(agora - n * 3600 * 1000);
  const lista = [
    { aceitoPor: { nome: 'Lince' }, aceitoEm: h(3), aplicadaEm: h(2), status: 'aplicada',
      resultado: [{ ok: true, erro: '', pc: 'PC1', em: h(2) }, { ok: false, erro: 'nick nao encontrado', pc: 'PC1', em: h(2) }] },
    { aceitoPor: { nome: 'Lince' }, aceitoEm: h(30), aplicadaEm: h(29), status: 'aplicada', resultado: [{ ok: true, erro: '', pc: 'PC2', em: h(29) }] },
    { aceitoPor: { nome: 'Corvo' }, aceitoEm: h(500), aplicadaEm: h(499), status: 'aplicada', resultado: [{ ok: true, erro: '', pc: 'PC3', em: h(499) }] },
    { aceitoPor: { nome: 'Corvo' }, aceitoEm: h(1), status: 'aceita', resultado: [] }
  ];
  const um = montarRelatorio(lista, 1, agora);
  assert.deepEqual(um.total, { aceitas: 2, aplicados: 1, falhas: 1, naFila: 1, esperaMediaMin: 60 });
  const sete = montarRelatorio(lista, 7, agora);
  assert.equal(sete.total.aceitas, 3);
  assert.deepEqual(sete.porAceitante.map(a => [a.nome, a.total]), [['Lince', 2], ['Corvo', 1]]);
  assert.deepEqual(sete.porPc.map(p => [p.pc, p.aplicados, p.falhas]), [['PC1', 1, 1], ['PC2', 1, 0]]);
  assert.equal(montarRelatorio([], 7, agora).total.esperaMediaMin, null);
});

test('punição parada na fila: avisa uma vez e só de novo depois de 2 horas', async () => {
  const { avisarParadas } = require('../services/ponteSamp/paradas');
  await guildAtiva('9830');
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('9830', '70'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  const agora = Date.now();

  assert.equal(await avisarParadas(clienteFalso, agora), 0); // acabou de chegar: não está parada
  await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { aceitoEm: new Date(agora - 45 * 60 * 1000) } });
  await avisarParadas(clienteFalso, agora);
  const marcada = (await m.PontePunicao.findById(punicao._id).lean()).alertaParadaEm;
  assert.ok(marcada, 'ficou marcada como avisada');
  assert.equal(await avisarParadas(clienteFalso, agora + 60 * 1000), 0); // não repete logo em seguida
  await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { alertaParadaEm: new Date(agora - 3 * 3600 * 1000) } });
  await avisarParadas(clienteFalso, agora);
  assert.ok((await m.PontePunicao.findById(punicao._id).lean()).alertaParadaEm > new Date(agora - 60 * 1000), 'avisou de novo depois de 2h');
});
