require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { iniciarMongoMemoria } = require('./helpers/mongoMemoria');
const seguranca = require('../services/ponteSamp/seguranca');
const validacao = require('../services/ponteSamp/validacao');

process.env.PONTE_SAMP_ATIVA = '1';
process.env.OWNER_DISCORD_ID = '900000000000000001';

let mongo;
let m; // models e serviços, carregados depois do Mongo subir

test.before(async () => {
  mongo = await iniciarMongoMemoria();
  m = {
    PontePunicao: require('../models/PontePunicao'),
    PonteServidor: require('../models/PonteServidor'),
    PonteCodigo: require('../models/PonteCodigo'),
    PonteUso: require('../models/PonteUso'),
    gestao: require('../services/ponteSamp/gestao'),
    aceite: require('../services/ponteSamp/aceite')
  };
  // Os índices únicos precisam existir antes dos testes de corrida.
  await Promise.all(['PontePunicao', 'PonteServidor', 'PonteCodigo'].map(nome => m[nome].init()));
});

test.after(async () => {
  await mongo?.parar();
});

const clienteFalso = { channels: { fetch: async () => null } };

async function guildAtiva(guildId) {
  const { codigo } = await m.gestao.criarCodigo({ criadoPor: process.env.OWNER_DISCORD_ID });
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

// ---------- funções puras ----------

test('código de ativação: hash estável, só o final fica visível', () => {
  const codigo = seguranca.gerarCodigo();
  assert.match(codigo, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(seguranca.hashCodigo(codigo), seguranca.hashCodigo(codigo.toLowerCase().replace(/-/g, ' ')));
  assert.equal(seguranca.ultimos4('ABCD-EFGH'), 'EFGH');
});

test('motivo é limpo de quebras, cores, barra inicial e cortado em 60', () => {
  assert.equal(validacao.limparMotivo('/kick\r\n{FF0000}DM   x'), 'kick FF0000 DM x');
  assert.equal(validacao.limparMotivo('a'.repeat(100)).length, 60);
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

test('registrarAceite: aceitar de novo na Cadeia Staff reabre a punição cancelada', async () => {
  await guildAtiva('721');
  const denuncia = denunciaFalsa('721');
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff: { id: '5', nome: 'Staff' } });
  await m.PontePunicao.updateOne({ _id: punicao._id }, { $set: { status: 'cancelada' } });

  // Pelo tópico não reabre: só a Cadeia Staff decide de novo.
  assert.equal((await m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'topico', staff: { id: '6', nome: 'Outro' } })).status, 'cancelada');

  const r = await m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff: { id: '6', nome: 'Outro' } });
  assert.equal(r.reaberta, true);
  const salva = await m.PontePunicao.findById(punicao._id).lean();
  assert.deepEqual([salva.status, salva.aceitoPor.nome, salva.versao > punicao.versao], ['aceita', 'Outro', true]);
  assert.equal(await m.PontePunicao.countDocuments({ denunciaId: denuncia._id }), 1);

  // Já aceita (ou enviada): não reabre nada, só informa.
  const deNovo = await m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff: { id: '6', nome: 'Outro' } });
  assert.deepEqual([deNovo.jaExistia, deNovo.status], [true, 'aceita']);
});

test('registrarAceite não faz nada em guild sem ponte ativa', async () => {
  const r = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: denunciaFalsa('729'), origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  assert.equal(r, null);
});

// ---------- API do jogo ----------

