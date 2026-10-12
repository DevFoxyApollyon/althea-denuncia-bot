// Prévia do site com dados de exemplo: sobe só as páginas, sem bot, sem banco
// e sem login. Serve para olhar e ajustar o visual.
//   npm run site:previa  ->  http://localhost:4173
const express = require('express');
const { categoriaDoMotivo, prioridadeDoMotivo, prazoDoSla, configVisivel, PADRAO } = require('./categorias');
const path = require('path');

const PORTA = Number(process.env.PREVIA_PORT) || 4173;
const agora = Date.now();
const horas = (n) => new Date(agora - n * 60 * 60 * 1000).toISOString();

const usuario = { id: '100', nome: 'Rafael Monteiro', avatar: null };
const pessoas = {
  100: { nome: 'Rafael Monteiro 1187', avatar: null, cor: '#e84fd0' },
  200: { nome: '『Mod』 Lucas Prado 259', avatar: '/logo.png', cor: '#5bc0eb' },
  '200000000000000200': { nome: 'Lucas Prado', avatar: '/logo.png' },
  300: { nome: 'Bruno Vidal 2471', avatar: null },
  999: { nome: 'Althea', avatar: null }
};
const papeis = { responsavel: true, administrador: true, staff: true, podeDenunciarPC: true, podeDenunciarMobile: true };

const denuncias = [
  { id: '66f0a1b2c3d4e5f6a7b8c901', acusado: '2471', denunciante: '1187', motivo: 'Anti-RP durante abordagem policial', platform: 'PC', status: 'analise', dataCriacao: horas(2), claimedBy: '200', relacao: 'denunciante' },
  { id: '66f0a1b2c3d4e5f6a7b8c902', acusado: '1039', denunciante: '1187', motivo: 'RDM na praça central', platform: 'PC', status: 'aceita', dataCriacao: horas(27), claimedBy: '200', relacao: 'denunciante' },
  { id: '66f0a1b2c3d4e5f6a7b8c903', acusado: '5580+5581', denunciante: '1187', motivo: 'VDM em área segura', platform: 'Mobile', status: 'recusada', dataCriacao: horas(74), claimedBy: '201', relacao: 'denunciante' },
  { id: '66f0a1b2c3d4e5f6a7b8c904', acusado: '1187', denunciante: '812', motivo: 'Uso de hack (aimbot) em tiroteio', platform: 'Mobile', status: 'pendente', dataCriacao: horas(5), claimedBy: null, relacao: 'acusado' },
  { id: '66f0a1b2c3d4e5f6a7b8c905', acusado: '3310', denunciante: '1187', motivo: 'Uso de bug para duplicar itens', platform: 'PC', status: 'reivindicacao', dataCriacao: horas(1), claimedBy: '100', relacao: 'denunciante' },
  { id: '66f0a1b2c3d4e5f6a7b8c906', acusado: '907', denunciante: '1187', motivo: 'Metagaming em sequestro', platform: 'PC', status: 'finalizada', dataCriacao: horas(240), claimedBy: '201', relacao: 'denunciante' }
].map(item => ({ ...item, categoria: categoriaDoMotivo(item.motivo), prioridade: prioridadeDoMotivo(item.motivo), prazoSla: prazoDoSla(item.motivo, item.dataCriacao), reivindicadaEm: null, ultimaAtividade: item.status === 'analise' ? new Date().toISOString() : item.dataCriacao, guildId: '1', guildNome: 'Brasil RolePlay', aberta: ['pendente', 'reivindicacao', 'analise'].includes(item.status) }));

const mensagem = (id, autorId, autorNome, conteudo, h, extra = {}) => ({
  id, autorId, autorNome, conteudo, dataCriacao: horas(h),
  doBot: false, viaSite: false, editadaEm: null, apagadaEm: null, embeds: [], anexos: [], ...extra
});

const mensagens = [
  mensagem('1', '100', 'Rafael Monteiro', 'Segue o vídeo da abordagem. Aos 0:42 ele sai do carro e atira sem nenhuma interação.\nhttps://youtu.be/jNQXAC9IVRw', 26),
  mensagem('2', '999', 'Althea', '📌 O administrador <@200000000000000200> reivindicou esta denúncia e estará analisando.', 25, { doBot: true }),
  mensagem('3', '300', 'Bruno Vidal 2471', 'Eu tinha avisado no rádio antes, <@200000000000000200>. Vou mandar minha contraprova no <#555555555555555555> <:brp4_emoji_31:833053682077401088>', 24),
  mensagem('4', '300', 'Bruno Vidal 2471', 'mensagem removida pelo autor', 23, { apagadaEm: horas(22) }),
  mensagem('4b', '300', 'Bruno Vidal 2471', '<:brp4_emoji_31:833053682077401088>', 22.9),
  mensagem('4c', '300', 'Bruno Vidal 2471', 'segunda mensagem seguida, sem cabeçalho repetido', 22.8),
  mensagem('5', '200', 'Lucas Prado', 'Recebi as duas versões. Preciso do trecho completo do rádio, do minuto anterior à abordagem.', 3),
  mensagem('6', '999', 'Althea', 'Denúncia colocada em análise por Lucas Prado.', 2.5, { doBot: true }),
  mensagem('7', '100', 'Rafael Monteiro', 'Print do log do rádio no horário da abordagem.', 1, {
    viaSite: true,
    anexos: [{ id: 'a1', nome: 'log-radio.txt', tipo: 'text/plain', tamanho: 2048, url: '#' }]
  })
];

