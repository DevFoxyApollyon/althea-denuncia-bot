// Perfil do jogador: tudo o que o banco tem sobre um ID de conta do jogo.
// Restrito à staff. As denúncias somem do banco 45 dias depois de abertas, então
// o perfil cobre esse período.
const express = require('express');
const Denuncia = require('../../models/Denuncia');
const Usuario = require('../../models/Usuario');
const ChatModeracao = require('../../models/ChatModeracao');
const { categoriaDoMotivo } = require('../categorias');
const { acessoAoServidor } = require('../acesso');
const push = require('../push');
const { resolverPessoas, escaparRegex, ErroHttp, assincrono } = require('./comum');

const EM_ANDAMENTO = ['pendente', 'reivindicacao', 'analise'];
const CAMPOS = 'acusado denunciante motivo platform status dataCriacao punicao motivoAceite dataPunicao';

// Uma denúncia finalizada continua contando como aceita quando guarda a punição.
function resultadoDoCaso(caso) {
  if (caso.status === 'aceita' || (caso.status === 'finalizada' && (caso.motivoAceite || caso.punicao))) return 'aceita';
  if (caso.status === 'recusada') return 'recusada';
  if (EM_ANDAMENTO.includes(caso.status)) return 'andamento';
  return 'finalizada';
}

function resumir(casos, guildId) {
  const contagem = { aceita: 0, recusada: 0, andamento: 0, finalizada: 0 };
  const porCategoria = new Map();
  for (const caso of casos) {
    contagem[resultadoDoCaso(caso)]++;
    const categoria = categoriaDoMotivo(caso.motivo, guildId);
    porCategoria.set(categoria, (porCategoria.get(categoria) || 0) + 1);
  }
  const decididas = contagem.aceita + contagem.recusada;

  return {
    total: casos.length,
    aceitas: contagem.aceita,
    recusadas: contagem.recusada,
    andamento: contagem.andamento,
    finalizadas: contagem.finalizada,
    taxaDeAceitas: decididas ? contagem.aceita / decididas : null,
    porCategoria: [...porCategoria].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total),
    casos: casos.slice(0, 30).map(caso => ({
      id: String(caso._id),
      acusado: caso.acusado,
      denunciante: caso.denunciante,
      motivo: caso.motivo,
      categoria: categoriaDoMotivo(caso.motivo, guildId),
      platform: caso.platform,
      status: caso.status,
      resultado: resultadoDoCaso(caso),
      dataCriacao: caso.dataCriacao
    }))
  };
}

function registrarRotasDeJogadores(router, { client }) {
  router.get('/jogadores/:conta', assincrono(async (req, res) => {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
    if (!acesso?.papeis.staff) throw new ErroHttp(403, 'O perfil do jogador é restrito à staff.');

    const conta = String(req.params.conta || '').trim();
    if (!/^[\w.-]{1,20}$/.test(conta)) throw new ErroHttp(400, 'Informe o ID da conta do jogador (só letras e números).');

    const guildId = acesso.guild.id;
    const id = escaparRegex(conta);
    const [recebidas, feitas, contas] = await Promise.all([
      // "1039" também casa com "1039+2471".
      Denuncia.find({ guildId, acusado: new RegExp(`(^|\\+)\\s*${id}\\s*(\\+|$)`, 'i') })
        .sort({ dataCriacao: -1 }).limit(200).select(CAMPOS).lean(),
      Denuncia.find({ guildId, denunciante: new RegExp(`^\\s*${id}\\s*$`, 'i') })
        .sort({ dataCriacao: -1 }).limit(200).select(CAMPOS).lean(),
      Usuario.find({ guildId, conta }).sort({ updatedAt: -1 }).limit(5).select('userId').lean().catch(() => [])
    ]);

    // Castigos e banimentos que as contas deste jogador levaram no chat do site (últimos 90 dias).
    const noChat = contas.length
      ? await ChatModeracao.find({ guildId, alvoId: { $in: contas.map(item => item.userId) }, acao: { $in: ['castigo', 'banimento'] } })
        .sort({ em: -1 }).limit(30).lean().catch(() => [])
      : [];

    const pessoas = await resolverPessoas(client, acesso.guild, [...contas.map(item => item.userId), ...noChat.map(item => item.staffId)]);

    res.json({
      conta,
      contasDiscord: contas.filter(item => pessoas[item.userId]).map(item => ({ id: item.userId, ...pessoas[item.userId] })),
      chat: {
        castigos: noChat.filter(item => item.acao === 'castigo').length,
        banimentos: noChat.filter(item => item.acao === 'banimento').length,
        itens: noChat.map(item => ({ acao: item.acao, motivo: item.motivo, minutos: item.minutos, em: item.em, por: pessoas[item.staffId]?.nome || 'Staff' }))
      },
      recebidas: resumir(recebidas, guildId),
      feitas: resumir(feitas, guildId),
      punicoes: recebidas.filter(caso => resultadoDoCaso(caso) === 'aceita').slice(0, 30).map(caso => ({
        id: String(caso._id),
        motivo: caso.motivo,
        categoria: categoriaDoMotivo(caso.motivo, guildId),
        punicao: caso.motivoAceite || caso.punicao || '',
        dataPunicao: caso.dataPunicao || null,
        dataCriacao: caso.dataCriacao
      }))
    });
  }));

  // Notificações do navegador: chave pública do site e inscrição do aparelho.
  router.get('/push/chave', assincrono(async (req, res) => {
    res.json({ chave: (await push.chavesDoSite()).publica });
  }));

  router.post('/push/inscricao', express.json({ limit: '8kb' }), assincrono(async (req, res) => {
    if (!await push.salvarInscricao(req.usuario.id, req.body)) throw new ErroHttp(400, 'Este navegador não enviou uma inscrição válida.');
    res.status(201).json({ ok: true });
  }));

  router.delete('/push/inscricao', express.json({ limit: '8kb' }), assincrono(async (req, res) => {
    await push.removerInscricao(req.usuario.id, req.body?.endpoint);
    res.json({ ok: true });
  }));
}

module.exports = { registrarRotasDeJogadores, resultadoDoCaso, resumir };