test('dois motivos somam tempo e avisos; permanente e banimento prevalecem', () => {
  const c = validacao.classificarMotivo;
  assert.deepEqual([c('SAAV+RUSH').tempo, c('SAAV+RUSH').avisos], [6, 2]);
  assert.deepEqual([c('DM + MIX').cmd, c('DM + MIX').tempo], ['ban', 5]);
  assert.deepEqual([c('MIX e CJ').cmd, c('MIX e CJ').tempo], ['cadeia', 240]);
  assert.equal(c('venda de conta + dm').tempo, 0);
  assert.equal(c('money farm (MF)').tempo, 30); // sinônimos não somam duas vezes
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
  ], 'gamemode:brp');

  assert.equal(total, 2);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].content, '<@&777>');
  assert.equal(enviados[1].content, undefined); // sem organização: registra sem marcar
  const embed0 = enviados[0].embeds[0].toJSON();
  const campos = `${embed0.description} ${embed0.fields.map(f => f.value).join(' ')}`;
  assert.match(campos, /Policia Militar/);
  assert.match(campos, /Fulano_Tal/);
  assert.match(campos, /fulano\.dc/);
  assert.match(campos, /472860/);
  assert.match(campos, /discord\.com\/channels\/810\/1/);
  assert.equal(temOrganizacao('civil'), false);
  const { cargoLegivel } = require('../services/ponteSamp/avisoOrganizacao');
  assert.deepEqual(['U$ BEN$A (Gerente - 10)', 'Org (Cargo:[ lider - 12])', 'Org', 'U$ BEN$A [10]'].map(cargoLegivel),
    ['Gerente (10)', 'lider (12)', 'Não informado', '10']);

  // Cargo 6 a 12: "Organização - cargo", marca o responsável e quem aceitou na Cadeia Staff.
  enviados.length = 0;
  const comCargo = { ...punicao, origem: 'topico', aceitoPor: { id: '11' }, cadeiaStaffPor: { id: '22' } };
  await avisarAplicadas(client, comCargo, [
    { alvoId, ok: true, erro: '', comando: '/tempban 1 5 DM [DC]', nome: 'Lider', organizacao: 'equipe angola (lider - 12)' },
    { alvoId, ok: true, erro: '', comando: '/tempban 1 5 DM [DC]', nome: 'Membro', organizacao: 'Tropa da Holanda ( Membro - 4)' }
  ], 'gamemode:brp');
  assert.equal(enviados[0].content, '<@&777> <@22>');
  assert.deepEqual(enviados[0].allowedMentions, { roles: ['777'], users: ['22'] });
  const lider = enviados[0].embeds[0].toJSON().fields;
  assert.equal(lider.find(f => f.name === '🏢 Organização').value, 'equipe angola');
  assert.equal(lider.some(f => f.name.includes('Cargo')), false, 'o embed não tem campo de cargo');
  assert.equal(enviados[1].content, undefined); // cargo 4: registra sem marcar
  const membro = enviados[1].embeds[0].toJSON().fields;
  assert.equal(membro.find(f => f.name === '🏢 Organização').value, 'Tropa da Holanda');
  assert.equal(enviados[0].embeds[0].toJSON().title, enviados[1].embeds[0].toJSON().title, 'com ou sem organização, o mesmo embed');

  // Gamemode: cargo entre colchetes, punição legível, motivo e quem aplicou no rodapé.
  enviados.length = 0;
  const daGm = { ...punicao, alvos: [{ _id: alvoId, contaId: '1964972', cmd: 'ban', tempo: 3, avisos: 1, motivo: 'saav' }], aceitoPor: { id: '33', nome: 'Foxy' } };
  await avisarAplicadas(client, daGm, [
    { alvoId, ok: true, erro: '', comando: 'gamemode: ban 3d +1 aviso', nome: 'Couto', organizacao: 'U$ BEN$A [10]' }
  ], 'gamemode:brp teste');
  const gm = enviados[0].embeds[0].toJSON();
  const campo = (nome) => gm.fields.find(f => f.name.includes(nome))?.value;
  assert.equal(campo('Organização'), 'U$ BEN$A');
  assert.equal(campo('Cargo'), undefined);
  assert.match(gm.description, /Punição:\*\* Ban de 3 dias \+ 1 aviso/);
  assert.match(gm.title, /Banimento aplicado/);
  assert.equal(campo('Motivo'), 'saav');
  assert.equal(campo('Aceita'), '<@33>');
  assert.match(gm.description, /Couto.*1964972/);
  assert.match(gm.footer.text, /^🎮 Aplicada por Gamemode · brp teste · Punição #/);
  assert.equal(gm.thumbnail, undefined, 'sem foto');
  assert.equal(campo('Comando'), undefined);

  assert.equal(enviados[0].content, '<@&777>'); // cargo 10: marca o responsável
});

test('motivo fora da tabela avisa na Cadeia Staff e o Aplicado substitui o aviso', async () => {
  await guildAtiva('830');
  const msg = { content: 'Denúncia aceita ||12/10|| por @x' };
  msg.edit = async ({ content }) => { msg.content = content; };
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => msg } }) } };
  const den = { ...denunciaFalsa('830', '70'), motivoAceite: 'motivo inventado' };
  const { punicao } = await m.aceite.registrarAceite({ client, denuncia: den, origem: 'canal_staff', staff: { id: '1', nome: 'x' }, canalMensagem: { id: 'm1', channelId: 'c1' } });
  assert.equal(punicao.alvos[0].regra, '');
  assert.match(msg.content, /Motivo fora da tabela: aguardando correção/);
  await m.aceite.atualizarMensagensDiscord(client, punicao, '➱ Aplicado (painel: PC)');
  assert.doesNotMatch(msg.content, /aguardando/);
  assert.match(msg.content, /➱ Aplicado \(painel: PC\)/);
});

test('tirada da fila: só some o "aguardando correção" da Cadeia Staff, sem texto no lugar', async () => {
  await guildAtiva('835');
  const msg = { content: 'Denúncia aceita ||12/10|| por @x' };
  msg.edit = async ({ content }) => { msg.content = content; };
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => msg } }) } };
  const den = { ...denunciaFalsa('835', '71'), motivoAceite: 'motivo inventado' };
  const { punicao } = await m.aceite.registrarAceite({ client, denuncia: den, origem: 'canal_staff', staff: { id: '1', nome: 'x' }, canalMensagem: { id: 'm1', channelId: 'c1' } });
  assert.match(msg.content, /aguardando correção/);
  await m.aceite.limparAguardando(client, punicao);
  assert.equal(msg.content, 'Denúncia aceita ||12/10|| por @x');
  // sem o aviso na mensagem: não edita nada
  msg.edit = async () => { throw new Error('não devia editar'); };
  await m.aceite.limparAguardando(client, punicao);
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