const app = express();
app.use((req, res, next) => {
  // Mesma política do site real, para a prévia acusar o que ela bloquearia.
  res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://i.ytimg.com data: blob:; media-src 'self' blob:; frame-src https://www.youtube-nocookie.com; style-src 'self'; script-src 'self'; worker-src 'self'");
  next();
});

const semLogin = (req) => req.query.entrada !== undefined || req.get('Referer')?.includes('entrada');

app.get('/api/site', (req, res) => res.json({ nome: 'Brasil RolePlay', icone: null }));

app.get('/api/eu', (req, res) => {
  if (semLogin(req)) return res.status(401).json({ erro: 'Entre com sua conta do Discord para continuar.' });
  res.json({ usuario, visaoAdmin: true, servidores: [{ id: '1', nome: 'Brasil RolePlay', icone: null, limiteUploadMb: 9, manutencao: false, categorias: configVisivel('1').categorias, slaHoras: configVisivel('1').slaHoras, respostasProntas: configVisivel('1').respostasProntas, apelido: 'Rafael Monteiro 1187', avatar: null, papeis: req.get('Referer')?.includes('jogador') ? { ...papeis, staff: false, responsavel: false, administrador: false } : papeis },
    { id: '2', nome: '🏆 Brasil Roleplay - 2', icone: null, limiteUploadMb: 9, manutencao: true, categorias: configVisivel('2').categorias, slaHoras: configVisivel('2').slaHoras, respostasProntas: [], apelido: 'Rafael Monteiro 1187', avatar: null, papeis: { podeDenunciarPC: true } }] });
});

app.get('/api/denuncias', (req, res) => {
  const escopo = req.query.escopo;
  if (req.query.vazio !== undefined) return res.json({ denuncias: [] });
  if (escopo === 'fila') return res.json({ denuncias: denuncias.filter(d => d.status === 'pendente').sort((a, b) => (a.prioridade === 'alta' ? 0 : 1) - (b.prioridade === 'alta' ? 0 : 1)) });
  if (escopo === 'admin' || escopo === 'busca') {
    // Mesma ideia do site real: a busca e os filtros valem para a lista inteira.
    const termo = String(req.query.busca || '').toLowerCase();
    const status = { andamento: ['pendente', 'reivindicacao', 'analise'], pendente: ['pendente'], reivindicacao: ['reivindicacao'], analise: ['analise'], aceita: ['aceita'], recusada: ['recusada'], finalizada: ['finalizada'] }[req.query.status];
    const filtrando = Boolean(termo || status || req.query.plataforma || req.query.categoria);
    const achadas = denuncias.filter(d => (!termo || [d.acusado, d.denunciante, d.motivo].some(campo => campo.toLowerCase().includes(termo)))
      && (!status || status.includes(d.status))
      && (!req.query.plataforma || d.platform === req.query.plataforma)
      && (!req.query.categoria || d.categoria === req.query.categoria));
    return res.json({ denuncias: achadas, pagina: filtrando ? 1 : Number(req.query.pagina) || 1, totalPaginas: filtrando ? 1 : 3, total: filtrando ? achadas.length : 214 });
  }
  res.json({ denuncias });
});

app.get('/api/denuncias/:id', (req, res) => {
  const denuncia = denuncias.find(d => d.id === req.params.id);
  if (!denuncia) return res.status(404).json({ erro: 'Denúncia não encontrada.' });
  const decidida = ['aceita', 'finalizada'].includes(denuncia.status);
  res.json({
    denuncia: {
      ...denuncia,
      provas: 'https://youtu.be/jNQXAC9IVRw\nPrints enviados no tópico.',
      punicao: null,
      motivoAceite: decidida ? 'Anti-RP: 3 dias de banimento' : null,
      dataPunicao: decidida ? '08/10/2026' : null,
      responsavel: denuncia.claimedBy ? 'Lucas Prado' : null,
      linkDiscord: 'https://discord.com/channels/1/2/3'
    },
    mensagens: denuncia.status === 'pendente' ? [] : mensagens,
    pessoas,
    notas: [{ id: 'n1', autorId: '200', texto: 'Acusado já foi advertido por algo parecido no mês passado.', criadaEm: horas(2) }],
    auditoria: [{ acao: 'reivindicacao', autorId: '200', data: horas(25) }, { acao: 'analise', autorId: '200', data: horas(2.5) }],
    historicoAcusado: { total: 3, aceitas: 2, recusadas: 1, casos: [
      { id: denuncias[1].id, acusado: '2471', motivo: 'RDM na praça central', status: 'aceita', dataCriacao: horas(300) },
      { id: denuncias[3].id, acusado: '2471', motivo: 'Uso de hack (aimbot) em tiroteio', status: 'pendente', dataCriacao: horas(5) },
      { id: denuncias[4].id, acusado: '2471', motivo: 'Uso de bug para duplicar itens', status: 'reivindicacao', dataCriacao: horas(1) },
      { id: denuncias[2].id, acusado: '2471', motivo: 'VDM em área segura', status: 'recusada', dataCriacao: horas(500) }
    ] },
    acessos: [{ usuarioId: '100', relacao: 'denunciante', em: horas(1) }, { usuarioId: '300', relacao: 'acusado', em: horas(20) }],
    avaliacao: denuncia.status === 'aceita' ? { enviada: false, podeAvaliar: true } : { enviada: false, podeAvaliar: false },
    cargos: {},
    canais: { '555555555555555555': 'contraprovas' },
    papeis,
    limiteUploadMb: 9
  });
});

