// Testes da staff: o responsável monta quantos quiser (cada um com título,
// vídeo de abertura e perguntas de múltipla escolha, que também podem ter vídeo
// próprio) e a staff escolhe qual fazer. Cada teste é respondido e corrigido em
// separado. A resposta certa nunca vai para o navegador de quem está fazendo o
// teste; a correção é feita aqui.
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const TesteStaff = require('../../models/TesteStaff');
const TesteResposta = require('../../models/TesteResposta');
const { acessoAoServidor } = require('../acesso');
const { analisarMusica } = require('./chatSala');
const { resolverPessoas, ErroHttp, assincrono, criarLimitador } = require('./comum');

const MAX_PERGUNTAS = 40;
const MAX_OPCOES = 6;
const MAX_TESTES = 30;

// Aceita o link do YouTube ou o identificador já guardado; devolve o identificador.
function lerVideo(valor, onde) {
  const link = String(valor ?? '').trim().slice(0, 300);
  if (!link) return '';
  const analisado = /^[\w-]{11}$/.test(link) ? { tipo: 'youtube', ref: link } : analisarMusica(link);
  if (analisado?.tipo !== 'youtube') throw new Error(`${onde} precisa ser um link do YouTube.`);
  return analisado.ref;
}

// Confere o que veio do formulário do responsável e devolve o teste limpo.
function validarTeste(entrada) {
  const texto = (valor, limite) => String(valor ?? '').trim().slice(0, limite);
  const video = lerVideo(entrada?.video, 'O vídeo');

  const notaMinima = Math.round(Number(entrada?.notaMinima));
  if (!Number.isFinite(notaMinima) || notaMinima < 1 || notaMinima > 100) throw new Error('A nota mínima deve ficar entre 1 e 100.');

  const perguntas = (Array.isArray(entrada?.perguntas) ? entrada.perguntas : []).slice(0, MAX_PERGUNTAS).map((item, indice) => {
    const enunciado = texto(item?.texto, 300);
    if (!enunciado) throw new Error(`A pergunta ${indice + 1} está sem texto.`);

    // As alternativas vazias saem; a marcada como certa precisa continuar existindo.
    const brutas = (Array.isArray(item?.opcoes) ? item.opcoes : []).slice(0, MAX_OPCOES).map(opcao => texto(opcao, 200));
    const certa = brutas[Number(item?.correta)];
    const opcoes = brutas.filter(Boolean);
    if (opcoes.length < 2) throw new Error(`A pergunta ${indice + 1} precisa de pelo menos duas alternativas.`);
    if (!certa) throw new Error(`Marque a alternativa certa da pergunta ${indice + 1}.`);
    if (new Set(opcoes).size !== opcoes.length) throw new Error(`A pergunta ${indice + 1} tem alternativas repetidas.`);

    return {
      id: /^[a-f0-9]{8}$/.test(String(item?.id)) ? String(item.id) : crypto.randomBytes(4).toString('hex'),
      texto: enunciado,
      video: lerVideo(item?.video, `O vídeo da pergunta ${indice + 1}`),
      opcoes,
      correta: opcoes.indexOf(certa)
    };
  });
  if (!perguntas.length) throw new Error('Adicione pelo menos uma pergunta.');
  if (new Set(perguntas.map(item => item.id)).size !== perguntas.length) throw new Error('Há perguntas com o mesmo identificador; recarregue a página e tente de novo.');

  const titulo = texto(entrada?.titulo, 80);
  if (!titulo) throw new Error('Dê um título ao teste.');

  return { titulo, instrucoes: texto(entrada?.instrucoes, 600), video, notaMinima, ativo: entrada?.ativo !== false, perguntas };
}

// Corrige as respostas ({ idDaPergunta: posição escolhida }).
function corrigir(teste, respostas) {
  const erradas = teste.perguntas.filter(pergunta => Number(respostas?.[pergunta.id]) !== pergunta.correta).map(pergunta => pergunta.id);
  const total = teste.perguntas.length;
  const acertos = total - erradas.length;
  return { acertos, total, erradas, aprovado: (acertos / total) * 100 >= teste.notaMinima };
}

const resumoDaResposta = (item) => (item
  ? { acertos: item.acertos, total: item.total, aprovado: item.aprovado, erradas: item.erradas, em: item.em }
  : null);

// A qual teste uma resposta pertence. As antigas, sem testeId, são do teste mais antigo do servidor.
const testeDaResposta = (resposta, idDoMaisAntigo) => resposta.testeId || idDoMaisAntigo;

