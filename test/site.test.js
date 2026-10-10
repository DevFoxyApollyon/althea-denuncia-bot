const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');

test.after(fecharConexoes);

test('categoria é reconhecida pelo texto do motivo', () => {
  const { categoriaDoMotivo } = require('../site/categorias');
  assert.equal(categoriaDoMotivo('Anti-RP durante abordagem'), 'Anti-RP');
  assert.equal(categoriaDoMotivo('anti rp'), 'Anti-RP');
  assert.equal(categoriaDoMotivo('ZARALHO na praça'), 'Zaralho');
  assert.equal(categoriaDoMotivo('fez slide na perseguição'), 'Slide');
  assert.equal(categoriaDoMotivo('rdm sem motivo'), 'RDM');
  assert.equal(categoriaDoMotivo('Amor à vida'), 'Amor à vida');
  assert.equal(categoriaDoMotivo('combatlog'), 'Combat log');
  assert.equal(categoriaDoMotivo('algo que ninguém previu'), 'Outros');
  assert.equal(categoriaDoMotivo(''), 'Outros');
});

test('upload: o conteúdo precisa combinar com a extensão', () => {
  const { conteudoCombinaComExtensao } = require('../site/rotas');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]);
  const executavel = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1');

  assert.equal(conteudoCombinaComExtensao(png, 'png'), true);
  assert.equal(conteudoCombinaComExtensao(mp4, 'mp4'), true);
  assert.equal(conteudoCombinaComExtensao(Buffer.from('prova em texto'), 'txt'), true);
  assert.equal(conteudoCombinaComExtensao(executavel, 'png'), false, 'executável renomeado para .png');
  assert.equal(conteudoCombinaComExtensao(executavel, 'mp4'), false);
  assert.equal(conteudoCombinaComExtensao(executavel, 'txt'), false, 'binário não passa como texto');
  assert.equal(conteudoCombinaComExtensao(png, 'exe'), false, 'extensão fora da lista');
});

test('limitador bloqueia depois do máximo e separa por chave', () => {
  const { criarLimitador } = require('../site/rotas');
  const permitido = criarLimitador(2, 60 * 1000);
  assert.equal(permitido('a'), true);
  assert.equal(permitido('a'), true);
  assert.equal(permitido('a'), false);
  assert.equal(permitido('b'), true);
});

test('sessão: token adulterado ou vencido é recusado', () => {
  const { criarToken, lerToken } = require('../site/sessao');
  const segredo = 'segredo-de-teste-com-mais-de-32-caracteres';
  const token = criarToken({ id: '1', nome: 'Teste' }, segredo);

  assert.equal(lerToken(token, segredo).id, '1');
  assert.equal(lerToken(token, 'outro-segredo-com-mais-de-32-caracteres!'), null);
  assert.equal(lerToken(token.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), segredo), null);
  assert.equal(lerToken(criarToken({ id: '1' }, segredo, -1000), segredo), null, 'vencido');
  assert.equal(lerToken('lixo', segredo), null);
});

test('SLA: infrações graves têm prioridade alta e prazo menor', () => {
  const { prioridadeDoMotivo, prazoDoSla, SLA_HORAS } = require('../site/categorias');
  for (const motivo of ['Mods proibidos', 'zaralho no centro', 'slide em fuga', 'uso de hack']) {
    assert.equal(prioridadeDoMotivo(motivo), 'alta', motivo);
  }
  assert.equal(prioridadeDoMotivo('Anti-RP'), 'normal');
  assert.equal(prioridadeDoMotivo('motivo qualquer'), 'normal');

  const abertura = new Date('2026-10-09T12:00:00Z');
  assert.equal(prazoDoSla('hack', abertura) - abertura, SLA_HORAS.alta * 3600 * 1000);
  assert.equal(prazoDoSla('rdm', abertura) - abertura, SLA_HORAS.normal * 3600 * 1000);
  assert.ok(SLA_HORAS.alta < SLA_HORAS.normal);
});

test('identificação: separa os IDs do acusado', () => {
  const { idsDoAcusado } = require('../site/rotas/identificacao');
  assert.deepEqual(idsDoAcusado('1039+2471'), ['1039', '2471']);
  assert.deepEqual(idsDoAcusado(' 1039 + ABC12 '), ['1039', 'abc12']);
  assert.deepEqual(idsDoAcusado(''), []);
  assert.equal(idsDoAcusado('10390').includes('1039'), false, 'ID parecido não vale');
});