test('motivo cadastrado depois do aceite: salvar a tabela reclassifica a fila', async () => {
  const motivos = require('../services/ponteSamp/motivos');
  await guildAtiva('870');
  const { punicao: fora } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('870', '95'), motivoAceite: 'mods proibido' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  assert.equal(fora.alvos[0].regra, ''); // fora da tabela

  const padrao = (await motivos.obterTabela()).tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.slice(1), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos }));
  const comMods = await motivos.salvarTabela([...padrao, { nome: 'MODS PROIBIDO', cmd: 'ban', tempo: 7, avisos: 1 }], 'teste');
  await m.aceite.reclassificarFila({ tabela: comMods.tabela });
  const alvo = (await m.PontePunicao.findById(fora._id).lean()).alvos[0];
  assert.deepEqual([alvo.cmd, alvo.tempo, alvo.avisos], ['ban', 7, 1]);
  assert.match(alvo.regra, /MODS PROIBIDO/);
  await motivos.salvarTabela([], 'teste');

  // Salvar a tabela (site ou Discord) já reclassifica e troca o "aguardando" da Cadeia Staff
  // (também o texto antigo, do tempo do PC da staff).
  const mensagem = { content: 'Denúncia aceita por X\n➱ Motivo fora da tabela: aguardando no painel', edit: async ({ content }) => { mensagem.content = content; } };
  const client = { channels: { fetch: async (id) => (id === 'cadeia' ? { messages: { fetch: async () => mensagem } } : null) } };
  const { punicao } = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('870', '96'), motivoAceite: 'flaming' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' },
    canalMensagem: { channelId: 'cadeia', id: 'msg' } });
  assert.equal(punicao.alvos[0].regra, '');
  const salvo = await motivos.salvarTabela([...padrao, { nome: 'FLAMING', cmd: 'cadeia', tempo: 60, avisos: 0 }], 'teste');
  await m.aceite.reclassificarFila({ client, tabela: salvo.tabela });
  const depois = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];
  assert.deepEqual([depois.cmd, depois.tempo], ['cadeia', 60]);
  assert.match(mensagem.content, /liberado para enviar ao jogo/);
  assert.doesNotMatch(mensagem.content, /aguardando/);

  // Motivo da tabela que muda de punição: quem espera envio passa à punição nova;
  // quem foi editado à mão fica como está.
  const mudada = await motivos.salvarTabela([...padrao, { nome: 'FLAMING', cmd: 'ban', tempo: 1, avisos: 3 }], 'teste');
  const manual = await m.aceite.registrarAceite({ client: clienteFalso, denuncia: { ...denunciaFalsa('870', '97'), motivoAceite: 'flaming' }, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
  await m.PontePunicao.updateOne({ _id: manual.punicao._id }, { $set: { 'alvos.0.regra': 'editado por Corvo', 'alvos.0.tempo': 5 } });
  await m.aceite.reclassificarFila({ tabela: mudada.tabela });
  const nova = (await m.PontePunicao.findById(punicao._id).lean()).alvos[0];
  assert.deepEqual([nova.cmd, nova.tempo, nova.avisos], ['ban', 1, 3]);
  assert.equal((await m.PontePunicao.findById(manual.punicao._id).lean()).alvos[0].tempo, 5);
  await motivos.salvarTabela([], 'teste');
});

// ---------- limpeza de tópicos ----------

const DIA = 24 * 60 * 60 * 1000;

// Tópico falso que registra o que a limpeza fez com ele.
function topico(id, parentId, dias, nome = `tópico ${id}`) {
  const feito = [];
  return {
    id, name: nome, parentId, createdTimestamp: Date.now() - dias * DIA, archived: false, locked: false, feito,
    isThread: () => true,
    guild: { channels: { cache: new Map() } },
    setLocked: async () => { feito.push('trancou'); },
    setArchived: async () => { feito.push('arquivou'); },
    edit: async () => { feito.push('arquivou-espelho'); }
  };
}

test('limpeza: tópico de 7 dias ou mais em qualquer canal é fechado; nos outros canais só arquiva', async () => {
  const Config = require('../models/Config');
  await Config.create({ guildId: '50000', channels: { pc: 'canal-pc', mobile: 'canal-mobile' } });
  const doCanalDeDenuncia = topico('t1', 'canal-pc', 8);
  const deOutroCanal = topico('t2', 'canal-geral', 10);
  const novoEmOutroCanal = topico('t3', 'canal-geral', 2);
  const denunciaAbertaAntiga = topico('t4', 'canal-pc', 9);
  const denunciaAbertaNova = topico('t5', 'canal-pc', 3);
  const Denuncia = require('../models/Denuncia');
  await Denuncia.collection.insertMany([{ guildId: '50000', threadId: 't4', status: 'pendente' }, { guildId: '50000', threadId: 't5', status: 'pendente' }]);
  const threads = new Map([doCanalDeDenuncia, deOutroCanal, novoEmOutroCanal, denunciaAbertaAntiga, denunciaAbertaNova].map(t => [t.id, t]));
  const guild = { id: '50000', name: 'Servidor', channels: { fetchActiveThreads: async () => ({ threads }), cache: new Map() } };
  const client = { guilds: { cache: new Map([['50000', guild]]) } };

  const { resumoDosTopicos, limparEspelhosAbertos } = require('../utils/espelhos');
  const [resumo] = (await resumoDosTopicos(client, { forcar: true })).servidores;
  assert.deepEqual([resumo.ativos, resumo.antigos, resumo.deOutrosCanais, resumo.deDenuncias], [5, 3, 1, 3]);

  const { fechados, porCanal } = await limparEspelhosAbertos(client, { soAntigos: true });
  assert.equal(fechados, 3);
  assert.deepEqual([porCanal.antigo, porCanal.outro, porCanal.denuncia], [1, 1, 1]);
  assert.deepEqual(doCanalDeDenuncia.feito, ['trancou', 'arquivou'], 'canal de denúncia: tranca e arquiva');
  assert.deepEqual(deOutroCanal.feito, ['arquivou'], 'outro canal: só arquiva, sem trancar');
  assert.deepEqual(novoEmOutroCanal.feito, [], 'mais novo que 7 dias: não mexe');
  assert.deepEqual(denunciaAbertaAntiga.feito, ['trancou', 'arquivou'], 'denúncia aberta com 7 dias ou mais: tranca e arquiva');
  assert.deepEqual(denunciaAbertaNova.feito, [], 'denúncia aberta recente: não mexe');
});

test('punição aplicada sem nick do jogo: usa o nick conhecido da conta', async () => {
  const Config = require('../models/Config');
  const Usuario = require('../models/Usuario');
  const { avisarAplicadas } = require('../services/ponteSamp/avisoOrganizacao');
  await Config.create({ guildId: '811', channels: { log: '556' }, roles: { responsavel_admin: '777' } });
  await Usuario.create({ guildId: '811', userId: '900000000000000099', conta: '1168678', nickname: 'Jesus_Sensaa 1168678' });
  const enviados = [];
  const client = { channels: { fetch: async () => ({ send: async (msg) => enviados.push(msg) }) } };
  const alvoId = new mongoose.Types.ObjectId();
  await avisarAplicadas(client, { guildId: '811', alvos: [{ _id: alvoId, contaId: '1168678', cmd: 'ban', tempo: 6, avisos: 2, motivo: 'RUSH' }] },
    [{ alvoId, ok: true, erro: '', nome: '', organizacao: '' }], 'gamemode:brp');
  assert.match(enviados[0].embeds[0].toJSON().description, /Player:\*\* Jesus_Sensaa \(`1168678`\)\n💬 \*\*Discord:\*\* <@900000000000000099>/);
});

