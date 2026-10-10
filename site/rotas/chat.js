// Chat do site: uma sala por servidor, para quem é membro dele. A staff e o
// responsável podem apagar qualquer mensagem.
const express = require('express');
const mongoose = require('mongoose');
const ChatMensagem = require('../../models/ChatMensagem');
const ChatBanimento = require('../../models/ChatBanimento');
const ChatModeracao = require('../../models/ChatModeracao');
const ChatFixada = require('../../models/ChatFixada');
const InscricaoPush = require('../../models/InscricaoPush');
const { avisarMudanca, ouvirMudancas } = require('../../utils/eventosDenuncia');
const { contemPalavraProibida, contemLinkProibido } = require('../../utils/strikeWords');
const { primaryConnection } = require('../../utils/persistencia');
const { adicionarMeses } = require('../../utils/retencaoDados');
const { acessoAoServidor } = require('../acesso');
const { enviarPush } = require('../push');
const ChatSinalizacao = require('../../models/ChatSinalizacao');
const { lerSala, serializarReacoes, entrarNaPresenca, quemEstaOnline, EMOJIS, MODOS_LENTOS_SEG } = require('./chatSala');
const path = require('path');
const { resolverPessoas, extrairMencoes, conexoesPorUsuario, conteudoCombinaComExtensao, ErroHttp, assincrono, criarLimitador } = require('./comum');

const LIMITE_TEXTO = 500;
const MENSAGENS_NA_TELA = 100;
const canalDoChat = (guildId) => `chat:${guildId}`;
// Castigo: de 1 minuto a 30 dias. Sem tempo, é banimento.
const CASTIGO_MAXIMO_MIN = 30 * 24 * 60;
const emVigor = (item) => !item.expiraEm || new Date(item.expiraEm).getTime() > Date.now();
const horario = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
// Os arquivos do chat ficam no banco de dados, então o limite é menor que o das
// denúncias (que vão para o Discord). Somem junto com a mensagem, em 30 dias.
const LIMITE_ARQUIVO_BYTES = 20 * 1024 * 1024;
const INTERVALO_LIMPEZA_ARQUIVOS_MS = 24 * 60 * 60 * 1000;
const TIPOS_DE_ARQUIVO = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav'
};

// Flood: muitas mensagens em poucos segundos, ou a mesma mensagem repetida.
// Quem faz isso leva um castigo curto sozinho; reincidir no mesmo dia aumenta.
const FLOOD = { mensagens: 5, emMs: 8 * 1000, repetidas: 3, repetidasEmMs: 60 * 1000 };
const CASTIGOS_POR_FLOOD_MIN = [5, 30, 120];
const MAX_MENCOES = 5;
// Por quanto tempo a pessoa ainda pode apagar a própria mensagem.
const PRAZO_APAGAR_PROPRIA_MS = 5 * 60 * 1000;
const ultimaFala = new Map();
const recentesPorPessoa = new Map();

function ehFlood(chave, texto, agora = Date.now()) {
  const recentes = (recentesPorPessoa.get(chave) || []).filter(item => agora - item.em < FLOOD.repetidasEmMs);
  recentes.push({ em: agora, texto: texto.toLowerCase() });
  if (recentesPorPessoa.size > 5000) recentesPorPessoa.clear();
  recentesPorPessoa.set(chave, recentes);

  const rapidas = recentes.filter(item => agora - item.em < FLOOD.emMs).length;
  const ultimas = recentes.slice(-FLOOD.repetidas);
  const repetiu = Boolean(texto) && ultimas.length === FLOOD.repetidas && ultimas.every(item => item.texto === ultimas[0].texto);
  return rapidas >= FLOOD.mensagens || repetiu;
}

const arquivosDoChat = () => new mongoose.mongo.GridFSBucket(primaryConnection.db, { bucketName: 'chatArquivos' });

function guardarArquivo(dados, nome, guildId) {
  return new Promise((resolve, reject) => {
    const envio = arquivosDoChat().openUploadStream(nome, {
      metadata: { guildId, dataRetencaoAte: adicionarMeses(new Date()) }
    });
    envio.once('error', reject);
    envio.once('finish', () => resolve(envio.id));
    envio.end(dados);
  });
}