app.get('/api/denuncias/:id/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  res.write(`event: presenca\ndata: ${JSON.stringify({ nomes: ['Marina Costa'] })}\n\n`);
});

const sugestoes = [
  { id: 's1', autorId: '100', texto: 'Criar um horário fixo de eventos de corrida aos sábados, com premiação em dinheiro do jogo.', status: 'analise', resposta: 'Boa ideia, estamos vendo com a equipe de eventos.', respondidaPor: '200', respondidaEm: horas(3), criadaEm: horas(30) },
  { id: 's2', autorId: '300', texto: 'Aumentar o tempo de resposta do acusado para 48 horas nas denúncias de fim de semana.', status: 'nova', resposta: '', respondidaPor: null, respondidaEm: null, criadaEm: horas(5) }
];
app.get('/api/sugestoes', (req, res) => res.json({ pessoas, sugestoes: req.query.escopo === 'staff' ? sugestoes : sugestoes.filter(s => s.autorId === '100') }));
app.post('/api/sugestoes', (req, res) => res.status(201).json({ ok: true, mensagem: 'Sugestão enviada (prévia, nada foi salvo).' }));
app.post('/api/sugestoes/:id/resposta', (req, res) => res.json({ ok: true, mensagem: 'Sugestão atualizada (prévia).' }));

app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
});

app.get('/api/nao-identificadas', (req, res) => res.json({ minhaConta: '1187', denuncias: [
  { id: denuncias[3].id, acusado: '1187', categoria: 'Hack', platform: 'Mobile', status: 'pendente', dataCriacao: horas(5), ehVoce: true },
  { id: denuncias[4].id, acusado: '3310+3311', categoria: 'Abuso de bug', platform: 'PC', status: 'analise', dataCriacao: horas(9), ehVoce: false }
] }));

app.get('/api/duplicadas', (req, res) => res.json(String(req.query.acusado || '').includes('2471')
  ? { total: 1, suas: 1, categorias: ['Anti-RP'] }
  : { total: 0, suas: 0, categorias: [] }));
// Testes da staff (dados de exemplo): vários por servidor, cada um com os seus resultados.
const testesDaStaff = [
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaa1', titulo: 'Teste de admissão da staff', instrucoes: 'Assista ao vídeo inteiro antes de responder. Você pode refazer o teste.', video: 'jNQXAC9IVRw', notaMinima: 70, ativo: true,
    perguntas: [
      { id: 'aaaa0001', texto: 'Um jogador atira em outro sem nenhuma interação antes. Qual é a infração?', video: '', opcoes: ['VDM', 'RDM', 'Metagaming', 'Combat log'], correta: 1 },
      { id: 'aaaa0002', texto: 'O que fazer antes de analisar uma denúncia da fila?', video: '', opcoes: ['Reivindicar o caso', 'Recusar direto', 'Pedir para outro staff'], correta: 0 },
      { id: 'aaaa0003', texto: 'Prova em vídeo com 5 segundos, sem contexto. O que fazer?', video: '', opcoes: ['Aceitar', 'Pedir o vídeo completo', 'Banir o denunciante'], correta: 1 }
    ],
    resultados: [{ usuarioId: '200', acertos: 3, total: 3, aprovado: true, erradas: [], em: horas(30), tentativas: 2 }, { usuarioId: '300', acertos: 1, total: 3, aprovado: false, erradas: ['aaaa0001', 'aaaa0003'], em: horas(5), tentativas: 1 }],
    ultima: { acertos: 3, total: 3, aprovado: true, erradas: [], em: horas(50) }
  },
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaa2', titulo: 'Análise de vídeos: abordagem policial', instrucoes: 'Cada pergunta tem a sua cena. Assista e diga o que aconteceu.', video: '', notaMinima: 60, ativo: true,
    perguntas: [
      { id: 'bbbb0001', texto: 'Nesta cena, o que o jogador fez de errado?', video: 'jNQXAC9IVRw', opcoes: ['Anti-RP', 'Nada', 'Combat log'], correta: 0 },
      { id: 'bbbb0002', texto: 'E nesta segunda cena?', video: 'dQw4w9WgXcQ', opcoes: ['RDM', 'VDM', 'Está dentro das regras'], correta: 2 }
    ],
    resultados: [],
    ultima: null
  },
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaa3', titulo: 'Reciclagem trimestral', instrucoes: '', video: '', notaMinima: 80, ativo: false,
    perguntas: [{ id: 'cccc0001', texto: 'Pergunta em rascunho', video: '', opcoes: ['Sim', 'Não'], correta: 0 }],
    resultados: [],
    ultima: null
  }
];
const videoDaPrevia = (valor) => /([A-Za-z0-9_-]{11})(?:[?&]|$)/.exec(String(valor || ''))?.[1] || '';
const acharTeste = (id) => testesDaStaff.find(teste => teste.id === id);

