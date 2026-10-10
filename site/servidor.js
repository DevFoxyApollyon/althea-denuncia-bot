const crypto = require('crypto');
const express = require('express');
const path = require('path');

const { criarRotas, ErroHttp, infoPublicaDoSite, criarLimitador } = require('./rotas');
const { limparCacheDeAcesso } = require('./acesso');
const { iniciarPush } = require('./push');
const {
  COOKIE_SESSAO,
  COOKIE_ESTADO,
  DURACAO_SESSAO_MS,
  DURACAO_ESTADO_MS,
  criarToken,
  lerToken,
  lerCookies,
  opcoesCookie
} = require('./sessao');

const DISCORD_API = 'https://discord.com/api/v10';
const VARIAVEIS = ['SITE_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'SESSION_SECRET'];

// O site é opcional: só sobe quando todas as variáveis dele estão no .env.
function lerConfigDoSite(env = process.env) {
  const faltando = VARIAVEIS.filter(nome => !String(env[nome] || '').trim());
  if (faltando.length === VARIAVEIS.length) return { ativo: false, faltando: [] };
  if (faltando.length) return { ativo: false, faltando };

  let origem;
  try {
    origem = new URL(env.SITE_URL.trim());
  } catch {
    return { ativo: false, faltando: ['SITE_URL (endereço inválido)'] };
  }

  if (env.SESSION_SECRET.trim().length < 32) {
    return { ativo: false, faltando: ['SESSION_SECRET (use pelo menos 32 caracteres)'] };
  }

  return {
    ativo: true,
    faltando: [],
    origem: origem.origin,
    seguro: origem.protocol === 'https:',
    porta: Number(env.SITE_PORT || env.PORT) || 80,
    clientId: env.CLIENT_ID.trim(),
    clientSecret: env.CLIENT_SECRET.trim(),
    segredo: env.SESSION_SECRET.trim()
  };
}

async function trocarCodigoPorUsuario(config, codigo) {
  const resposta = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: `${config.origem}/auth/retorno`
    })
  });
  if (!resposta.ok) throw new Error(`Discord recusou o código de login (${resposta.status}).`);

  const { access_token: token } = await resposta.json();
  const perfil = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!perfil.ok) throw new Error(`Não foi possível ler o perfil do Discord (${perfil.status}).`);

  // O token do Discord não é guardado: só serve para descobrir quem entrou.
  return perfil.json();
}