// O GridFS precisa apagar o arquivo pelo bucket para remover também seus chunks.
async function limparArquivosAntigos() {
  const bucket = arquivosDoChat();
  const vencidos = await bucket.find({
    $or: [
      { dataRetencaoAte: { $lte: new Date() } },
      { 'metadata.dataRetencaoAte': { $lte: new Date() } }
    ]
  }).limit(100).toArray();
  for (const arquivo of vencidos) await bucket.delete(arquivo._id);
}

function serializar(item, guildId, usuarioId) {
  return {
    id: String(item._id),
    autorId: item.autorId,
    autorNome: item.autorNome,
    texto: item.texto || '',
    mencoes: item.mencoes || [],
    todos: Boolean(item.todos),
    canal: item.canal === 'avisos' ? 'avisos' : 'geral',
    resposta: item.resposta?.id ? { id: item.resposta.id, autorId: item.resposta.autorId, autorNome: item.resposta.autorNome, trecho: item.resposta.trecho } : null,
    reacoes: serializarReacoes(item.reacoes, usuarioId),
    criadaEm: item.criadaEm,
    anexo: item.anexo?.arquivoId ? {
      nome: item.anexo.nome,
      tipo: item.anexo.tipo,
      tamanho: item.anexo.tamanho,
      url: `/api/chat/arquivos/${item.anexo.arquivoId}?${new URLSearchParams({ guildId })}`
    } : null
  };
}

// Tudo o que a staff faz no chat fica registrado para a auditoria.
const registrarModeracao = (dados) => ChatModeracao.create(dados).catch(() => {});