test('punição aplicada: botão "Ver no site" com a página da denúncia', async () => {
  const Config = require('../models/Config');
  const { avisarAplicadas } = require('../services/ponteSamp/avisoOrganizacao');
  await Config.create({ guildId: '812', channels: { relatorioPunicoes: '557' }, roles: {} });
  const enviados = [];
  const client = { channels: { fetch: async () => ({ send: async (msg) => enviados.push(msg) }) } };
  const alvoId = new mongoose.Types.ObjectId();
  const denunciaId = new mongoose.Types.ObjectId();
  const antes = process.env.SITE_URL;
  process.env.SITE_URL = 'https://site.exemplo/';
  try {
    await avisarAplicadas(client, { guildId: '812', denunciaId, mensagens: { topicoPrivado: true, topicoId: '900000000000000001' }, alvos: [{ _id: alvoId, contaId: '1', cmd: 'ban', tempo: 1 }] },
      [{ alvoId, ok: true, erro: '', nome: 'X' }], 'gamemode:brp');
  } finally {
    process.env.SITE_URL = antes;
  }
  const botoes = enviados[0].components[0].toJSON().components;
  assert.equal(botoes.length, 2);
  assert.equal(botoes[1].url, `https://site.exemplo/#/d/${denunciaId}`);
  assert.equal(botoes[1].label, 'Ver no site');
});

test('motivos: quem não é o dono muda e adiciona, mas não apaga, renomeia nem volta ao padrão', async () => {
  const motivos = require('../services/ponteSamp/motivos');
  const { tabela: padrao } = await motivos.obterTabela();
  const comNovo = [...padrao, { nome: 'TESTE NOVO', cmd: 'ban', tempo: 2, avisos: 0 }];
  const ok = await motivos.salvarTabela(comNovo, 'staff', { podeApagar: false });
  assert.equal(ok.erro, undefined, 'adicionar pode');
  const mudado = comNovo.map(t => (t.nome === 'TESTE NOVO' ? { ...t, tempo: 4 } : t));
  assert.equal((await motivos.salvarTabela(mudado, 'staff', { podeApagar: false })).erro, undefined, 'mudar pode');
  assert.match((await motivos.salvarTabela(padrao, 'staff', { podeApagar: false })).erro, /Só o dono.*TESTE NOVO/);
  const renomeado = mudado.map(t => (t.nome === 'TESTE NOVO' ? { ...t, nome: 'OUTRO NOME' } : t));
  assert.match((await motivos.salvarTabela(renomeado, 'staff', { podeApagar: false })).erro, /Só o dono/);
  assert.match((await motivos.salvarTabela([], 'staff', { podeApagar: false })).erro, /tabela padrão/);
  assert.equal((await motivos.salvarTabela([], 'dono')).propria, false, 'o dono volta ao padrão');
});

test('/provastaff: aceitar pede ID e motivo e manda direto para o jogo, sem a Cadeia Staff', async () => {
  const Config = require('../models/Config');
  const DenunciaStaff = require('../models/DenunciaStaff');
  await DenunciaStaff.init(); // índices criados antes: o arquivo termina logo depois
  const provaStaff = require('../commands/provaStaff');
  await Config.create({ guildId: '813', channels: { logs: '600000000000000813', provasStaff: '600000000000000814' }, roles: { responsavel_admin: '777000000000000813' } });
  const doc = await DenunciaStaff.create({ guildId: '813', contas: ['111', '222'], motivo: 'SAAV', punicao: 'Ban 3d', channelId: '600000000000000814', messageId: '600000000000000999', threadId: '600000000000000998' });

  const enviadas = [];
  const editadas = [];
  const cadeia = { send: async (msg) => { enviadas.push(msg); return { id: '700', channelId: '600000000000000813', url: 'https://x' }; } };
  const registro = { content: '➥ Status: `Pendente`', edit: async (msg) => editadas.push(msg) };
  let resposta = '';
  const noTopico = [];
  const interacao = {
    customId: `${provaStaff.MODAL_ACEITE}${doc._id}`,
    guild: { id: '813', channels: { fetch: async () => cadeia } },
    member: { displayName: 'Resp', roles: { cache: new Map([['777000000000000813', {}]]) } },
    user: { id: '1', username: 'resp', toString: () => '<@1>' },
    client: { channels: { fetch: async (id) => (id === '600000000000000998' ? { send: async (msg) => noTopico.push(msg.content) } : { messages: { fetch: async () => registro } }) } },
    fields: { getTextInputValue: (id) => ({ acusado: ' 111 + 222 ', motivo: 'SAAV' })[id] },
    deferReply: async () => {},
    editReply: async (r) => { resposta = typeof r === 'string' ? r : r.content; }
  };
  // Motivo fora da tabela: não aceita (a trava vem ligada).
  const original = interacao.fields;
  interacao.fields = { getTextInputValue: (id) => ({ acusado: '111', motivo: 'rrrr' })[id] };
  await provaStaff.handleModalAceite(interacao);
  assert.match(resposta, /não está na tabela de motivos/);
  assert.equal((await DenunciaStaff.findById(doc._id).lean()).status, 'pendente');
  interacao.fields = original;

  // Aceito: não passa pela Cadeia Staff, vai direto para o jogo (aqui a ponte está desligada).
  await provaStaff.handleModalAceite(interacao);
  assert.match(resposta, /Provas aceitas\.\n⚠️ A ponte com o jogo não está ativa/);
  assert.equal(enviadas.length, 0, 'nada na Cadeia Staff');
  assert.match(editadas[0].content, /Status: `Aceita` por <@1>$/);
  assert.doesNotMatch(editadas[0].content, /➥ Jogo/);
  assert.deepEqual(editadas[0].components, []);
  assert.equal(noTopico[0], '✅ Provas aceitas por <@1>');
  const salvo = await DenunciaStaff.findById(doc._id).lean();
  assert.deepEqual([salvo.status, salvo.acusadoAceite, salvo.cadeia.status], ['aceita', '111+222', 'aceita']);

  // O aceite da Cadeia Staff usa a denúncia da staff como uma denúncia comum.
  const comoDenuncia = provaStaff.comoDenuncia(salvo);
  assert.deepEqual([comoDenuncia.acusadoId, comoDenuncia.motivoAceite, String(comoDenuncia._id)], ['111+222', 'SAAV', String(doc._id)]);

  // Segunda vez: já decidido.
  await provaStaff.handleModalAceite(interacao);
  assert.match(resposta, /já foi decidido/);
});