test('categorias: siglas só casam com a palavra inteira', () => {
  const { categoriaDoMotivo } = require('../site/categorias');
  assert.equal(categoriaDoMotivo('Pg'), 'Power gaming');
  assert.equal(categoriaDoMotivo('db na favela'), 'Drive-by');
  assert.equal(categoriaDoMotivo('Flod'), 'Flood');
  assert.equal(categoriaDoMotivo('saav'), 'Amor à vida');
  assert.equal(categoriaDoMotivo('Algemando em ação'), 'Algemar em ação');
  assert.equal(categoriaDoMotivo('pagou a conta'), 'Outros', '"pg" não pode casar com "pagou"');
  assert.equal(categoriaDoMotivo('clima ruim'), 'Outros', '"cl" não pode casar com "clima"');
});

test('configuração do site: valida e limpa o que o responsável salva', () => {
  const { validarConfig } = require('../site/configSite');
  const base = { slaHoras: { alta: 1, normal: 12 }, categorias: [{ nome: ' Hack ', prioridade: 'alta', termos: ' hack , Cheat, x' }], respostasProntas: [{ titulo: 'Oi', texto: 'Texto' }, { titulo: '', texto: 'sem título' }] };

  const limpa = validarConfig(base);
  assert.deepEqual(limpa.categorias, [{ nome: 'Hack', grupo: '', prioridade: 'alta', termos: ['hack', 'cheat'] }]);
  assert.equal(limpa.respostasProntas.length, 1);

  assert.throws(() => validarConfig({ ...base, categorias: [] }), /pelo menos uma categoria/);
  assert.throws(() => validarConfig({ ...base, slaHoras: { alta: 30, normal: 12 } }), /não pode ser maior/);
  assert.throws(() => validarConfig({ ...base, slaHoras: { alta: 0, normal: 12 } }), /entre 0,25 e 720/);
  assert.throws(() => validarConfig({ ...base, categorias: [{ nome: 'A', termos: 'x' }] }), /pelo menos um termo/);
});

test('aviso ao acusado: identifica o autor real e respeita o intervalo', () => {
  const { autorReal, podeAvisar, INTERVALO_MS } = require('../utils/avisoResposta');
  assert.equal(autorReal({ author: { id: '1', bot: false }, content: 'oi' }), '1');
  assert.equal(autorReal({ author: { id: '9', bot: true }, content: 'Enviado por <@657014871228940336>' }), '657014871228940336');
  assert.equal(autorReal({ author: { id: '9', bot: true }, content: 'O administrador reivindicou.' }), null, 'registro do bot não avisa');

  assert.equal(podeAvisar('u1', 't1', 1000), true);
  assert.equal(podeAvisar('u1', 't1', 1000 + INTERVALO_MS - 1), false);
  assert.equal(podeAvisar('u1', 't2', 1000), true, 'outro tópico tem intervalo próprio');
  assert.equal(podeAvisar('u1', 't1', 1000 + INTERVALO_MS), true);
});

test('categorias: motivos das regras de RP e seus grupos', () => {
  const { categoriaDoMotivo, configVisivel } = require('../site/categorias');
  assert.equal(categoriaDoMotivo('sk no hospital'), 'Spawn kill');
  assert.equal(categoriaDoMotivo('nlr'), 'Voltar ao local da morte');
  assert.equal(categoriaDoMotivo('non rp'), 'Anti-RP');
  assert.equal(categoriaDoMotivo('mod menu'), 'Mods proibidos');
  assert.equal(categoriaDoMotivo('skate na praça'), 'Outros');
  assert.ok(configVisivel('servidor-sem-config').categorias.every(item => item.grupo));
});

test('perfil do jogador: finalizada com punição conta como aceita', () => {
  const { resultadoDoCaso, resumir } = require('../site/rotas/jogadores');
  assert.equal(resultadoDoCaso({ status: 'finalizada', motivoAceite: 'RDM: 3 dias' }), 'aceita');
  assert.equal(resultadoDoCaso({ status: 'finalizada' }), 'finalizada');
  assert.equal(resultadoDoCaso({ status: 'analise' }), 'andamento');

  const resumo = resumir([
    { _id: 'a1', status: 'aceita', motivo: 'rdm' },
    { _id: 'a2', status: 'recusada', motivo: 'rdm' },
    { _id: 'a3', status: 'pendente', motivo: 'vdm' }
  ], 'servidor');
  assert.equal(resumo.taxaDeAceitas, 0.5);
  assert.deepEqual(resumo.porCategoria[0], { nome: 'RDM', total: 2 });
});