function criarApp({ client, config, log, buscarUsuarioDoCodigo = trocarCodigoPorUsuario }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      // O site não usa câmera, microfone, localização nem pagamentos.
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      // Em HTTPS, o navegador passa a recusar qualquer acesso sem criptografia.
      ...(config.seguro ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' https://cdn.discordapp.com https://media.discordapp.net https://i.ytimg.com data: blob:",
        // Vídeos do YouTube tocam dentro da conversa, pelo domínio sem cookies.
        "frame-src https://www.youtube-nocookie.com https://open.spotify.com",
        // blob: é a prévia local do arquivo escolhido, antes do envio.
        "media-src 'self' https://cdn.discordapp.com https://media.discordapp.net blob:",
        "style-src 'self'",
        "script-src 'self'",
        "connect-src 'self'",
        // O service worker recebe as notificações com o site fechado.
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'"
      ].join('; ')
    });
    next();
  });

  app.use((req, res, next) => {
    const sessao = lerToken(lerCookies(req)[COOKIE_SESSAO], config.segredo);
    req.usuario = sessao ? { id: sessao.id, nome: sessao.nome, avatar: sessao.avatar || null } : null;
    next();
  });

  // Requisições que alteram dados só são aceitas quando partem do próprio site.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.get('Origin');
    if (origem !== config.origem) return next(new ErroHttp(403, 'Origem da requisição não permitida.'));
    next();
  });

  // Freio geral contra abuso e automação: por pessoa logada ou, sem login, por IP.
  const dentroDoLimiteDaApi = criarLimitador(300, 60 * 1000);
  const dentroDoLimiteDeLogin = criarLimitador(20, 60 * 1000);
  app.use('/api', (req, res, next) => {
    if (dentroDoLimiteDaApi(req.usuario?.id || `ip:${req.ip}`)) return next();
    next(new ErroHttp(429, 'Muitas requisições em pouco tempo. Aguarde um minuto.'));
  });
  app.use('/auth', (req, res, next) => {
    if (dentroDoLimiteDeLogin(`ip:${req.ip}`)) return next();
    next(new ErroHttp(429, 'Muitas tentativas de login. Aguarde um minuto.'));
  });

  app.get('/auth/entrar', (req, res) => {
    const estado = crypto.randomBytes(24).toString('base64url');
    res.cookie(COOKIE_ESTADO, criarToken({ estado }, config.segredo, DURACAO_ESTADO_MS), opcoesCookie(config.seguro, DURACAO_ESTADO_MS));

    const destino = new URL('https://discord.com/oauth2/authorize');
    destino.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      scope: 'identify',
      redirect_uri: `${config.origem}/auth/retorno`,
      state: estado,
      prompt: 'none'
    }).toString();
    res.redirect(302, destino.toString());
  });

  app.get('/auth/retorno', async (req, res) => {
    const guardado = lerToken(lerCookies(req)[COOKIE_ESTADO], config.segredo);
    res.clearCookie(COOKIE_ESTADO, { path: '/' });

    const { code: codigo, state: estado } = req.query;
    if (!codigo || !guardado || typeof estado !== 'string' || estado !== guardado.estado) {
      return res.redirect(302, '/?erro=login');
    }

    try {
      const perfil = await buscarUsuarioDoCodigo(config, String(codigo));
      const avatar = perfil.avatar
        ? `https://cdn.discordapp.com/avatars/${perfil.id}/${perfil.avatar}.png?size=64`
        : null;
      const sessao = criarToken({ id: perfil.id, nome: perfil.global_name || perfil.username, avatar }, config.segredo);

      res.cookie(COOKIE_SESSAO, sessao, opcoesCookie(config.seguro, DURACAO_SESSAO_MS));
      res.redirect(302, '/');
    } catch (erro) {
      log.warn(`Login pelo site falhou: ${erro.message}`);
      res.redirect(302, '/?erro=login');
    }
  });

  app.post('/auth/sair', (req, res) => {
    if (req.usuario) limparCacheDeAcesso(req.usuario.id);
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    res.json({ ok: true });
  });

  // Público: a tela de login mostra o nome e o ícone do servidor.
  app.get('/api/site', (req, res) => res.json(infoPublicaDoSite(client)));

  app.use('/api', criarRotas({ client }));
  app.use('/api', (req, res, next) => next(new ErroHttp(404, 'Rota não encontrada.')));

  // O index.html não fica em cache: é ele que aponta para a versão atual do site.
  app.use(express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    maxAge: '5m',
    setHeaders: (res, arquivo) => {
      if (arquivo.endsWith('.html') || arquivo.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
    }
  }));

  app.use((erro, req, res, next) => {
    const status = erro.status
      || (erro.type === 'entity.too.large' ? 413 : null)
      || (erro.type === 'entity.parse.failed' ? 400 : null)
      || 500;

    if (status >= 500) log.error(`Erro no site (${req.method} ${req.path}): ${erro.stack || erro.message}`);

    const mensagem = status === 500
      ? 'Erro interno. Tente novamente em instantes.'
      : status === 413 && !erro.status
        ? 'O arquivo enviado é grande demais.'
        : erro.message;
    res.status(status).json({ erro: mensagem });
  });

  return app;
}

function iniciarSite(client, log) {
  const config = lerConfigDoSite();

  if (!config.ativo) {
    if (config.faltando.length) log.warn(`Site desligado. Faltam no .env: ${config.faltando.join(', ')}.`);
    else log.info('Site desligado (defina SITE_URL, CLIENT_SECRET e SESSION_SECRET para ligar).');
    return null;
  }

  const servidor = criarApp({ client, config, log }).listen(config.porta, () => {
    log.success(`Site no ar em ${config.origem} (porta ${config.porta}).`);
  });
  iniciarPush(log);
  servidor.on('error', (erro) => log.error(`Não foi possível iniciar o site: ${erro.message}`));
  return servidor;
}

module.exports = { iniciarSite, criarApp, lerConfigDoSite };