test('/tempban: registro já aceito, sem botões, no canal das provas e punição direto na fila do jogo', async () => {
  const Config = require('../models/Config');
  const DenunciaStaff = require('../models/DenunciaStaff');
  const provaStaff = require('../commands/provaStaff');
  await Config.create({ guildId: '816', channels: { provasStaff: '600000000000000816' }, roles: { responsavel_admin: '777000000000000816' } });
  await m.PonteServidor.create({ guildId: '816', ativo: true });

  const enviadas = [];
  let edicao = null;
  const registro = { id: '600000000000000900', channelId: '600000000000000816', content: '', startThread: async () => null, edit: async (msg) => { edicao = msg; } };
  const canal = {
    id: '600000000000000816',
    guild: { id: '816' },
    isTextBased: () => true,
    send: async (msg) => { enviadas.push(msg); if (msg.content) registro.content = msg.content; return msg.embeds ? { id: 'painel' } : registro; },
    messages: { fetch: async () => null }
  };
  let resposta = '';
  const interacao = {
    customId: provaStaff.MODAL_TEMPBAN,
    guild: { id: '816', name: 'BRP', channels: { fetch: async () => canal } },
    member: { displayName: 'Resp', roles: { cache: new Map([['777000000000000816', {}]]) } },
    user: { id: '1', username: 'resp', toString: () => '<@1>' },
    client: { channels: { fetch: async () => null }, users: { fetch: async () => null } },
    fields: { getTextInputValue: (id) => ({ id: '111 + 222', motivo: 'SAAV', provas: '' })[id] },
    deferReply: async () => {},
    editReply: async (r) => { resposta = typeof r === 'string' ? r : r.content; }
  };

  // Sem o cargo de responsável: não registra.
  const membro = interacao.member;
  interacao.member = { displayName: 'Staff', roles: { cache: new Map() } };
  await provaStaff.handleModalTempban(interacao);
  assert.match(resposta, /Só o responsável/);
  interacao.member = membro;

  // Motivo fora da tabela: não registra (vai direto para o jogo, precisa do tempo).
  const campos = interacao.fields;
  interacao.fields = { getTextInputValue: (id) => ({ id: '111', motivo: 'rrrr' })[id] };
  await provaStaff.handleModalTempban(interacao);
  assert.match(resposta, /não está na tabela de motivos/);
  assert.equal(await DenunciaStaff.countDocuments({ guildId: '816' }), 0);
  interacao.fields = campos;

  await provaStaff.handleModalTempban(interacao);
  assert.match(resposta, /Tempban registrado/);
  assert.deepEqual(enviadas[0].components, [], 'sem Aceitar e Recusar');
  assert.match(enviadas[0].content, /➥ ID\(s\):\n {2}• 111\n {2}• 222/);
  assert.match(enviadas[0].content, /➥ Status: `Aceita` por <@1>$/);
  assert.equal(edicao, null, 'a mensagem do canal não ganha a linha do jogo');
  assert.match(resposta, /📤 Enviada à gamemode \(2 pedido\(s\)\)/);

  const doc = await DenunciaStaff.findOne({ guildId: '816' }).lean();
  assert.deepEqual([doc.status, doc.acusadoAceite, doc.motivoAceite, doc.cadeia.status, doc.messageId], ['aceita', '111+222', 'SAAV', 'aceita', '600000000000000900']);
  const punicao = await m.PontePunicao.findOne({ denunciaId: doc._id }).lean();
  assert.deepEqual([punicao.status, punicao.alvos.map(a => a.contaId)], ['executando', ['111', '222']]);
});