function registrarRotasDoChat(router, { client }) {
  limparArquivosAntigos().catch(error => console.error('[Chat] Falha ao limpar anexos vencidos:', error));
  const agendamentoLimpeza = setInterval(() => {
    limparArquivosAntigos().catch(error => console.error('[Chat] Falha ao limpar anexos vencidos:', error));
  }, INTERVALO_LIMPEZA_ARQUIVOS_MS);
  agendamentoLimpeza.unref();

  const podeFalar = criarLimitador(8, 30 * 1000);
  const podeEnviarArquivo = criarLimitador(5, 5 * 60 * 1000);

  async function exigirMembro(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');
    return acesso;
  }

  async function exigirNaoBanido(req, acesso) {
    const bloqueio = await ChatBanimento.findOne({ guildId: acesso.guild.id, usuarioId: req.usuario.id }).lean();
    if (!bloqueio || !emVigor(bloqueio)) return;
    const motivo = bloqueio.motivo ? ` Motivo: ${bloqueio.motivo}` : '';
    throw new ErroHttp(403, bloqueio.expiraEm
      ? `Você está de castigo no chat até ${horario.format(new Date(bloqueio.expiraEm)).replace(',', ' às')}.${motivo}`
      : `Você foi banido do chat deste servidor pela staff.${motivo}`);
  }

  router.get('/chat', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    // Duas abas: a conversa e os avisos, em que só a staff escreve.
    const canal = req.query.canal === 'avisos' ? 'avisos' : 'geral';
    const mensagens = (await ChatMensagem.find({ guildId: acesso.guild.id, apagadaEm: null, canal: canal === 'avisos' ? 'avisos' : { $ne: 'avisos' } })
      .sort({ criadaEm: -1 }).limit(MENSAGENS_NA_TELA).lean()).reverse();
    const sala = await lerSala(acesso.guild.id);
    const sinalizadas = acesso.papeis.staff
      ? await ChatSinalizacao.countDocuments({ guildId: acesso.guild.id, resolvidaEm: null }).catch(() => 0)
      : 0;

    const banimentos = (await ChatBanimento.find(acesso.papeis.staff
      ? { guildId: acesso.guild.id }
      : { guildId: acesso.guild.id, usuarioId: req.usuario.id }).sort({ criadoEm: -1 }).limit(50).lean()).filter(emVigor);
    const meu = banimentos.find(item => item.usuarioId === req.usuario.id);

    const fixada = await ChatFixada.findOne({ guildId: acesso.guild.id }).lean();
    const online = quemEstaOnline(acesso.guild.id);

    res.json({
      mensagens: mensagens.map(item => serializar(item, acesso.guild.id, req.usuario.id)),
      canal,
      sala: { modoLentoSeg: sala.modoLentoSeg, fechado: sala.fechado },
      online,
      emojis: EMOJIS,
      modosLentos: MODOS_LENTOS_SEG,
      sinalizadas,
      prazoApagarMin: PRAZO_APAGAR_PROPRIA_MS / 60000,
      fixada: fixada ? { texto: fixada.texto, autorId: fixada.autorId, fixadaPor: fixada.fixadaPor, em: fixada.em } : null,
      pessoas: await resolverPessoas(client, acesso.guild, [
        ...(fixada ? [fixada.autorId, fixada.fixadaPor, ...extrairMencoes(fixada.texto).usuarios] : []),
        ...online.map(pessoa => pessoa.id),
        ...banimentos.flatMap(item => [item.usuarioId, item.banidoPor]),
        // Das mais novas para as mais antigas: se passar do limite, ficam as recentes.
        ...[...mensagens].reverse().flatMap(item => [item.autorId, ...(item.mencoes || [])])
      ]),
      // Castigo (com hora para acabar) ou banimento de quem está vendo, se houver.
      banido: meu ? { expiraEm: meu.expiraEm || null, motivo: meu.motivo || '' } : null,
      // Só a staff vê a lista de quem está banido.
      ...(acesso.papeis.staff ? { banidos: banimentos.map(item => ({ usuarioId: item.usuarioId, banidoPor: item.banidoPor, criadoEm: item.criadoEm, expiraEm: item.expiraEm || null, motivo: item.motivo || '' })) } : {}),
      podeApagar: Boolean(acesso.papeis.staff),
      limiteArquivoMb: LIMITE_ARQUIVO_BYTES / 1024 / 1024
    });
  }));

  function validarTexto(texto, acesso) {
    if (texto.length > LIMITE_TEXTO) throw new ErroHttp(400, `A mensagem pode ter no máximo ${LIMITE_TEXTO} caracteres.`);
    // Mesmos filtros das mensagens dos tópicos de denúncia.
    if (!acesso.papeis.staff) {
      if (contemLinkProibido(texto)) throw new ErroHttp(400, 'A mensagem contém um link que não é permitido.');
      if (contemPalavraProibida(texto)) throw new ErroHttp(400, 'A mensagem contém palavras que não são permitidas.');
    }
  }

  // Castigo automático por flood. A staff fica de fora.
  async function barrarFlood(req, acesso, texto) {
    if (acesso.papeis.staff || !ehFlood(`${acesso.guild.id}:${req.usuario.id}`, texto)) return;

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const anteriores = await ChatModeracao.countDocuments({
      guildId: acesso.guild.id, alvoId: req.usuario.id, staffId: client.user.id, acao: 'castigo', em: { $gte: desde }
    }).catch(() => 0);
    const minutos = CASTIGOS_POR_FLOOD_MIN[Math.min(anteriores, CASTIGOS_POR_FLOOD_MIN.length - 1)];
    const motivo = 'Flood no chat (castigo automático)';

    await ChatBanimento.updateOne(
      { guildId: acesso.guild.id, usuarioId: req.usuario.id },
      { $set: { banidoPor: client.user.id, motivo, criadoEm: new Date(), expiraEm: new Date(Date.now() + minutos * 60 * 1000) } },
      { upsert: true }
    );
    await registrarModeracao({ guildId: acesso.guild.id, staffId: client.user.id, alvoId: req.usuario.id, acao: 'castigo', motivo, minutos });
    recentesPorPessoa.delete(`${acesso.guild.id}:${req.usuario.id}`);
    avisarMudanca(canalDoChat(acesso.guild.id));
    throw new ErroHttp(429, `Muitas mensagens seguidas. Você recebeu um castigo automático de ${minutos} minutos no chat.`);
  }

  // Pessoas marcadas com @ (no formato <@id>) que são mesmo deste servidor.
  async function mencoesValidas(acesso, texto, autorId) {
    const ids = [...new Set(extrairMencoes(texto).usuarios)].filter(id => id !== autorId).slice(0, MAX_MENCOES);
    const validas = [];
    for (const id of ids) {
      if (acesso.guild.members.cache.has(id) || await acesso.guild.members.fetch(id).catch(() => null)) validas.push(id);
    }
    return validas;
  }

  // @all (ou @todos) marca o servidor inteiro. Só a staff pode; para os demais
  // fica como texto comum.
  const marcaTodos = (acesso, texto) => Boolean(acesso.papeis.staff) && /(^|\s)@(all|todos)(?![\w])/i.test(texto);

  // Quem ativou as notificações e é membro deste servidor.
  async function inscritosDoServidor(guild, excetoId) {
    const ids = (await InscricaoPush.distinct('usuarioId')).filter(id => id !== excetoId).slice(0, 2000);
    const membros = [];
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const achados = await guild.members.fetch({ user: lote }).catch(() => null);
      if (achados) membros.push(...lote.filter(id => achados.has(id)));
    }
    return membros;
  }

  // Regras da sala antes de aceitar uma mensagem. Devolve o canal de destino.
  async function exigirSalaAberta(req, acesso, canalPedido) {
    const canal = canalPedido === 'avisos' ? 'avisos' : 'geral';
    if (acesso.papeis.staff) return canal;
    if (canal === 'avisos') throw new ErroHttp(403, 'Na aba de avisos só a staff escreve.');

    const sala = await lerSala(acesso.guild.id);
    if (sala.fechado) throw new ErroHttp(403, 'O chat está fechado pela staff no momento.');
    if (sala.modoLentoSeg) {
      const chave = `${acesso.guild.id}:${req.usuario.id}`;
      const falta = sala.modoLentoSeg * 1000 - (Date.now() - (ultimaFala.get(chave) || 0));
      if (falta > 0) throw new ErroHttp(429, `Modo lento ligado: aguarde ${Math.ceil(falta / 1000)} s para escrever de novo.`);
      if (ultimaFala.size > 5000) ultimaFala.clear();
      ultimaFala.set(chave, Date.now());
    }
    return canal;
  }

  // Cópia curta da mensagem respondida, se ela existir neste servidor.
  async function respostaPara(acesso, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    const original = await ChatMensagem.findOne({ _id: id, guildId: acesso.guild.id, apagadaEm: null }).select('autorId autorNome texto anexo').lean();
    if (!original) return null;
    return { id: String(original._id), autorId: original.autorId, autorNome: original.autorNome, trecho: (original.texto || `[arquivo] ${original.anexo?.nome || ''}`).slice(0, 120) };
  }

  async function publicar(req, acesso, texto, anexo, { canal = 'geral', resposta = null } = {}) {
    const autorNome = acesso.member.displayName || req.usuario.nome;
    const mencoes = await mencoesValidas(acesso, texto, req.usuario.id);
    // Quem recebeu a resposta é avisado como se tivesse sido marcado.
    if (resposta && resposta.autorId !== req.usuario.id && !mencoes.includes(resposta.autorId)) mencoes.push(resposta.autorId);
    const todos = marcaTodos(acesso, texto);
    const criada = await ChatMensagem.create({
      guildId: acesso.guild.id,
      autorId: req.usuario.id,
      autorNome,
      texto,
      mencoes,
      todos,
      canal,
      ...(resposta ? { resposta } : {}),
      ...(anexo ? { anexo } : {})
    });
    avisarMudanca(canalDoChat(acesso.guild.id));

    if (todos) {
      inscritosDoServidor(acesso.guild, req.usuario.id)
        .then(ids => enviarPush(ids, {
          titulo: `${autorNome} marcou todos no chat`,
          corpo: texto.replace(/<@!?\d{15,21}>/g, '@').slice(0, 120),
          url: '/#/chat',
          tag: `chat-${acesso.guild.id}`
        }))
        .catch(() => {});
    }

    // Quem foi marcado recebe o aviso no navegador, se ativou as notificações.
    if (mencoes.length && !todos) {
      enviarPush(mencoes, {
        titulo: `${autorNome} marcou você no chat`,
        corpo: texto.replace(/<@!?\d{15,21}>/g, '@').slice(0, 120) || 'Enviou um arquivo.',
        url: '/#/chat',
        tag: `chat-${acesso.guild.id}`
      }).catch(() => {});
    }
    return { ok: true, id: String(criada._id) };
  }

  router.post('/chat', express.json({ limit: '8kb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.body?.guildId);
    await exigirNaoBanido(req, acesso);
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new ErroHttp(400, 'Escreva uma mensagem.');
    validarTexto(texto, acesso);
    await barrarFlood(req, acesso, texto);
    if (!podeFalar(req.usuario.id)) throw new ErroHttp(429, 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.');
    const canal = await exigirSalaAberta(req, acesso, req.body?.canal);

    res.status(201).json(await publicar(req, acesso, texto, null, { canal, resposta: await respostaPara(acesso, req.body?.respostaA) }));
  }));

  // Imagem, áudio ou vídeo: o arquivo vai como corpo bruto; nome e texto, em cabeçalhos.
  router.post('/chat/arquivos', express.raw({ type: () => true, limit: '21mb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    await exigirNaoBanido(req, acesso);
    const dados = Buffer.isBuffer(req.body) ? req.body : null;
    if (!dados?.length) throw new ErroHttp(400, 'Nenhum arquivo recebido.');
    if (dados.length > LIMITE_ARQUIVO_BYTES) throw new ErroHttp(413, `No chat, cada arquivo pode ter até ${LIMITE_ARQUIVO_BYTES / 1024 / 1024} MB.`);

    const decodificar = (valor) => {
      try { return decodeURIComponent(String(valor || '')); } catch { return ''; }
    };
    const nome = path.basename(decodificar(req.get('X-Arquivo-Nome')).replace(/[\\/]/g, '_')).slice(0, 100);
    const extensao = nome.includes('.') ? nome.split('.').pop().toLowerCase() : '';
    if (!nome || !TIPOS_DE_ARQUIVO[extensao]) {
      throw new ErroHttp(415, `Tipo de arquivo não aceito no chat. Use: ${Object.keys(TIPOS_DE_ARQUIVO).join(', ')}.`);
    }
    if (!conteudoCombinaComExtensao(dados, extensao)) throw new ErroHttp(415, `O conteúdo do arquivo não corresponde a um .${extensao} válido.`);

    const texto = decodificar(req.get('X-Mensagem')).trim();
    validarTexto(texto, acesso);
    await barrarFlood(req, acesso, '');
    if (!podeEnviarArquivo(req.usuario.id)) throw new ErroHttp(429, 'Muitos arquivos em pouco tempo. Aguarde alguns minutos.');

    const canal = await exigirSalaAberta(req, acesso, req.query.canal);

    const arquivoId = await guardarArquivo(dados, nome, acesso.guild.id);
    limparArquivosAntigos().catch(() => {});
    res.status(201).json(await publicar(req, acesso, texto, { arquivoId, nome, tipo: TIPOS_DE_ARQUIVO[extensao], tamanho: dados.length }, { canal }));
  }));

  // Entrega o arquivo de uma mensagem do chat. Aceita pedidos por trecho
  // (Range), que o navegador usa para avançar e voltar em vídeos e áudios.
  router.get('/chat/arquivos/:id', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Arquivo não encontrado.');

    const mensagem = await ChatMensagem.findOne({ guildId: acesso.guild.id, 'anexo.arquivoId': req.params.id, apagadaEm: null }).select('anexo').lean();
    if (!mensagem) throw new ErroHttp(404, 'Arquivo não encontrado.');

    const total = mensagem.anexo.tamanho;
    const trecho = /^bytes=(\d*)-(\d*)$/.exec(req.get('Range') || '');
    let inicio = 0;
    let fim = total - 1;
    if (trecho && (trecho[1] || trecho[2])) {
      if (trecho[1]) {
        inicio = Number(trecho[1]);
        if (trecho[2]) fim = Math.min(Number(trecho[2]), total - 1);
      } else {
        inicio = Math.max(0, total - Number(trecho[2]));
      }
      if (inicio > fim || inicio >= total) {
        res.set('Content-Range', `bytes */${total}`);
        throw new ErroHttp(416, 'Trecho do arquivo fora do tamanho.');
      }
      res.status(206).set('Content-Range', `bytes ${inicio}-${fim}/${total}`);
    }

    res.set({
      'Content-Type': mensagem.anexo.tipo,
      'Content-Length': String(fim - inicio + 1),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600'
    });
    arquivosDoChat().openDownloadStream(mensagem.anexo.arquivoId, { start: inicio, end: fim + 1 })
      .on('error', () => res.destroy())
      .pipe(res);
  }));

  // Quantas mensagens chegaram desde a última vez que a pessoa abriu o chat.
  router.get('/chat/novas', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    const informada = new Date(String(req.query.desde || ''));
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const desde = new Date(Math.max(Number.isNaN(informada.getTime()) ? Date.now() - 24 * 60 * 60 * 1000 : informada.getTime(), limite));
    const base = { guildId: acesso.guild.id, apagadaEm: null, criadaEm: { $gt: desde }, autorId: { $ne: req.usuario.id } };

    const [total, mencoes] = await Promise.all([
      ChatMensagem.countDocuments(base, { limit: 100 }),
      ChatMensagem.countDocuments({ ...base, $or: [{ mencoes: req.usuario.id }, { todos: true }] }, { limit: 100 })
    ]);
    res.json({ total, mencoes });
  }));

  // Aviso fixado no topo do chat: a staff escolhe uma mensagem e ela fica presa.
  router.post('/chat/fixada', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.body?.guildId);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode fixar mensagens no chat.');
    if (!mongoose.isValidObjectId(req.body?.mensagemId)) throw new ErroHttp(404, 'Mensagem não encontrada.');

    const mensagem = await ChatMensagem.findOne({ _id: req.body.mensagemId, guildId: acesso.guild.id, apagadaEm: null }).lean();
    if (!mensagem) throw new ErroHttp(404, 'Mensagem não encontrada.');
    if (!mensagem.texto) throw new ErroHttp(400, 'Só mensagens com texto podem ser fixadas.');

    await ChatFixada.updateOne(
      { guildId: acesso.guild.id },
      { $set: { texto: mensagem.texto, autorId: mensagem.autorId, fixadaPor: req.usuario.id, em: new Date() } },
      { upsert: true }
    );
    await registrarModeracao({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: mensagem.autorId, acao: 'fixar', trecho: mensagem.texto.slice(0, 160) });
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.status(201).json({ ok: true, mensagem: 'Mensagem fixada no topo do chat.' });
  }));

  router.delete('/chat/fixada', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode desafixar mensagens do chat.');

    const removida = await ChatFixada.findOneAndDelete({ guildId: acesso.guild.id });
    if (removida) {
      await registrarModeracao({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: removida.autorId, acao: 'desafixar', trecho: removida.texto.slice(0, 160) });
    }
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true, mensagem: 'Aviso desafixado.' });
  }));

  router.delete('/chat/:id', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Mensagem não encontrada.');

    const mensagem = await ChatMensagem.findOne({ _id: req.params.id, guildId: acesso.guild.id, apagadaEm: null }).lean();
    if (!mensagem) throw new ErroHttp(404, 'Mensagem não encontrada.');

    // A staff apaga qualquer mensagem; o autor, só a própria e por poucos minutos.
    const propria = mensagem.autorId === req.usuario.id;
    const noPrazo = Date.now() - new Date(mensagem.criadaEm).getTime() < PRAZO_APAGAR_PROPRIA_MS;
    if (!acesso.papeis.staff && !(propria && noPrazo)) {
      throw new ErroHttp(403, propria
        ? `Você só pode apagar a própria mensagem nos primeiros ${PRAZO_APAGAR_PROPRIA_MS / 60000} minutos.`
        : 'Apenas a staff pode apagar mensagens de outras pessoas.');
    }

    await ChatMensagem.updateOne({ _id: mensagem._id }, { $set: { apagadaPor: req.usuario.id, apagadaEm: new Date() } });
    if (mensagem.anexo?.arquivoId) await arquivosDoChat().delete(mensagem.anexo.arquivoId).catch(() => {});
    await ChatSinalizacao.updateMany({ mensagemId: mensagem._id, resolvidaEm: null }, { $set: { resolvidaPor: req.usuario.id, resolvidaEm: new Date() } }).catch(() => {});

    // Só entra na auditoria quando a staff apaga a mensagem de outra pessoa.
    if (!propria) {
      await registrarModeracao({
        guildId: acesso.guild.id,
        staffId: req.usuario.id,
        alvoId: mensagem.autorId,
        acao: 'apagar',
        trecho: (mensagem.texto || `[arquivo] ${mensagem.anexo?.nome || ''}`).slice(0, 160)
      });
    }
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true, mensagem: 'Mensagem apagada.' });
  }));

  // Castigo ou banimento do chat: a pessoa deixa de poder escrever. Só a staff e o responsável
  // banem, e ninguém da staff pode ser banido por aqui.
  router.post('/chat/banimentos', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.body?.guildId);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode banir do chat.');

    const usuarioId = String(req.body?.usuarioId || '');
    if (!/^\d{15,21}$/.test(usuarioId)) throw new ErroHttp(400, 'Pessoa inválida.');
    if (usuarioId === req.usuario.id) throw new ErroHttp(400, 'Você não pode banir a si mesmo.');
    const alvo = await acessoAoServidor(client, usuarioId, acesso.guild.id);
    if (alvo?.papeis.staff) throw new ErroHttp(403, 'Não é possível banir alguém da staff do chat.');

    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) throw new ErroHttp(400, 'Escreva o motivo da punição.');
    if (motivo.length > 200) throw new ErroHttp(400, 'O motivo aceita até 200 caracteres.');

    // Com "minutos" é castigo; sem, banimento. Aplicar de novo troca o anterior.
    const minutos = req.body?.minutos == null ? null : Number(req.body.minutos);
    if (minutos !== null && (!Number.isInteger(minutos) || minutos < 1 || minutos > CASTIGO_MAXIMO_MIN)) {
      throw new ErroHttp(400, 'O castigo deve ter de 1 minuto a 30 dias.');
    }

    await ChatBanimento.updateOne(
      { guildId: acesso.guild.id, usuarioId },
      { $set: { banidoPor: req.usuario.id, motivo, criadoEm: new Date(), expiraEm: minutos ? new Date(Date.now() + minutos * 60 * 1000) : null } },
      { upsert: true }
    );
    await registrarModeracao({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: usuarioId, acao: minutos ? 'castigo' : 'banimento', motivo, minutos });
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.status(201).json({ ok: true, mensagem: minutos ? 'Castigo aplicado.' : 'Pessoa banida do chat.' });
  }));

  router.delete('/chat/banimentos/:usuarioId', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    if (!acesso.papeis.staff) throw new ErroHttp(403, 'Apenas a staff pode remover um banimento do chat.');

    const removido = await ChatBanimento.findOneAndDelete({ guildId: acesso.guild.id, usuarioId: String(req.params.usuarioId) });
    if (removido) await registrarModeracao({ guildId: acesso.guild.id, staffId: req.usuario.id, alvoId: removido.usuarioId, acao: 'remocao' });
    avisarMudanca(canalDoChat(acesso.guild.id));
    res.json({ ok: true, mensagem: 'Banimento removido.' });
  }));

  // Tempo real: o navegador recarrega o chat quando chega "mudou".
  router.get('/chat/eventos', assincrono(async (req, res) => {
    const acesso = await exigirMembro(req, req.query.guildId);
    const abertas = conexoesPorUsuario.get(req.usuario.id) || 0;
    if (abertas >= 6) throw new ErroHttp(429, 'Muitas abas abertas com o site. Feche algumas e tente de novo.');
    conexoesPorUsuario.set(req.usuario.id, abertas + 1);

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();

    const pararDeOuvir = ouvirMudancas(canalDoChat(acesso.guild.id), () => res.write('event: mudou\ndata: {}\n\n'));
    const sairDaPresenca = entrarNaPresenca(acesso.guild.id, {
      id: req.usuario.id,
      nome: acesso.member.displayName || req.usuario.nome,
      staff: Boolean(acesso.papeis.staff)
    });
    avisarMudanca(canalDoChat(acesso.guild.id));
    const pulso = setInterval(() => res.write(': ok\n\n'), 25 * 1000);

    req.on('close', () => {
      const restantes = (conexoesPorUsuario.get(req.usuario.id) || 1) - 1;
      if (restantes > 0) conexoesPorUsuario.set(req.usuario.id, restantes);
      else conexoesPorUsuario.delete(req.usuario.id);
      clearInterval(pulso);
      pararDeOuvir();
      sairDaPresenca();
      avisarMudanca(canalDoChat(acesso.guild.id));
    });
  }));
}

module.exports = { registrarRotasDoChat, ehFlood };