app.get('/api/teste/admin', (req, res) => res.json({ limite: 30, testes: testesDaStaff.map(teste => ({
  id: teste.id, titulo: teste.titulo, ativo: teste.ativo, perguntas: teste.perguntas.length, notaMinima: teste.notaMinima,
  comVideo: teste.perguntas.filter(pergunta => pergunta.video).length + (teste.video ? 1 : 0),
  responderam: teste.resultados.length, aprovados: teste.resultados.filter(item => item.aprovado).length, atualizadoEm: horas(40)
})) }));
app.get('/api/teste/admin/:id', (req, res) => {
  const teste = acharTeste(req.params.id);
  if (!teste) return res.status(404).json({ erro: 'Teste não encontrado.' });
  const { resultados, ultima, ...dados } = teste;
  res.json({ teste: dados, resultados, pessoas });
});
app.post('/api/teste/admin', express.json(), (req, res) => {
  // Na prévia não há validação completa: só guarda o que veio, trocando os links pelos identificadores dos vídeos.
  const enviado = req.body?.teste || {};
  if (!String(enviado.titulo || '').trim()) return res.status(400).json({ erro: 'Dê um título ao teste.' });
  if (!enviado.perguntas?.length) return res.status(400).json({ erro: 'Adicione pelo menos uma pergunta.' });
  const dados = { ...enviado, video: videoDaPrevia(enviado.video), perguntas: enviado.perguntas.map((p, i) => ({ ...p, id: p.id || `nova${Date.now()}${i}`, video: videoDaPrevia(p.video) })) };
  const atual = acharTeste(req.body?.id);
  if (atual) {
    Object.assign(atual, dados, { id: atual.id });
    return res.json({ ok: true, id: atual.id, mensagem: 'Teste salvo (prévia).' });
  }
  const id = `bbbbbbbbbbbbbbbbbbbbbb${String(testesDaStaff.length).padStart(2, '0')}`;
  testesDaStaff.push({ ...dados, id, resultados: [], ultima: null });
  res.status(201).json({ ok: true, id, mensagem: 'Teste criado (prévia).' });
});
app.delete('/api/teste/admin/:id', (req, res) => {
  const indice = testesDaStaff.findIndex(teste => teste.id === req.params.id);
  if (indice >= 0) testesDaStaff.splice(indice, 1);
  res.json({ ok: true, mensagem: 'Teste apagado (prévia).' });
});
app.get('/api/teste', (req, res) => res.json({ testes: testesDaStaff.filter(teste => teste.ativo).map(teste => ({
  id: teste.id, titulo: teste.titulo, instrucoes: teste.instrucoes, perguntas: teste.perguntas.length, notaMinima: teste.notaMinima,
  comVideo: Boolean(teste.video) || teste.perguntas.some(pergunta => pergunta.video), ultima: teste.ultima
})) }));
app.get('/api/teste/:id', (req, res) => {
  const teste = acharTeste(req.params.id);
  if (!teste) return res.status(404).json({ erro: 'Teste não encontrado.' });
  res.json({ id: teste.id, titulo: teste.titulo, instrucoes: teste.instrucoes, video: teste.video, notaMinima: teste.notaMinima, perguntas: teste.perguntas.map(({ id, texto, video, opcoes }) => ({ id, texto, video, opcoes })), ultima: teste.ultima });
});
app.post('/api/teste/:id/respostas', express.json(), (req, res) => {
  const teste = acharTeste(req.params.id);
  if (!teste) return res.status(404).json({ erro: 'Teste não encontrado.' });
  const erradas = teste.perguntas.filter(p => Number(req.body?.respostas?.[p.id]) !== p.correta).map(p => p.id);
  const total = teste.perguntas.length;
  teste.ultima = { acertos: total - erradas.length, total, erradas, aprovado: ((total - erradas.length) / total) * 100 >= teste.notaMinima, em: new Date().toISOString() };
  res.status(201).json({ ok: true, resultado: teste.ultima });
});

const avisosDoSite = [{ id: 'av1', texto: 'Manutenção do servidor hoje às 23h. As denúncias voltam em seguida.', tipo: 'atencao', criadoEm: horas(2), expiraEm: null, por: 'Rafael Monteiro 1187' }];
app.get('/api/avisos', (req, res) => res.json({ avisos: avisosDoSite }));
app.post('/api/avisos', express.json(), (req, res) => {
  const horasNoAr = Number(req.body?.horas || 0);
  avisosDoSite.unshift({ id: `av${Date.now()}`, texto: String(req.body?.texto || ''), tipo: req.body?.tipo || 'info', criadoEm: new Date().toISOString(), expiraEm: horasNoAr ? new Date(Date.now() + horasNoAr * 3600000).toISOString() : null, por: 'Rafael Monteiro 1187' });
  res.status(201).json({ ok: true, mensagem: 'Aviso publicado (prévia).' });
});
app.delete('/api/avisos/:id', (req, res) => {
  avisosDoSite.splice(avisosDoSite.findIndex(item => item.id === req.params.id), 1);
  res.json({ ok: true });
});

