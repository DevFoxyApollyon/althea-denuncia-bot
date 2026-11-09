// Sessões do site. O cookie continua sendo assinado e sem consulta ao banco a
// cada pedido, mas agora carrega um identificador de sessão. Assim a pessoa vê
// onde está logada e encerra as outras sessões, e o responsável é avisado
// quando uma conta da staff entra de um IP que ela nunca usou.
const crypto = require('crypto');
const express = require('express');
const LoginSite = require('../models/LoginSite');
const { servidoresDoUsuario } = require('./acesso');
const { enviarPush } = require('./push');
const { DURACAO_SESSAO_MS } = require('./sessao');
const { ErroHttp, assincrono } = require('./rotas/comum');

const ATUALIZAR_USO_A_CADA_MS = 10 * 60 * 1000;

// Sessões encerradas ficam na memória (são poucas e vencem em 7 dias), para
// conferir cada pedido sem ir ao banco.
const encerradas = new Set();
const ultimoUso = new Map();
let carregadas = null;

const novoSid = () => crypto.randomBytes(12).toString('base64url');
const sessaoEncerrada = (sid) => Boolean(sid) && encerradas.has(sid);

// Ao ligar: recupera do banco as sessões já encerradas que ainda não venceram.
function carregarSessoesEncerradas() {
  carregadas ||= LoginSite.find({ encerradaEm: { $ne: null }, em: { $gte: new Date(Date.now() - DURACAO_SESSAO_MS) } }).select('sid').lean()
    .then(docs => docs.forEach(doc => doc.sid && encerradas.add(doc.sid)))
    .catch((erro) => {
      carregadas = null;
      console.warn(`[Sessões] Não foi possível carregar as sessões encerradas: ${erro.message}`);
    });
  return carregadas;
}

// Anota de tempos em tempos que a sessão foi usada, sem gravar a cada pedido.
function marcarUso(sid) {
  if (!sid) return;
  const agora = Date.now();
  if (agora - (ultimoUso.get(sid) || 0) < ATUALIZAR_USO_A_CADA_MS) return;
  if (ultimoUso.size > 20000) ultimoUso.clear();
  ultimoUso.set(sid, agora);
  LoginSite.updateOne({ sid }, { $set: { vistaEm: new Date(agora) } }).catch(() => {});
}

async function encerrar(filtro) {
  const sessoes = await LoginSite.find({ ...filtro, sid: { $ne: null }, encerradaEm: null }).select('sid').lean();
  for (const sessao of sessoes) encerradas.add(sessao.sid);
  if (sessoes.length) await LoginSite.updateMany({ sid: { $in: sessoes.map(item => item.sid) } }, { $set: { encerradaEm: new Date() } });
  return sessoes.length;
}

// Chamado em cada login. Guarda o registro e, se for alguém da staff entrando
// de um IP que a conta nunca usou, avisa os responsáveis do servidor.
function criarRegistroDeLogin(client) {
  return async function registrarLogin({ usuarioId, nome, ip, agente, sid }) {
    if (!usuarioId) return;
    try {
      const anteriores = await LoginSite.find({ usuarioId }).select('ip').limit(200).lean();
      const ipNovo = anteriores.length > 0 && Boolean(ip) && !anteriores.some(item => item.ip === ip);
      await LoginSite.create({ usuarioId, nome: String(nome || '').slice(0, 80), ip: String(ip || '').slice(0, 45), agente: String(agente || '').slice(0, 300), sid: sid || null, vistaEm: new Date(), ipNovo });
      if (!ipNovo) return;

      const servidores = await servidoresDoUsuario(client, usuarioId);
      for (const { guild, config, papeis } of servidores) {
        if (!papeis.staff) continue;
        const responsaveis = [...(guild.roles.cache.get(config.roles?.responsavel_admin)?.members.keys() || [])].filter(id => id !== usuarioId);
        await enviarPush(responsaveis, {
          titulo: 'Login de um IP novo',
          corpo: `${nome || 'Alguém da staff'} entrou no site de um IP que nunca tinha usado (${guild.name}).`,
          url: '/#/logins',
          tag: `login-${usuarioId}`
        });
      }
    } catch (erro) {
      // O registro nunca atrapalha o login.
      console.warn(`[Sessões] Não foi possível registrar o login: ${erro.message}`);
    }
  };
}

function registrarRotasDeSessoes(router) {
  // Onde a conta está logada agora.
  router.get('/sessoes', assincrono(async (req, res) => {
    const sessoes = await LoginSite.find({
      usuarioId: req.usuario.id,
      sid: { $ne: null },
      encerradaEm: null,
      em: { $gte: new Date(Date.now() - DURACAO_SESSAO_MS) }
    }).sort({ em: -1 }).limit(30).lean();

    res.json({
      sessoes: sessoes.filter(item => !encerradas.has(item.sid)).map(item => ({
        id: String(item._id),
        atual: item.sid === req.sid,
        ip: item.ip,
        agente: item.agente,
        em: item.em,
        vistaEm: item.vistaEm || item.em,
        ipNovo: Boolean(item.ipNovo)
      })),
      // Login feito antes desta versão não tem identificador e não aparece na lista.
      semIdentificador: !req.sid
    });
  }));

  router.post('/sessoes/encerrar', express.json({ limit: '4kb' }), assincrono(async (req, res) => {
    if (req.body?.outras === true) {
      const total = await encerrar({ usuarioId: req.usuario.id, ...(req.sid ? { sid: { $nin: [req.sid, null] } } : {}) });
      return res.json({ ok: true, mensagem: total ? `${total} sessão(ões) encerrada(s). Só este aparelho continua logado.` : 'Não havia outra sessão aberta.' });
    }

    const id = String(req.body?.id || '');
    if (!/^[a-f0-9]{24}$/.test(id)) throw new ErroHttp(400, 'Sessão inválida.');
    const total = await encerrar({ _id: id, usuarioId: req.usuario.id });
    if (!total) throw new ErroHttp(404, 'Esta sessão já foi encerrada.');
    res.json({ ok: true, mensagem: 'Sessão encerrada. Aquele aparelho precisa entrar de novo.' });
  }));
}

// Ao sair da conta, a sessão deste aparelho deixa de valer mesmo que o cookie tenha sido copiado.
function encerrarSessao(sid) {
  if (!sid) return;
  encerradas.add(sid);
  LoginSite.updateOne({ sid }, { $set: { encerradaEm: new Date() } }).catch(() => {});
}

module.exports = { novoSid, sessaoEncerrada, carregarSessoesEncerradas, marcarUso, criarRegistroDeLogin, registrarRotasDeSessoes, encerrarSessao };