test('/provastaff: motivo cadastrado depois atualiza a punição dos registros pendentes fora da tabela', async () => {
  const DenunciaStaff = require('../models/DenunciaStaff');
  const { atualizarProvasForaDaTabela } = require('../commands/provaStaff');
  const { tabela: padrao } = await require('../services/ponteSamp/motivos').obterTabela();
  const fora = 'Motivo fora da tabela: o responsável confere no aceite'; // texto antigo: registros pendentes ainda o têm
  const doc = await DenunciaStaff.create({ guildId: '814', contas: ['1'], motivo: 'Mau uso /n', punicao: fora, channelId: 'c', messageId: 'm' });
  const editadas = [];
  const client = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => ({ content: `➥ Punição: ${fora}`, edit: async (msg) => editadas.push(msg.content) }) } }) } };
  assert.equal(await atualizarProvasForaDaTabela({ client, tabela: padrao }), 0, 'ainda fora da tabela');
  const tabela = [...padrao, { nome: 'MAU USO /N', sinonimos: ['MAU USO /N'], cmd: 'cadeia', tempo: 120, avisos: 0 }];
  assert.equal(await atualizarProvasForaDaTabela({ client, tabela }), 1);
  assert.equal((await DenunciaStaff.findById(doc._id).lean()).punicao, 'Cadeia de 120 min');
  assert.equal(editadas[0], '➥ Punição: Cadeia de 120 min');

  // Texto novo, curto.
  const novo = await DenunciaStaff.create({ guildId: '814', contas: ['2'], motivo: 'Mau uso /n', punicao: 'Fora da tabela', channelId: 'c', messageId: 'm2' });
  editadas.length = 0;
  const clienteNovo = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => ({ content: '➥ Punição: Fora da tabela', edit: async (msg) => editadas.push(msg.content) }) } }) } };
  assert.equal(await atualizarProvasForaDaTabela({ client: clienteNovo, tabela }), 1);
  assert.equal((await DenunciaStaff.findById(novo._id).lean()).punicao, 'Cadeia de 120 min');
  assert.equal(editadas[0], '➥ Punição: Cadeia de 120 min');
});

test('aceite com motivo "só registro": segue normal, mas não cria punição para o jogo', async () => {
  const motivos = require('../services/ponteSamp/motivos');
  const { tabela: padrao } = await motivos.obterTabela();
  await guildAtiva('815');
  await motivos.salvarTabela([...padrao.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.filter(s => s !== t.nome), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos, texto: t.texto })),
    { nome: 'MAU USO /N', cmd: 'registro', tempo: 0, avisos: 0, texto: 'Mute 120 min' }], 'teste');
  try {
    const denuncia = { ...denunciaFalsa('815', '1039'), motivoAceite: 'Mau uso /n' };
    const r = await m.aceite.registrarAceite({ client: clienteFalso, denuncia, origem: 'canal_staff', staff: { id: '1', nome: 'x' } });
    assert.deepEqual(r, { soRegistro: true });
    assert.equal(await m.PontePunicao.countDocuments({ denunciaId: denuncia._id }), 0);
  } finally {
    await motivos.salvarTabela([], 'teste');
  }
});

test('aceite de novo com outro ID ou motivo refaz os jogadores da punição ainda não enviada', async () => {
  await guildAtiva('817');
  const staff = { id: '1', nome: 'Resp' };
  const denuncia = { _id: new mongoose.Types.ObjectId(), guildId: '817', acusado: '1270101', motivo: 'CL', acusadoId: '1270101 CL + 360429 saav', motivoAceite: '1270101 CL + 360429 saav', channelId: '1', messageId: '2' };
  // Primeiro aceite com o ID fora do formato: punição sem jogador.
  const primeiro = await m.aceite.registrarAceite({ client: null, denuncia, origem: 'canal_staff', staff });
  assert.equal(primeiro.criado, true);
  assert.equal(primeiro.punicao.alvos.length, 0);

  // Aceite de novo com o ID certo: refaz os jogadores.
  const certo = { ...denuncia, acusadoId: '1270101+360429', motivoAceite: '1270101 CL +360429 saav' };
  const segundo = await m.aceite.registrarAceite({ client: null, denuncia: certo, origem: 'canal_staff', staff });
  assert.equal(segundo.atualizada, true);
  assert.deepEqual(segundo.punicao.alvos.map(a => [a.contaId, a.motivo]), [['1270101', 'CL'], ['360429', 'saav']]);

  // Mesmo aceite outra vez: não mexe (edição à mão continua).
  const terceiro = await m.aceite.registrarAceite({ client: null, denuncia: certo, origem: 'canal_staff', staff });
  assert.equal(terceiro.jaExistia, true);

  // Já enviada: não refaz.
  await m.PontePunicao.updateOne({ _id: segundo.punicao._id }, { $set: { status: 'executando' } });
  const enviada = await m.aceite.registrarAceite({ client: null, denuncia: { ...certo, motivoAceite: '1270101 SAAV' }, origem: 'canal_staff', staff });
  assert.equal(enviada.jaExistia, true);
  assert.equal((await m.PontePunicao.findById(segundo.punicao._id).lean()).alvos.length, 2);
});

test('/tempban com o link da denúncia: corrige a punição dela (sem registro nem Cadeia Staff)', async () => {
  const Config = require('../models/Config');
  const Denuncia = require('../models/Denuncia');
  const provaStaff = require('../commands/provaStaff');
  await guildAtiva('100000000000000818');
  await Config.create({ guildId: '100000000000000818', channels: { provasStaff: '600000000000000818' }, roles: { responsavel_admin: '777000000000000818' } });
  const denunciaId = new mongoose.Types.ObjectId();
  await Denuncia.collection.insertOne({ _id: denunciaId, guildId: '100000000000000818', status: 'aceita', acusado: '1270101', motivo: 'CL', acusadoId: '1270101 CL + 360429 saav', motivoAceite: 'x', channelId: '600000000000000001', messageId: '600000000000000002', threadId: '600000000000000003' });
  // Punição que ficou sem jogador no primeiro aceite.
  await m.aceite.registrarAceite({ client: null, denuncia: { _id: denunciaId, guildId: '100000000000000818', acusadoId: '1270101 CL + 360429 saav', motivoAceite: 'x' }, origem: 'canal_staff', staff: { id: '1', nome: 'R' } });

  const enviadas = [];
  let resposta = '';
  const campos = { id: '1270101+360429', motivo: '1270101 CL +360429 saav', provas: '', link: 'https://discord.com/channels/100000000000000818/600000000000000003' };
  const interacao = {
    customId: provaStaff.MODAL_TEMPBAN,
    guild: { id: '100000000000000818', name: 'BRP', channels: { fetch: async () => ({ id: '600000000000000818', isTextBased: () => true, send: async (msg) => { enviadas.push(msg); return {}; } }) } },
    member: { displayName: 'Resp', roles: { cache: new Map([['777000000000000818', {}]]) } },
    user: { id: '1', username: 'resp', toString: () => '<@1>' },
    client: { channels: { fetch: async () => null }, users: { fetch: async () => null } },
    fields: { getTextInputValue: (id) => campos[id] },
    deferReply: async () => {},
    editReply: async (r) => { resposta = typeof r === 'string' ? r : r.content; }
  };
  await provaStaff.handleModalTempban(interacao);
  assert.match(resposta, /Punição da denúncia atualizada: 1270101\+360429/);
  assert.equal(enviadas.length, 0, 'nada no canal das provas');
  const punicao = await m.PontePunicao.findOne({ denunciaId }).lean();
  assert.deepEqual(punicao.alvos.map(a => [a.contaId, a.motivo]), [['1270101', 'CL'], ['360429', 'saav']]);
  assert.equal((await Denuncia.findById(denunciaId).lean()).acusadoId, '1270101+360429');

  // Link de denúncia que não foi aceita: recusa.
  await Denuncia.collection.updateOne({ _id: denunciaId }, { $set: { status: 'pendente' } });
  await provaStaff.handleModalTempban(interacao);
  assert.match(resposta, /ainda não foi aceita/);
});