const painelDoBot = {
  valores: {
    channels: { pc: '11', mobile: '12', logs: '13', log: '14', analysis: '', topDaily: '15', backup: '', armazem: '900000000000000001', registro: '900000000000000002', cloud: '900000000000000003', canalDenuncia: '' },
    roles: { pc: '21', permitido: '22', administrador: '23', responsavel_admin: '24' },
    manutencao: false,
    bloqueio: true,
    isentos: [{ id: '200000000000000200', nome: 'Lucas Prado' }]
  },
  canais: [
    { id: '11', nome: 'denuncias-pc', categoria: 'Denúncias' }, { id: '12', nome: 'denuncias-mobile', categoria: 'Denúncias' },
    { id: '13', nome: 'cadeia-staff', categoria: 'Staff' }, { id: '14', nome: 'log-admin', categoria: 'Staff' }, { id: '15', nome: 'top-diario', categoria: 'Staff' },
    { id: '16', nome: 'geral', categoria: '' }
  ],
  cargos: [{ id: '24', nome: 'Responsável', cor: '#e84fd0' }, { id: '23', nome: 'Administrador', cor: '#5bc0eb' }, { id: '21', nome: 'Autenticado PC' }, { id: '22', nome: 'Autenticado Mobile' }],
  externos: { registro: '#registro em Althea Cloud', cloud: '#cloud em Althea Cloud', canalDenuncia: null },
  atualizado: { em: horas(30), por: 'rafael (site)' }
};
app.get('/api/painel-bot', (req, res) => res.json(painelDoBot));