// Última tentativa de cada pessoa (com o total de tentativas), a partir das respostas mais novas primeiro.
function ultimasPorPessoa(respostas) {
  const porPessoa = new Map();
  for (const item of respostas) {
    const atual = porPessoa.get(item.usuarioId);
    if (atual) atual.tentativas += 1;
    else porPessoa.set(item.usuarioId, { usuarioId: item.usuarioId, ...resumoDaResposta(item), tentativas: 1 });
  }
  return [...porPessoa.values()];
}

function registrarRotasDoTeste(router, { client }) {
  const podeEnviar = criarLimitador(8, 10 * 60 * 1000);

  async function exigir(req, guildId, papel) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis[papel]) {
      throw new ErroHttp(403, papel === 'responsavel' ? 'Só o responsável pode editar os testes.' : 'Os testes são só para a staff.');
    }
    await TesteStaff.removerIndiceAntigo();
    return acesso;
  }

  const testesDoServidor = (guildId) => TesteStaff.find({ guildId }).sort({ criadoEm: 1, _id: 1 }).lean();

  async function testeDoServidor(guildId, id) {
    if (!mongoose.isValidObjectId(id)) throw new ErroHttp(404, 'Teste não encontrado.');
    const teste = await TesteStaff.findOne({ _id: id, guildId }).lean();
    if (!teste) throw new ErroHttp(404, 'Teste não encontrado.');
    return teste;
  }

  // ---------------------------------------------------------------- responsável
  // (registradas antes de /teste/:id, para "admin" não ser lido como um id)
  router.get('/teste/admin', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'responsavel');
    const [testes, respostas] = await Promise.all([
      testesDoServidor(acesso.guild.id),
      TesteResposta.find({ guildId: acesso.guild.id }).sort({ em: -1 }).limit(2000).select('testeId usuarioId aprovado em acertos total erradas').lean()
    ]);
    const maisAntigo = testes[0] ? String(testes[0]._id) : null;

    res.json({
      limite: MAX_TESTES,
      testes: testes.map((teste) => {
        const id = String(teste._id);
        const ultimas = ultimasPorPessoa(respostas.filter(item => testeDaResposta(item, maisAntigo) === id));
        return {
          id,
          titulo: teste.titulo,
          ativo: teste.ativo !== false,
          perguntas: teste.perguntas.length,
          comVideo: teste.perguntas.filter(pergunta => pergunta.video).length + (teste.video ? 1 : 0),
          notaMinima: teste.notaMinima,
          responderam: ultimas.length,
          aprovados: ultimas.filter(item => item.aprovado).length,
          atualizadoEm: teste.atualizadoEm
        };
      })
    });
  }));

  router.get('/teste/admin/:id', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'responsavel');
    const teste = await testeDoServidor(acesso.guild.id, req.params.id);
    const maisAntigo = await TesteStaff.findOne({ guildId: acesso.guild.id }).sort({ criadoEm: 1, _id: 1 }).select('_id').lean();
    const ehOMaisAntigo = String(maisAntigo?._id) === String(teste._id);

    const respostas = await TesteResposta.find({
      guildId: acesso.guild.id,
      $or: [{ testeId: String(teste._id) }, ...(ehOMaisAntigo ? [{ testeId: null }] : [])]
    }).sort({ em: -1 }).limit(500).lean();
    const resultados = ultimasPorPessoa(respostas);

    res.json({
      teste: { id: String(teste._id), titulo: teste.titulo, instrucoes: teste.instrucoes, video: teste.video, notaMinima: teste.notaMinima, ativo: teste.ativo !== false, perguntas: teste.perguntas },
      resultados,
      pessoas: await resolverPessoas(client, acesso.guild, resultados.map(item => item.usuarioId))
    });
  }));

  // Cria (sem id) ou atualiza (com id) um teste.
  router.post('/teste/admin', express.json({ limit: '128kb' }), assincrono(async (req, res) => {
    const acesso = await exigir(req, req.body?.guildId, 'responsavel');
    let teste;
    try {
      teste = validarTeste(req.body?.teste);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }
    const dados = { ...teste, atualizadoPor: req.usuario.id, atualizadoEm: new Date() };

    const id = req.body?.id;
    if (id) {
      await testeDoServidor(acesso.guild.id, id);
      await TesteStaff.updateOne({ _id: id, guildId: acesso.guild.id }, { $set: dados });
      return res.json({ ok: true, id: String(id), mensagem: teste.ativo ? 'Teste salvo. A staff já pode responder.' : 'Teste salvo como rascunho. A staff ainda não vê.' });
    }

    if (await TesteStaff.countDocuments({ guildId: acesso.guild.id }) >= MAX_TESTES) throw new ErroHttp(400, `Cada servidor pode ter até ${MAX_TESTES} testes. Apague um para criar outro.`);
    const criado = await TesteStaff.create({ guildId: acesso.guild.id, ...dados });
    res.status(201).json({ ok: true, id: String(criado._id), mensagem: teste.ativo ? 'Teste criado. A staff já pode responder.' : 'Teste criado como rascunho. A staff ainda não vê.' });
  }));

  router.delete('/teste/admin/:id', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'responsavel');
    const teste = await testeDoServidor(acesso.guild.id, req.params.id);
    await TesteStaff.deleteOne({ _id: teste._id });
    await TesteResposta.deleteMany({ guildId: acesso.guild.id, testeId: String(teste._id) });
    res.json({ ok: true, mensagem: `Teste "${teste.titulo}" apagado, com os resultados dele.` });
  }));

  // ---------------------------------------------------------------- staff
  // Lista dos testes publicados, com o último resultado da pessoa em cada um.
  router.get('/teste', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'staff');
    const todos = await testesDoServidor(acesso.guild.id);
    const maisAntigo = todos[0] ? String(todos[0]._id) : null;
    const minhas = await TesteResposta.find({ guildId: acesso.guild.id, usuarioId: req.usuario.id }).sort({ em: -1 }).limit(300).lean();

    res.json({
      testes: todos.filter(teste => teste.ativo !== false && teste.perguntas?.length).map((teste) => {
        const id = String(teste._id);
        return {
          id,
          titulo: teste.titulo,
          instrucoes: teste.instrucoes,
          perguntas: teste.perguntas.length,
          comVideo: Boolean(teste.video) || teste.perguntas.some(pergunta => pergunta.video),
          notaMinima: teste.notaMinima,
          ultima: resumoDaResposta(minhas.find(item => testeDaResposta(item, maisAntigo) === id))
        };
      })
    });
  }));

  // Um teste como a staff vê: sem a alternativa certa.
  router.get('/teste/:id', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'staff');
    const teste = await testeDoServidor(acesso.guild.id, req.params.id);
    if (teste.ativo === false && !acesso.papeis.responsavel) throw new ErroHttp(404, 'Teste não encontrado.');

    const maisAntigo = await TesteStaff.findOne({ guildId: acesso.guild.id }).sort({ criadoEm: 1, _id: 1 }).select('_id').lean();
    const ultima = await TesteResposta.findOne({
      guildId: acesso.guild.id,
      usuarioId: req.usuario.id,
      $or: [{ testeId: String(teste._id) }, ...(String(maisAntigo?._id) === String(teste._id) ? [{ testeId: null }] : [])]
    }).sort({ em: -1 }).lean();

    res.json({
      id: String(teste._id),
      titulo: teste.titulo,
      instrucoes: teste.instrucoes,
      video: teste.video,
      notaMinima: teste.notaMinima,
      perguntas: teste.perguntas.map(({ id, texto, video, opcoes }) => ({ id, texto, video: video || '', opcoes })),
      ultima: resumoDaResposta(ultima)
    });
  }));

  router.post('/teste/:id/respostas', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const acesso = await exigir(req, req.body?.guildId, 'staff');
    const teste = await testeDoServidor(acesso.guild.id, req.params.id);
    if (teste.ativo === false && !acesso.papeis.responsavel) throw new ErroHttp(404, 'Teste não encontrado.');

    const respostas = req.body?.respostas || {};
    const semResposta = teste.perguntas.filter(pergunta => respostas[pergunta.id] === undefined || respostas[pergunta.id] === null).length;
    if (semResposta) throw new ErroHttp(400, `Responda todas as perguntas. ${semResposta === 1 ? 'Falta 1.' : `Faltam ${semResposta}.`}`);
    if (!podeEnviar(req.usuario.id)) throw new ErroHttp(429, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.');

    const resultado = corrigir(teste, respostas);
    const salva = await TesteResposta.create({ guildId: acesso.guild.id, testeId: String(teste._id), usuarioId: req.usuario.id, ...resultado });
    res.status(201).json({ ok: true, resultado: resumoDaResposta(salva) });
  }));
}

module.exports = { registrarRotasDoTeste, validarTeste, corrigir, ultimasPorPessoa };