test('/tempban com o link: punição da denúncia já aplicada não bloqueia, vira uma punição nova', async () => {
  const Config = require('../models/Config');
  const Denuncia = require('../models/Denuncia');
  const provaStaff = require('../commands/provaStaff');
  const g = '100000000000000819';
  await guildAtiva(g);
  await Config.create({ guildId: g, channels: { provasStaff: '600000000000000819' }, roles: { responsavel_admin: '777000000000000819' } });
  const denunciaId = new mongoose.Types.ObjectId();
  await Denuncia.collection.insertOne({ _id: denunciaId, guildId: g, status: 'aceita', acusado: '1270101', motivo: 'CL', acusadoId: '1270101', motivoAceite: 'CL', channelId: '600000000000000011', messageId: '600000000000000012', threadId: '600000000000000013' });
  const primeira = await m.aceite.registrarAceite({ client: null, denuncia: { _id: denunciaId, guildId: g, acusadoId: '1270101', motivoAceite: 'CL' }, origem: 'canal_staff', staff: { id: '1', nome: 'R' } });
  await m.PontePunicao.updateOne({ _id: primeira.punicao._id }, { $set: { status: 'aplicada' } });

  let resposta = '';
  const campos = { id: '360429', motivo: 'saav', provas: '', link: `https://discord.com/channels/${g}/600000000000000013` };
  await provaStaff.handleModalTempban({
    customId: provaStaff.MODAL_TEMPBAN,
    guild: { id: g, name: 'BRP', channels: { fetch: async () => ({ id: '600000000000000819', isTextBased: () => true, send: async () => ({}) }) } },
    member: { displayName: 'Resp', roles: { cache: new Map([['777000000000000819', {}]]) } },
    user: { id: '1', username: 'resp', toString: () => '<@1>' },
    client: { channels: { fetch: async () => null }, users: { fetch: async () => null } },
    fields: { getTextInputValue: (id) => campos[id] },
    deferReply: async () => {},
    editReply: async (r) => { resposta = typeof r === 'string' ? r : r.content; }
  });
  assert.match(resposta, /Punição nova da denúncia/);
  const DenunciaStaff = require('../models/DenunciaStaff');
  const doc = await DenunciaStaff.findOne({ guildId: g }).lean();
  assert.equal(doc.threadId, '600000000000000013', 'ligada ao tópico da denúncia');
  const nova = await m.PontePunicao.findOne({ denunciaId: doc._id }).lean();
  assert.deepEqual([nova.status, nova.alvos.map(a => a.contaId)], ['executando', ['360429']], 'já foi enviada à gamemode');
  assert.equal((await m.PontePunicao.findById(primeira.punicao._id).lean()).status, 'aplicada', 'a aplicada não muda');
});

test('/provastaff: recusar vale com motivo fora da tabela e apaga o registro do canal', async () => {
  const Config = require('../models/Config');
  const DenunciaStaff = require('../models/DenunciaStaff');
  const provaStaff = require('../commands/provaStaff');
  await Config.create({ guildId: '820', channels: { log: '600000000000000940' }, roles: { responsavel_admin: '777000000000000820' } });
  const doc = await DenunciaStaff.create({ guildId: '820', contas: ['1269187'], motivo: '63 + falando que não era para mim tar ali', punicao: 'Fora da tabela', channelId: 'c', messageId: '600000000000000920', threadId: 't' });
  let apagada = false;
  const noTopico = [];
  const noLog = [];
  await provaStaff.handleBotaoRecusar({
    customId: `${provaStaff.BOTAO_RECUSAR}${doc._id}`,
    guild: { id: '820', channels: { fetch: async (id) => (id === '600000000000000940' ? { send: async (msg) => { noLog.push(msg); return {}; } } : null) } },
    member: { displayName: 'Resp', roles: { cache: new Map([['777000000000000820', {}]]) } },
    user: { id: '1', username: 'resp', toString: () => '<@1>' },
    message: { id: '600000000000000920', delete: async () => { apagada = true; } },
    client: { channels: { fetch: async (id) => (id === 't' ? { send: async (msg) => noTopico.push(msg.content) } : null) } },
    reply: async (r) => { throw new Error(`não devia responder: ${r.content}`); },
    deferUpdate: async () => {}
  });
  assert.equal(apagada, true);
  assert.equal((await DenunciaStaff.findById(doc._id).lean()).status, 'recusada');
  assert.equal(noTopico[0], '❌ Provas recusadas por <@1>');
  const embed = noLog[0].embeds[0].toJSON();
  assert.equal(embed.title, '❌ Provas da staff recusadas');
  assert.deepEqual(embed.fields.map(f => f.value).slice(1, 4), ['1269187', '<@1>', '63 + falando que não era para mim tar ali']);
});