// Ferramentas do responsável (dados de exemplo).
const limpezaDeTopicos = { rodando: false, fechados: 0, previstos: 0, terminouEm: null };
const topicos = [
  { id: '9', nome: 'Althea Cloud', ativos: 962, limite: 1000, deDenuncias: 940, antigos: 310 },
  { id: '1', nome: 'Brasil RolePlay', ativos: 412, limite: 1000, deDenuncias: 380, antigos: 12 },
  { id: '2', nome: 'Brasil Roleplay - 2', ativos: 88, limite: 1000, deDenuncias: 70, antigos: 0 }
];
app.get('/api/saude', (req, res) => res.json({
  versao: '3.8.0', node: process.version, ligadoHaMs: 2 * 86400000 + 5 * 3600000,
  memoria: { usadaMb: 186, heapMb: 52 },
  discord: { conectado: true, latenciaMs: 84, servidores: 4 },
  bancos: [{ nome: 'Principal', estado: 'conectado' }, { nome: 'Secundário', estado: 'conectado' }],
  finalizador: { naFila: 37, abertas: 214 },
  dms: { pausadaAte: new Date(Date.now() + 3 * 3600000), avisosExtras: false },
  agora: new Date()
}));
app.get('/api/topicos', (req, res) => res.json({ servidores: topicos, conferidoEm: new Date(), limpeza: limpezaDeTopicos }));
app.post('/api/topicos/limpar', express.json(), (req, res) => {
  Object.assign(limpezaDeTopicos, { rodando: true, fechados: 0, previstos: 322 });
  const passo = setInterval(() => {
    limpezaDeTopicos.fechados = Math.min(322, limpezaDeTopicos.fechados + 120);
    if (limpezaDeTopicos.fechados >= 322) {
      clearInterval(passo);
      limpezaDeTopicos.rodando = false;
      topicos[0].ativos -= 310; topicos[0].antigos = 0; topicos[1].ativos -= 12; topicos[1].antigos = 0;
    }
  }, 4000);
  res.json({ ok: true, mensagem: 'Limpeza iniciada. Só os tópicos abertos há 7 dias ou mais são fechados.' });
});
app.get('/api/logins', (req, res) => res.json({ pessoas: {}, logins: [
  { usuarioId: '100', nome: 'Rafael Monteiro 1187', ip: '189.45.210.17', agente: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0', em: horas(0.2) },
  { usuarioId: '200', nome: '『Mod』 Lucas Prado 259', ip: '177.92.14.203', agente: 'Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile', em: horas(3) },
  { usuarioId: '300', nome: 'Bruno Vidal 2471', ip: '177.92.14.203', agente: 'Mozilla/5.0 (Windows NT 10.0) Firefox/143.0', em: horas(9) },
  { usuarioId: '100', nome: 'Rafael Monteiro 1187', ip: '2804:14c:5b:8a01::1f3', agente: 'Mozilla/5.0 (iPhone) Safari/605', em: horas(30) }
] }));
const metas = { minimoSemanal: 10 };
const linhasDasMetas = () => [
  { id: '201', nome: 'Marina Costa 88', atendimentos: 2, naEquipe: true },
  { id: '200', nome: '『Mod』 Lucas Prado 259', atendimentos: 7, naEquipe: true },
  { id: '202', nome: 'Diego Ramos 431', atendimentos: 4, naEquipe: false },
  { id: '100', nome: 'Rafael Monteiro 1187', atendimentos: 23, naEquipe: true }
].map(linha => ({ ...linha, avatar: null, faltam: Math.max(0, metas.minimoSemanal - linha.atendimentos) }));
const respostaDasMetas = () => {
  const linhas = linhasDasMetas();
  return { minimoSemanal: metas.minimoSemanal, linhas, desde: horas(168), abaixo: metas.minimoSemanal ? linhas.filter(linha => linha.naEquipe && linha.faltam > 0).length : 0 };
};
app.get('/api/metas', (req, res) => res.json(respostaDasMetas()));
app.post('/api/metas', express.json(), (req, res) => {
  metas.minimoSemanal = Number(req.body.minimoSemanal) || 0;
  res.json({ ok: true, mensagem: 'Meta salva (prévia, nada foi gravado).', ...respostaDasMetas() });
});
app.get('/api/backup', (req, res) => res.json({
  tipo: 'althea-backup', versao: 1, geradoEm: new Date(), servidor: { id: '1', nome: 'Brasil RolePlay' },
  painelBot: { channels: painelDoBot.valores.channels, roles: painelDoBot.valores.roles, manutencao: painelDoBot.valores.manutencao, bloqueio: painelDoBot.valores.bloqueio },
  configSite: null, minimoSemanal: metas.minimoSemanal
}));
app.post('/api/backup', express.json(), (req, res) => {
  if (req.body?.backup?.tipo !== 'althea-backup') return res.status(400).json({ erro: 'Este arquivo não é um backup do Althea.' });
  res.json({ ok: true, mensagem: 'Backup restaurado (prévia, nada foi gravado).' });
});
app.post('/api/painel-bot', express.json(), (req, res) => {
  Object.assign(painelDoBot.valores, { channels: req.body.channels, roles: req.body.roles, manutencao: req.body.manutencao === true, bloqueio: req.body.bloqueio !== false });
  res.json({ ok: true, mensagem: 'Painel do bot salvo (prévia, nada foi gravado).', ...painelDoBot });
});

app.get('/api/config-site', (req, res) => res.json({ config: configVisivel('1'), padrao: PADRAO }));
app.post('/api/config-site', express.json(), (req, res) => res.json({ ok: true, mensagem: 'Configurações salvas (prévia, nada foi gravado).', config: configVisivel('1') }));

const casoDoPerfil = (d, resultado) => ({ id: d.id, acusado: d.acusado, denunciante: d.denunciante, motivo: d.motivo, categoria: d.categoria, platform: d.platform, status: d.status, resultado, dataCriacao: d.dataCriacao });
app.get('/api/jogadores/:conta', (req, res) => res.json({
  conta: req.params.conta,
  chat: { castigos: 2, banimentos: 0, itens: [
    { acao: 'castigo', motivo: 'Flood no chat (castigo automático)', minutos: 30, em: horas(20), por: 'Althea' },
    { acao: 'castigo', motivo: 'Ofensa a outro jogador', minutos: 120, em: horas(200), por: 'Lucas Prado' }
  ] },
  contasDiscord: [{ id: '300', ...pessoas[300], cor: '#5bc0eb' }],
  recebidas: {
    total: 4, aceitas: 2, recusadas: 1, andamento: 1, finalizadas: 0, taxaDeAceitas: 0.67,
    porCategoria: [{ nome: 'Anti-RP', total: 2 }, { nome: 'RDM', total: 1 }, { nome: 'Outros', total: 1 }],
    casos: [casoDoPerfil(denuncias[0], 'andamento'), casoDoPerfil(denuncias[1], 'aceita'), casoDoPerfil(denuncias[5], 'aceita'), casoDoPerfil(denuncias[2], 'recusada')]
  },
  feitas: {
    total: 3, aceitas: 1, recusadas: 1, andamento: 1, finalizadas: 0, taxaDeAceitas: 0.5, porCategoria: [],
    casos: [casoDoPerfil(denuncias[3], 'andamento'), casoDoPerfil(denuncias[1], 'aceita'), casoDoPerfil(denuncias[2], 'recusada')]
  },
  punicoes: [
    { id: denuncias[1].id, motivo: denuncias[1].motivo, categoria: 'RDM', punicao: 'RDM: 3 dias de banimento', dataPunicao: '08/10/2026', dataCriacao: denuncias[1].dataCriacao },
    { id: denuncias[5].id, motivo: denuncias[5].motivo, categoria: 'Metagaming', punicao: 'Metagaming: advertência', dataPunicao: '30/09/2026', dataCriacao: denuncias[5].dataCriacao }
  ]
}));

const chat = [
  { id: 'a1', autorId: '200', autorNome: 'Lucas Prado', canal: 'avisos', texto: 'Manutenção do servidor hoje às 23h. O chat continua aberto.', criadaEm: horas(5) },
  { id: 'c1', autorId: '300', autorNome: 'Bruno Vidal 2471', texto: 'Alguém sabe se o evento de corrida de sábado está confirmado?', reacoes: { '👍': ['200', '300'] }, criadaEm: horas(3) },
  { id: 'c2', autorId: '200', autorNome: 'Lucas Prado', texto: 'Confirmado, às 20h. Detalhes em https://discord.com/channels/1/2', criadaEm: horas(2.9) },
  { id: 'c3', autorId: '100', autorNome: 'Rafael Monteiro', texto: 'Boa, vou participar.', criadaEm: horas(0.2) },
  { id: 'c4', autorId: '200', autorNome: 'Lucas Prado', texto: '<@100> você vai de qual carro?', mencoes: ['100'], criadaEm: horas(0.1) }
];
app.get('/api/chat/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.flushHeaders();
});
const sala = { modoLentoSeg: 0, fechado: false };
const sinalizadas = [{ id: 'z1', mensagemId: 'c1', autorId: '300', trecho: 'Alguém sabe se o evento de corrida de sábado está confirmado?', por: '200', motivo: 'Fora do assunto', em: horas(1) }];
const doCanal = (canal) => chat.filter(item => (item.canal || 'geral') === canal).map(item => ({ mencoes: [], todos: false, resposta: null, canal: 'geral', ...item,
  reacoes: Object.entries(item.reacoes || {}).filter(([, usuarios]) => usuarios.length).map(([emoji, usuarios]) => ({ emoji, total: usuarios.length, minha: usuarios.includes('100') })) }));
