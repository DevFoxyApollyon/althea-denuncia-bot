// Teste da staff: o responsável monta (vídeo + perguntas de múltipla escolha)
// e a staff responde pelo site. A resposta certa nunca vai para o navegador de
// quem está fazendo o teste; a correção é feita aqui.
const crypto = require('crypto');
const express = require('express');
const TesteStaff = require('../../models/TesteStaff');
const TesteResposta = require('../../models/TesteResposta');
const { acessoAoServidor } = require('../acesso');
const { analisarMusica } = require('./chatSala');
const { resolverPessoas, ErroHttp, assincrono, criarLimitador } = require('./comum');

const MAX_PERGUNTAS = 40;
const MAX_OPCOES = 6;

// Confere o que veio do formulário do responsável e devolve o teste limpo.
function validarTeste(entrada) {
  const texto = (valor, limite) => String(valor ?? '').trim().slice(0, limite);

  let video = '';
  const link = texto(entrada?.video, 300);
  if (link) {
    // Aceita o link do YouTube ou o identificador já guardado.
    const analisado = /^[\w-]{11}$/.test(link) ? { tipo: 'youtube', ref: link } : analisarMusica(link);
    if (analisado?.tipo !== 'youtube') throw new Error('O vídeo precisa ser um link do YouTube.');
    video = analisado.ref;
  }

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
      opcoes,
      correta: opcoes.indexOf(certa)
    };
  });
  if (!perguntas.length) throw new Error('Adicione pelo menos uma pergunta.');
  if (new Set(perguntas.map(item => item.id)).size !== perguntas.length) throw new Error('Há perguntas com o mesmo identificador; recarregue a página e tente de novo.');

  return { titulo: texto(entrada?.titulo, 80) || 'Teste da staff', instrucoes: texto(entrada?.instrucoes, 600), video, notaMinima, perguntas };
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

function registrarRotasDoTeste(router, { client }) {
  const podeEnviar = criarLimitador(5, 10 * 60 * 1000);

  async function exigir(req, guildId, papel) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis[papel]) {
      throw new ErroHttp(403, papel === 'responsavel' ? 'Só o responsável pode editar o teste.' : 'O teste é só para a staff.');
    }
    return acesso;
  }

  // O teste como a staff vê: sem a alternativa certa.
  router.get('/teste', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'staff');
    const teste = await TesteStaff.findOne({ guildId: acesso.guild.id }).lean();
    if (!teste?.perguntas?.length) return res.json({ configurado: false });

    const ultima = await TesteResposta.findOne({ guildId: acesso.guild.id, usuarioId: req.usuario.id }).sort({ em: -1 }).lean();
    res.json({
      configurado: true,
      titulo: teste.titulo,
      instrucoes: teste.instrucoes,
      video: teste.video,
      notaMinima: teste.notaMinima,
      perguntas: teste.perguntas.map(({ id, texto, opcoes }) => ({ id, texto, opcoes })),
      ultima: resumoDaResposta(ultima)
    });
  }));

  router.post('/teste/respostas', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const acesso = await exigir(req, req.body?.guildId, 'staff');
    const teste = await TesteStaff.findOne({ guildId: acesso.guild.id }).lean();
    if (!teste?.perguntas?.length) throw new ErroHttp(404, 'Este servidor ainda não tem teste.');

    const respostas = req.body?.respostas || {};
    const semResposta = teste.perguntas.filter(pergunta => respostas[pergunta.id] === undefined || respostas[pergunta.id] === null).length;
    if (semResposta) throw new ErroHttp(400, `Responda todas as perguntas. ${semResposta === 1 ? 'Falta 1.' : `Faltam ${semResposta}.`}`);
    if (!podeEnviar(req.usuario.id)) throw new ErroHttp(429, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.');

    const resultado = corrigir(teste, respostas);
    const salva = await TesteResposta.create({ guildId: acesso.guild.id, usuarioId: req.usuario.id, ...resultado });
    res.status(201).json({ ok: true, resultado: resumoDaResposta(salva) });
  }));

  // O teste completo e os resultados, para o responsável.
  router.get('/teste/admin', assincrono(async (req, res) => {
    const acesso = await exigir(req, req.query.guildId, 'responsavel');
    const [teste, respostas] = await Promise.all([
      TesteStaff.findOne({ guildId: acesso.guild.id }).lean(),
      TesteResposta.find({ guildId: acesso.guild.id }).sort({ em: -1 }).limit(300).lean()
    ]);

    // Fica só a tentativa mais recente de cada pessoa, com o total de tentativas.
    const porPessoa = new Map();
    for (const item of respostas) {
      const atual = porPessoa.get(item.usuarioId);
      if (atual) atual.tentativas++;
      else porPessoa.set(item.usuarioId, { usuarioId: item.usuarioId, ...resumoDaResposta(item), tentativas: 1 });
    }

    res.json({
      teste: teste
        ? { titulo: teste.titulo, instrucoes: teste.instrucoes, video: teste.video, notaMinima: teste.notaMinima, perguntas: teste.perguntas }
        : { titulo: 'Teste da staff', instrucoes: '', video: '', notaMinima: 70, perguntas: [] },
      resultados: [...porPessoa.values()],
      pessoas: await resolverPessoas(client, acesso.guild, [...porPessoa.keys()])
    });
  }));

  router.post('/teste/admin', express.json({ limit: '128kb' }), assincrono(async (req, res) => {
    const acesso = await exigir(req, req.body?.guildId, 'responsavel');
    let teste;
    try {
      teste = validarTeste(req.body?.teste);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }

    await TesteStaff.updateOne(
      { guildId: acesso.guild.id },
      { $set: { ...teste, atualizadoPor: req.usuario.id, atualizadoEm: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, mensagem: 'Teste salvo. A staff já pode responder.', teste });
  }));
}

module.exports = { registrarRotasDoTeste, validarTeste, corrigir };