test('notificações: só aceita inscrição de serviço de push conhecido', () => {
  const { validarInscricao, podeAvisar } = require('../site/push');
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  assert.ok(validarInscricao({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.ok(validarInscricao({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc', keys }));
  assert.equal(validarInscricao({ endpoint: 'https://exemplo.com/roubar', keys }), null);
  assert.equal(validarInscricao({ endpoint: 'http://fcm.googleapis.com/x', keys }), null);
  assert.equal(validarInscricao({ endpoint: 'https://fcm.googleapis.com/x', keys: {} }), null);

  assert.equal(podeAvisar('u1', 't1', 1000), true);
  assert.equal(podeAvisar('u1', 't1', 2000), false);
  assert.equal(podeAvisar('u1', 't1', 1000 + 3 * 60 * 1000), true);
});

test('chat: flood por rajada ou por mensagem repetida', () => {
  const { ehFlood } = require('../site/rotas/chat');
  const t0 = 1_000_000;
  // Quatro mensagens diferentes em sequência ainda passam; a quinta em 8 s é flood.
  for (let i = 0; i < 4; i++) assert.equal(ehFlood('g:rajada', `mensagem ${i}`, t0 + i * 1000), false);
  assert.equal(ehFlood('g:rajada', 'mensagem 4', t0 + 4000), true);

  // Três vezes a mesma mensagem dentro de um minuto também.
  assert.equal(ehFlood('g:repete', 'oi', t0), false);
  assert.equal(ehFlood('g:repete', 'OI', t0 + 15000), false);
  assert.equal(ehFlood('g:repete', 'oi', t0 + 30000), true);

  // Conversa normal, espaçada, não é flood.
  for (let i = 0; i < 10; i++) assert.equal(ehFlood('g:normal', `fala ${i}`, t0 + i * 20000), false);
});

test('chat: música só aceita YouTube e Spotify e guarda só o identificador', () => {
  const { analisarMusica } = require('../site/rotas/chatSala');
  assert.deepEqual(analisarMusica('https://youtu.be/jNQXAC9IVRw?si=abc'), { tipo: 'youtube', ref: 'jNQXAC9IVRw' });
  assert.deepEqual(analisarMusica('https://music.youtube.com/watch?v=jNQXAC9IVRw&t=3'), { tipo: 'youtube', ref: 'jNQXAC9IVRw' });
  assert.deepEqual(analisarMusica('https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=1'), { tipo: 'spotify', ref: 'track/4cOdK2wGLETKBW3PvgPWqT' });
  assert.equal(analisarMusica('https://exemplo.com/watch?v=jNQXAC9IVRw'), null);
  assert.equal(analisarMusica('javascript:alert(1)'), null);
  assert.equal(analisarMusica('https://youtu.be/"><script>'), null);
});

test('chat: reações mostram o total e se a pessoa já reagiu', () => {
  const { serializarReacoes } = require('../site/rotas/chatSala');
  assert.deepEqual(serializarReacoes([{ emoji: '👍', usuarios: ['a', 'b'] }, { emoji: '❌', usuarios: [] }], 'b'), [{ emoji: '👍', total: 2, minha: true }]);
});

test('retenção: configurações e cadastros são permanentes; registros expiram', () => {
  const { COLECOES_PERMANENTES } = require('../utils/retencaoDados');
  const permanentes = ['Config', 'GlobalConfig', 'ConfigSite', 'ChatSala', 'ChatFixada', 'ChatBanimento', 'ChavePush', 'InscricaoPush', 'StaffProfile', 'Usuario'];
  for (const nome of permanentes) {
    const modelo = require(`../models/${nome}`);
    assert.equal(modelo.schema.path('dataRetencaoAte'), undefined, `${nome} não pode ter prazo`);
    assert.ok(COLECOES_PERMANENTES.includes(modelo.collection.name), `${modelo.collection.name} deve estar na lista de permanentes`);
  }
  for (const nome of ['DenunciaMensagem', 'ModerationAction', 'AcessoCaso', 'ChatMensagem', 'ChatModeracao', 'NotaInterna']) {
    const modelo = require(`../models/${nome}`);
    assert.ok(modelo.schema.path('dataRetencaoAte'), `${nome} deve ter validade`);
    assert.equal(COLECOES_PERMANENTES.includes(modelo.collection.name), false);
  }
});

test('retenção: prazos por coleção e em qual banco cada modelo fica', () => {
  const { validadePara, COLECOES_COM_REGRA_PROPRIA } = require('../utils/retencaoDados');
  const { primaryConnection, secondaryConnection } = require('../utils/persistencia');
  const agora = new Date('2026-10-10T12:00:00.000Z');
  const dias = (colecao) => Math.round((validadePara(colecao, agora) - agora) / 86400000);

  assert.equal(dias('denunciamensagems'), 45);
  assert.equal(dias('moderationactions'), 30);
  assert.equal(dias('acessocasos'), 15);
  assert.ok(dias('chatmensagems') > 180, 'o que não tem prazo próprio dura seis meses');

  // Denúncias (45 dias) e strikes (24 horas) têm a regra no próprio modelo.
  const Denuncia = require('../models/Denuncia');
  const Strike = require('../models/Strike');
  assert.deepEqual(COLECOES_COM_REGRA_PROPRIA, ['strikes', 'denuncias']);
  assert.equal(Denuncia.schema.path('dataRetencaoAte'), undefined);
  assert.ok(Strike.schema.indexes().some(([campos, opcoes]) => campos.updatedAt === 1 && opcoes.expireAfterSeconds === 86400));

  // Só o vínculo com o Discord, as notificações e as sugestões ficam no secundário.
  for (const nome of ['Usuario', 'ChavePush', 'InscricaoPush', 'Sugestao']) assert.equal(require(`../models/${nome}`).db, secondaryConnection, nome);
  for (const nome of ['Denuncia', 'DenunciaMensagem', 'ModerationAction', 'Strike', 'Config', 'GlobalConfig', 'StaffProfile', 'AcessoCaso', 'ChatMensagem']) {
    assert.equal(require(`../models/${nome}`).db, primaryConnection, nome);
  }
});

test('teste da staff: valida o que o responsável monta e corrige as respostas', () => {
  const { validarTeste, corrigir } = require('../site/rotas/teste');
  const base = {
    titulo: ' Admissão ', video: 'https://youtu.be/jNQXAC9IVRw?si=x', notaMinima: 70,
    perguntas: [
      { texto: 'Atirar sem interação é?', opcoes: ['VDM', '', 'RDM', 'MG'], correta: 2 },
      { texto: 'Antes de analisar?', opcoes: ['Reivindicar', 'Recusar'], correta: 0 }
    ]
  };

  const teste = validarTeste(base);
  assert.equal(teste.titulo, 'Admissão');
  assert.equal(teste.video, 'jNQXAC9IVRw', 'guarda só o identificador do vídeo');
  // A alternativa vazia sai e a certa continua apontando para "RDM".
  assert.deepEqual(teste.perguntas[0].opcoes, ['VDM', 'RDM', 'MG']);
  assert.equal(teste.perguntas[0].correta, 1);

  assert.throws(() => validarTeste({ ...base, perguntas: [] }), /pelo menos uma pergunta/);
  assert.throws(() => validarTeste({ ...base, video: 'https://exemplo.com/video' }), /YouTube/);
  assert.throws(() => validarTeste({ ...base, perguntas: [{ texto: 'x', opcoes: ['a', 'b'], correta: -1 }] }), /alternativa certa/);
  assert.throws(() => validarTeste({ ...base, perguntas: [{ texto: 'x', opcoes: ['a'], correta: 0 }] }), /duas alternativas/);

  const [p1, p2] = teste.perguntas;
  assert.deepEqual(corrigir(teste, { [p1.id]: 1, [p2.id]: 0 }), { acertos: 2, total: 2, erradas: [], aprovado: true });
  const metade = corrigir(teste, { [p1.id]: 0, [p2.id]: 0 });
  assert.equal(metade.acertos, 1);
  assert.equal(metade.aprovado, false, '50% não chega aos 70%');
  assert.deepEqual(metade.erradas, [p1.id]);
});

test('botões da denúncia: o que já foi feito fica desativado', async () => {
  const { sincronizarBotoes, botoesDesativados } = require('../Handlers/statusDenuncia/botoesStatus');
  assert.deepEqual(botoesDesativados('pendente'), []);
  assert.deepEqual(botoesDesativados('reivindicacao'), ['reivindicar']);
  assert.deepEqual(botoesDesativados('recusada'), ['reivindicar', 'recusar']);

  // Mensagem de botões de mentira, no formato que o discord.js entrega.
  const botao = (customId, disabled = false) => ({ customId, toJSON: () => ({ type: 2, custom_id: customId, disabled }) });
  const criar = (botoes) => {
    const mensagem = {
      components: [{ toJSON: () => ({ type: 1 }), components: botoes }],
      edit: async ({ components }) => {
        mensagem.editada = components[0].components;
        mensagem.components = [{ toJSON: () => ({ type: 1 }), components: mensagem.editada.map(b => botao(b.custom_id, b.disabled)) }];
      }
    };
    return mensagem;
  };
  const desativados = (mensagem) => mensagem.editada.filter(b => b.disabled).map(b => b.custom_id);

  const mensagem = criar(['reivindicar', 'analiser', 'aceitar', 'recusar'].map(id => botao(id)));
  assert.equal(await sincronizarBotoes(null, 'reivindicacao', mensagem), true);
  assert.deepEqual(desativados(mensagem), ['reivindicar']);

  await sincronizarBotoes(null, 'analise', mensagem);
  assert.deepEqual(desativados(mensagem), ['reivindicar', 'analiser']);

  // Recusada: "recusar" trava, "aceitar" continua para uma reanálise, e "analisar" segue travado.
  await sincronizarBotoes(null, 'recusada', mensagem);
  assert.deepEqual(desativados(mensagem), ['reivindicar', 'analiser', 'recusar']);

  // Repetir a mesma situação não edita a mensagem de novo.
  assert.equal(await sincronizarBotoes(null, 'recusada', mensagem), false);
});