app.post('/api/chat/:id/reacoes', express.json(), (req, res) => {
  const mensagem = chat.find(item => item.id === req.params.id);
  mensagem.reacoes ||= {};
  const usuarios = mensagem.reacoes[req.body.emoji] ||= [];
  if (usuarios.includes('100')) usuarios.splice(usuarios.indexOf('100'), 1); else usuarios.push('100');
  res.json({ ok: true });
});
app.post('/api/chat/:id/sinalizar', express.json(), (req, res) => res.status(201).json({ ok: true, mensagem: 'Mensagem enviada para a staff analisar.' }));
app.get('/api/chat/sinalizacoes', (req, res) => res.json({ sinalizacoes: sinalizadas, pessoas }));
app.post('/api/chat/sinalizacoes/:id/resolver', express.json(), (req, res) => {
  sinalizadas.splice(sinalizadas.findIndex(item => item.id === req.params.id), 1);
  res.json({ ok: true });
});
app.post('/api/chat/config', express.json(), (req, res) => {
  Object.assign(sala, req.body.modoLentoSeg !== undefined ? { modoLentoSeg: req.body.modoLentoSeg } : {}, req.body.fechado !== undefined ? { fechado: req.body.fechado } : {});
  res.json({ ok: true, mensagem: 'Chat atualizado (prévia).' });
});
app.get('/api/chat', (req, res) => res.json({ mensagens: doCanal(req.query.canal === 'avisos' ? 'avisos' : 'geral'), canal: req.query.canal === 'avisos' ? 'avisos' : 'geral', sala,
  online: [{ id: '100', nome: 'Rafael Monteiro 1187', staff: true }, { id: '200', nome: '『Mod』 Lucas Prado 259', staff: true }, { id: '300', nome: 'Bruno Vidal 2471', staff: false }],
  emojis: ['👍', '❤️', '😂', '😮', '✅', '❌'], modosLentos: [0, 5, 10, 30, 60, 300], sinalizadas: sinalizadas.length, prazoApagarMin: 5, pessoas, banido: null, banidos, fixada, limiteArquivoMb: 20, podeApagar: !req.get('Referer')?.includes('jogador') }));
app.post('/api/chat', express.json(), (req, res) => {
  chat.push({ id: `c${chat.length + 1}`, autorId: '100', autorNome: 'Rafael Monteiro', texto: String(req.body?.texto || ''), canal: req.body?.canal === 'avisos' ? 'avisos' : 'geral',
    resposta: chat.filter(item => item.id === req.body?.respostaA).map(item => ({ id: item.id, autorId: item.autorId, autorNome: item.autorNome, trecho: item.texto.slice(0, 120) }))[0] || null,
    mencoes: [], todos: /(^|\s)@(all|todos)(?![\w])/i.test(String(req.body?.texto || '')), criadaEm: new Date().toISOString() });
  res.status(201).json({ ok: true });
});
app.post('/api/chat/arquivos', express.raw({ type: () => true, limit: '21mb' }), (req, res) => {
  chat.push({ id: `c${chat.length + 1}`, autorId: '100', autorNome: 'Rafael Monteiro', texto: '', criadaEm: new Date().toISOString(), anexo: { nome: 'logo.png', tipo: 'image/png', tamanho: 1, url: '/logo.png' } });
  res.status(201).json({ ok: true });
});
const banidos = [];
let fixada = { texto: 'Evento de corrida no sábado, às 20h. Regras do chat: sem flood e sem ofensa.', autorId: '200', fixadaPor: '200', em: horas(6) };
app.get('/api/chat/novas', (req, res) => res.json({ total: 3, mencoes: 1 }));
app.post('/api/chat/fixada', express.json(), (req, res) => {
  const mensagem = chat.find(item => item.id === req.body?.mensagemId);
  fixada = { texto: mensagem?.texto || '', autorId: mensagem?.autorId || '100', fixadaPor: '100', em: new Date().toISOString() };
  res.status(201).json({ ok: true });
});
app.delete('/api/chat/fixada', (req, res) => {
  fixada = null;
  res.json({ ok: true });
});
const moderacao = [{ staffId: '200', alvoId: '300', acao: 'apagar', motivo: '', minutos: null, trecho: 'mensagem ofensiva de exemplo', em: horas(4) }];
app.post('/api/chat/banimentos', express.json(), (req, res) => {
  const minutos = req.body?.minutos;
  moderacao.unshift({ staffId: '100', alvoId: String(req.body?.usuarioId), acao: minutos ? 'castigo' : 'banimento', motivo: String(req.body?.motivo || ''), minutos: minutos || null, trecho: '', em: new Date().toISOString() });
  banidos.push({ usuarioId: String(req.body?.usuarioId), banidoPor: '100', motivo: String(req.body?.motivo || ''), criadoEm: new Date().toISOString(), expiraEm: minutos ? new Date(Date.now() + minutos * 60000).toISOString() : null });
  res.status(201).json({ ok: true });
});
app.delete('/api/chat/banimentos/:usuarioId', (req, res) => {
  banidos.splice(banidos.findIndex(item => item.usuarioId === req.params.usuarioId), 1);
  res.json({ ok: true });
});
app.delete('/api/chat/:id', (req, res) => {
  chat.splice(chat.findIndex(item => item.id === req.params.id), 1);
  res.json({ ok: true, mensagem: 'Mensagem apagada.' });
});

