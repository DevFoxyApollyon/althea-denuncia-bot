const crypto = require('crypto');

const COOKIE_SESSAO = 'althea_sessao';
const COOKIE_ESTADO = 'althea_estado';
const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000;
const DURACAO_ESTADO_MS = 10 * 60 * 1000;

const base64url = (texto) => Buffer.from(texto, 'utf8').toString('base64url');

function assinar(payload, segredo) {
  return crypto.createHmac('sha256', segredo).update(payload).digest('base64url');
}

// A sessão é um cookie assinado (HMAC): não há armazenamento no servidor, e o
// conteúdo não pode ser alterado sem o SESSION_SECRET.
function criarToken(dados, segredo, duracaoMs = DURACAO_SESSAO_MS) {
  const payload = base64url(JSON.stringify({ ...dados, exp: Date.now() + duracaoMs }));
  return `${payload}.${assinar(payload, segredo)}`;
}

function lerToken(token, segredo) {
  if (typeof token !== 'string') return null;
  const [payload, assinatura, ...resto] = token.split('.');
  if (!payload || !assinatura || resto.length) return null;

  const esperada = Buffer.from(assinar(payload, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof dados?.exp !== 'number' || dados.exp < Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

function lerCookies(req) {
  const cookies = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const indice = parte.indexOf('=');
    if (indice < 0) continue;
    const nome = parte.slice(0, indice).trim();
    if (!nome) continue;
    try {
      cookies[nome] = decodeURIComponent(parte.slice(indice + 1).trim());
    } catch {
      // cookie malformado: ignora
    }
  }
  return cookies;
}

function opcoesCookie(seguro, maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: seguro, path: '/', maxAge: maxAgeMs };
}

module.exports = {
  COOKIE_SESSAO,
  COOKIE_ESTADO,
  DURACAO_SESSAO_MS,
  DURACAO_ESTADO_MS,
  criarToken,
  lerToken,
  lerCookies,
  opcoesCookie
};