test('Entrar no tópico: diz se o tópico foi apagado ou se o bot está sem acesso', async () => {
  const Config = require('../models/Config');
  const Denuncia = require('../models/Denuncia');
  const { handleEntrarNoTopico } = require('../commands/denuncia');
  await Config.create({ guildId: '821', roles: { administrador: '777000000000000821' } });
  await Denuncia.collection.insertOne({ guildId: '821', messageId: '600000000000000930', threadId: '600000000000000931' });
  const tentar = async (erro) => {
    let resposta = '';
    await handleEntrarNoTopico({
      customId: 'entrar_topico',
      guild: { id: '821' },
      member: { roles: { cache: new Map([['777000000000000821', {}]]) } },
      user: { id: '1' },
      message: { id: '600000000000000930' },
      client: { channels: { fetch: async () => { throw Object.assign(new Error('x'), { code: erro }); } } },
      deferReply: async () => {},
      editReply: async (r) => { resposta = typeof r === 'string' ? r : r.content; }
    });
    return resposta;
  };
  assert.match(await tentar(10003), /foi apagado/);
  assert.match(await tentar(50001), /não tem acesso/);
});

test('Relatório de punições: o Discord do jogador vem com o nome em texto ao lado da menção', async () => {
  const Usuario = require('../models/Usuario');
  const { discordDaConta } = require('../services/ponteSamp/avisoOrganizacao');
  await Usuario.create({ guildId: '822', userId: '1501018070691614801', username: 'sr_delet', conta: '1242809' });
  assert.equal(await discordDaConta('822', '1242809', ''), '<@1501018070691614801> (sr\\_delet)', 'sublinhado escapado: não vira itálico');
  await Usuario.create({ guildId: '822', userId: '1501018070691614802', conta: '1242810' });
  assert.equal(await discordDaConta('822', '1242810', ''), '<@1501018070691614802>');
  assert.equal(await discordDaConta('822', '999', ''), 'Não informado');
});

test('/tempban e /desbanir: o dono do bot usa sem o cargo; com a senha da Cadeia Staff ligada, pedem a senha', async () => {
  const Config = require('../models/Config');
  const { validarSenha } = require('../utils/senhaStaff');
  const provaStaff = require('../commands/provaStaff');
  const desbanir = require('../commands/desbanir');
  const g = '100000000000000823';
  await Config.create({ guildId: g, channels: { provasStaff: '600000000000000823' }, roles: { responsavel_admin: '777000000000000823' }, senhaCadeiaStaff: true });
  const interacao = (userId, cargo = false) => {
    const i = {
      guild: { id: g, channels: { fetch: async () => ({ id: '600000000000000823', isTextBased: () => true }) } },
      member: { roles: { cache: new Map(cargo ? [['777000000000000823', {}]] : []) } },
      user: { id: userId },
      respostas: [],
      reply: async (r) => i.respostas.push(r),
      showModal: async (m) => i.respostas.push({ modal: m.toJSON().custom_id })
    };
    return i;
  };

  // Sem o cargo e sem ser o dono: recusa.
  const outro = interacao('300000000000000823');
  await provaStaff.handleTempbanSlash(outro);
  assert.match(outro.respostas[0].content, /Só o responsável/);

  // Dono do bot sem o cargo, senha ligada e ainda sem senha: abre o formulário da senha.
  const dono = interacao(process.env.OWNER_DISCORD_ID);
  await provaStaff.handleTempbanSlash(dono);
  assert.equal(dono.respostas[0].modal, 'senha_cadeia:jogo:0');
  const doDesbanir = interacao(process.env.OWNER_DISCORD_ID);
  await desbanir.handleDesbanirSlash(doDesbanir);
  assert.equal(doDesbanir.respostas[0].modal, 'senha_cadeia:jogo:0');

  // Com a senha certa: abre o formulário do próprio comando.
  await validarSenha(process.env.OWNER_DISCORD_ID, { senha: 'segredo1', confirmar: 'segredo1' });
  const liberado = interacao(process.env.OWNER_DISCORD_ID);
  await provaStaff.handleTempbanSlash(liberado);
  assert.equal(liberado.respostas[0].modal, provaStaff.MODAL_TEMPBAN);
  const desbanirLiberado = interacao(process.env.OWNER_DISCORD_ID);
  await desbanir.handleDesbanirSlash(desbanirLiberado);
  assert.equal(desbanirLiberado.respostas[0].modal, desbanir.MODAL_DESBANIR);
});

test('strikes: várias mensagens ao mesmo tempo somam todas, sem erro de versão; zerar limpa só aquele tipo', async () => {
  const Strike = require('../models/Strike');
  const { somarStrike, zerarStrikes } = require('../utils/strikeWords');
  const message = { author: { id: '300000000000000501' }, guild: { id: '100000000000000501' } };
  // Strike de mais de 24 h sai na conta.
  await Strike.create({ userId: message.author.id, guildId: message.guild.id, strikes: [{ timestamp: new Date(Date.now() - 2 * 864e5) }], strikesLink: [{ timestamp: new Date() }] });
  const contas = await Promise.all([1, 2, 3].map(() => somarStrike(Strike, message, 'strikes')));
  assert.deepEqual(contas.map(c => c.strikesCount).sort(), [1, 2, 3]);
  const salvo = await Strike.findOne({ userId: message.author.id }).lean();
  assert.equal(salvo.strikes.length, 3);
  await zerarStrikes(Strike, salvo, 'strikes');
  const zerado = await Strike.findOne({ userId: message.author.id }).lean();
  assert.deepEqual([zerado.strikes.length, zerado.strikesLink.length], [0, 1]);
});