// Na prévia não há envio de notificações: a chave vem vazia.
app.get('/api/push/chave', (req, res) => res.json({ chave: null }));
app.post('/api/push/inscricao', (req, res) => res.status(201).json({ ok: true }));
app.delete('/api/push/inscricao', (req, res) => res.json({ ok: true }));

app.get('/api/auditoria', (req, res) => res.json({ pessoas, chat: moderacao, acessosAbertos: [
  { usuarioId: '300', em: horas(0.3), caso: { id: denuncias[3].id, acusado: '1187', motivo: denuncias[3].motivo, status: 'pendente' } }
], acoes: [
  { autorId: '200', acao: 'analise', data: horas(0.5), caso: { id: denuncias[0].id, acusado: '2471', motivo: denuncias[0].motivo, status: 'analise' } },
  { autorId: '200', acao: 'reivindicacao', data: horas(2), caso: { id: denuncias[0].id, acusado: '2471', motivo: denuncias[0].motivo, status: 'analise' } },
  { autorId: '100', acao: 'aceita', data: horas(26), caso: { id: denuncias[1].id, acusado: '1039', motivo: denuncias[1].motivo, status: 'aceita' } },
  { autorId: '200', acao: 'recusada', data: horas(70), caso: null }
] }));

app.get('/api/numeros', (req, res) => {
  const dias = Number(req.query.dias) || 30;
  const porDia = Array.from({ length: dias }, (_, i) => {
    const dia = new Date(Date.now() - (dias - 1 - i) * 86400000);
    return { dia: dia.toISOString().slice(0, 10), total: [3, 7, 4, 0, 9, 12, 5, 6, 2, 8][i % 10] };
  });
  res.json({
    dias, total: porDia.reduce((s, d) => s + d.total, 0), porDia,
    porCategoria: [['Anti-RP', 41], ['RDM', 33], ['Zaralho', 21], ['VDM', 18], ['Slide', 9], ['Outros', 7]].map(([nome, total]) => ({ nome, total })),
    porStatus: { pendente: 6, reivindicacao: 3, analise: 4, aceita: 58, recusada: 31, finalizada: 27 },
    taxaDeAceite: 0.65, minutosAteReivindicar: 37, notaMedia: 8.4, avaliacoes: 27, slaCumprido: 0.82, foraDoPrazo: 2
  });
});

app.get('/api/ranking', (req, res) => res.json({ periodo: req.query.periodo || 'mes', hoje: { total: 12, pendentes: 4 }, totais: { aceitas: 34, recusadas: 19, analises: 15, reivindicacoes: 20 }, qualidade: { media: 8.4, avaliacoes: 27 }, staff: [
  { id: '200', nome: '『Mod』 Lucas Prado 259', avatar: '/logo.png', cor: '#5bc0eb', total: 48, aceitas: 19, recusadas: 11, analises: 8, reivindicacoes: 10, qualidade: { media: 9.1, avaliacoes: 16 }, minutosAteReivindicar: 14 },
  { id: '201', nome: 'Marina Costa', avatar: null, cor: '#f2c94c', total: 31, aceitas: 12, recusadas: 6, analises: 5, reivindicacoes: 8, minutosAteReivindicar: 95 },
  { id: '202', nome: 'Diego Ramos', avatar: null, cor: null, total: 9, aceitas: 3, recusadas: 2, analises: 2, reivindicacoes: 2, minutosAteReivindicar: null }
] }));

app.post('/api/denuncias/:id/:acao', (req, res) => res.json({ ok: true, mensagem: 'Ação concluída (prévia, nada foi enviado).' }));
app.post('/api/denuncias', (req, res) => res.status(201).json({ ok: true, id: denuncias[0].id }));
app.post('/auth/sair', (req, res) => res.json({ ok: true }));
app.get('/auth/entrar', (req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORTA, () => console.log(`Prévia do site em http://localhost:${PORTA} (tela de login: /?entrada)`));
