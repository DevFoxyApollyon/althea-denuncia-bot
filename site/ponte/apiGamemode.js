// API que a gamemode usa para buscar os pedidos aprovados e devolver os resultados
// (protocolo gm/v1, doc/PONTE_GAMEMODE.md). Montada em /ponte/gm/v1 ANTES da checagem
// de Origin, sem sessão do site: a identidade vem da conexão e do HMAC na query.
// O corpo é lido cru, porque a assinatura vale sobre os bytes exatos; o JSON só é
// parseado depois da autenticação. O guildId sai sempre da conexão.
const express = require('express');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const PonteServidor = require('../../models/PonteServidor');
const PonteUso = require('../../models/PonteUso');
const { ponteLigada } = require('../../services/ponteSamp/gestao');
const { chaveMestraConfigurada, decifrar } = require('../../services/ponteSamp/cifra');
const { assinaturaConfere } = require('../../services/ponteSamp/protocoloGm');
const { entregarPedidos, lerResultado, registrarResultado } = require('../../services/ponteSamp/pedidosGm');
const { atualizarMensagemGm } = require('../../services/ponteSamp/discordGm');
const { alertarSeloInvalido, alertarIpBloqueado, alertarDevolucoes } = require('../../services/ponteSamp/alertasGm');
const PontePedidoGm = require('../../models/PontePedidoGm');
const { criarLimitador } = require('../rotas/comum');
const { ipDoCliente } = require('../protecao');

const RE_ID = /^[0-9a-f]{24}$/;
const RE_TS = /^\d{1,12}$/;
const RE_NONCE = /^[0-9a-f]{32}$/;
const RE_SIG = /^[0-9a-f]{64}$/;
const RE_VERSAO = /[^0-9A-Za-z._-]/g;
const JANELA_RELOGIO_S = 60;
const NONCE_MS = 10 * 60 * 1000;
const MAX_NONCES = 20000;
const BLOQUEIO_IP_MS = 10 * 60 * 1000;
const MAX_CORPO_RESULTADO = 2048;

class ErroGm extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

// "::ffff:1.2.3.4" e "1.2.3.4" são o mesmo IP.
const normalizarIp = (ip) => String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '');

function auditar(req, acao, extra = {}) {
  return PonteUso.create({
    guildId: req.gm?.conexao?.guildId || extra.guildId || '',
    acao,
    ip: ipDoCliente(req),
    ...extra
  }).catch(() => {});
}

// Nonces vistos por conexão nos últimos 10 minutos (no máximo 20 mil; sai o mais antigo).
function criarMemoriaNonces(agora) {
  const porConexao = new Map();
  const lista = (conexaoId) => {
    let mapa = porConexao.get(conexaoId);
    if (!mapa) porConexao.set(conexaoId, (mapa = new Map()));
    const limite = agora() - NONCE_MS;
    for (const [nonce, em] of mapa) {
      if (em >= limite) break;
      mapa.delete(nonce);
    }
    return mapa;
  };
  return {
    visto: (conexaoId, nonce) => lista(conexaoId).has(nonce),
    guardar: (conexaoId, nonce) => {
      const mapa = lista(conexaoId);
      mapa.set(nonce, agora());
      while (mapa.size > MAX_NONCES) mapa.delete(mapa.keys().next().value);
    }
  };
}

function criarApiGamemode({ client = null, log = null, limites = {}, agora = () => Date.now() } = {}) {
  const router = express.Router();
  const buscasPorConexao = criarLimitador(limites.buscas || 20, 60 * 1000);
  const resultadosPorConexao = criarLimitador(limites.resultados || 120, 60 * 1000);
  const falhasPorIp = criarLimitador(limites.falhas || 10, 60 * 1000);
  const bloqueioFalhas = new Map();
  const nonces = criarMemoriaNonces(agora);

  router.use(express.raw({ type: () => true, limit: '4kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Autenticação, nesta ordem: ponte → chave mestra → query → conexão → guild/executor
  // → IP → relógio → nonce → HMAC. Toda falha é auditada e conta para o bloqueio por IP.
  router.use(async (req, res, next) => {
    try {
      const ip = ipDoCliente(req);
      if ((bloqueioFalhas.get(ip) || 0) > agora()) throw new ErroGm(429, '', 'Muitas falhas de autenticação. Aguarde.');

      const falhar = async (status, codigo, mensagem, extra = {}) => {
        if (!falhasPorIp(ip) && !((bloqueioFalhas.get(ip) || 0) > agora())) {
          bloqueioFalhas.set(ip, agora() + BLOQUEIO_IP_MS);
          if (bloqueioFalhas.size > 5000) for (const [chave, ate] of bloqueioFalhas) if (ate <= agora()) bloqueioFalhas.delete(chave);
          alertarIpBloqueado(client, { ip, guildId: extra.guildId || '', minutos: BLOQUEIO_IP_MS / 60000 }).catch(() => {});
        }
        await auditar(req, 'gm_auth_falhou', { ...extra, detalhes: { codigo, caminho: req.path, ...(extra.detalhes || {}) } });
        throw new ErroGm(status, codigo, mensagem);
      };

      if (!ponteLigada()) throw new ErroGm(403, 'PONTE_DESLIGADA', 'Ponte desligada.');
      if (!chaveMestraConfigurada()) throw new ErroGm(503, '', 'Ponte com a gamemode não configurada no Althea.');

      const { id, ts, nonce, sig } = req.query;
      if (!RE_ID.test(String(id || ''))) await falhar(401, 'CREDENCIAL', 'Credencial inválida.');
      if (!RE_TS.test(String(ts || ''))) await falhar(401, 'RELOGIO', 'Horário inválido.');
      if (!RE_NONCE.test(String(nonce || ''))) await falhar(401, 'NONCE', 'Nonce inválido.');
      if (!RE_SIG.test(String(sig || ''))) await falhar(401, 'ASSINATURA', 'Assinatura inválida.');

      const conexao = await PonteConexaoGm.findById(String(id)).lean();
      if (!conexao) await falhar(401, 'CREDENCIAL', 'Credencial inválida.');
      const extra = { guildId: conexao.guildId, detalhes: { conexaoId: String(conexao._id) } };
      if (conexao.status !== 'ativa') await falhar(403, 'REVOGADA', 'Credencial revogada.', extra);

      const servidor = await PonteServidor.findOne({ guildId: conexao.guildId, ativo: true }).lean();
      if (!servidor) await falhar(403, 'GUILD_INATIVA', 'Ponte não ativa neste servidor.', extra);
      if (!['gamemode', 'ambos'].includes(servidor.executor)) await falhar(403, 'GUILD_INATIVA', 'Este servidor aplica as punições pelo PC.', extra);

      const permitidos = (conexao.ipsPermitidos || []).map(normalizarIp);
      if (permitidos.length && !permitidos.includes(normalizarIp(ip))) await falhar(403, 'IP', 'IP não permitido para esta credencial.', extra);

      if (Math.abs(Math.floor(agora() / 1000) - Number(ts)) > JANELA_RELOGIO_S) await falhar(401, 'RELOGIO', 'Relógio fora do horário do Althea.', extra);
      const conexaoId = String(conexao._id);
      if (nonces.visto(conexaoId, String(nonce))) await falhar(401, 'NONCE', 'Nonce repetido.', extra);

      let segredo;
      try {
        segredo = decifrar(conexao.segredoCifrado);
      } catch {
        // Chave mestra trocada depois da criação: só renovando a credencial.
        log?.error?.(`Ponte gamemode: não foi possível decifrar o segredo da conexão ${conexaoId}.`);
        throw new ErroGm(503, '', 'Credencial ilegível no Althea. Peça ao dono para renovar.');
      }
      const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const dados = { metodo: req.method, caminho: req.baseUrl + req.path, ts: String(ts), nonce: String(nonce), corpo };
      if (!assinaturaConfere(segredo, dados, String(sig))) await falhar(401, 'ASSINATURA', 'Assinatura não confere.', extra);
      // Só guarda o nonce de requisição autêntica: quem não tem o segredo não consegue queimar nonces.
      nonces.guardar(conexaoId, String(nonce));

      req.gm = { conexao, servidor, segredo, corpo, ip };
      next();
    } catch (erro) {
      next(erro);
    }
  });

  const rota = (fn) => (req, res, next) => fn(req, res).catch(next);

  router.get('/pedidos', rota(async (req, res) => {
    const { conexao, servidor, segredo, ip } = req.gm;
    if (!buscasPorConexao(String(conexao._id))) throw new ErroGm(429, '', 'Muitas buscas. Aguarde.');

    const limite = Math.min(20, Math.max(1, Math.floor(Number(req.query.limite)) || 10));
    const pausado = servidor.gm?.pausado === true || conexao.pausada === true;
    const pedidos = pausado ? [] : await entregarPedidos({ conexao, segredo, limite, agora: agora() });

    await PonteConexaoGm.updateOne({ _id: conexao._id }, {
      $set: {
        ultimoContatoEm: new Date(agora()),
        ultimoIp: ip,
        versaoInclude: String(req.query.versao || '').replace(RE_VERSAO, '').slice(0, 20),
        modoTesteInformado: String(req.query.teste || '') === '1'
      }
    });
    // A busca vazia (a cada 10 s) não entra na auditoria, senão a coleção enche.
    if (pedidos.length) {
      auditar(req, 'gm_busca', { detalhes: { conexaoId: String(conexao._id), pedidos: pedidos.map(p => p.id) } });
      // Embed da punição: "📤 entregue" em cada alvo buscado.
      PontePedidoGm.distinct('punicaoId', { _id: { $in: pedidos.map(p => p.id) } })
        .then(ids => Promise.all(ids.map(id => atualizarMensagemGm(client, id))))
        .catch(() => {});
    }

    res.json({ ok: true, agora: Math.floor(agora() / 1000), pausado, pedidos });
  }));

  router.post('/resultados/:pedidoId', rota(async (req, res) => {
    const { conexao, corpo } = req.gm;
    if (!resultadosPorConexao(String(conexao._id))) throw new ErroGm(429, '', 'Muitos resultados. Aguarde.');
    if (corpo.length > MAX_CORPO_RESULTADO) throw new ErroGm(413, '', 'Corpo grande demais.');

    let json;
    try {
      json = JSON.parse(corpo.toString('utf8'));
    } catch {
      throw new ErroGm(400, '', 'JSON inválido.');
    }
    const dados = lerResultado(json);
    if (dados.erro) throw new ErroGm(400, '', dados.erro);

    const r = await registrarResultado({ client, conexao, pedidoId: req.params.pedidoId, dados, agora: agora() });
    if (r.http === 404) throw new ErroGm(404, '', 'Pedido não encontrado nesta conexão.');
    if (r.http === 409) throw new ErroGm(409, '', 'O pedido já tem outro resultado.');

    if (r.novo) {
      await auditar(req, 'gm_resultado', {
        punicaoId: r.pedido.punicaoId,
        contaId: String(dados.conta || r.pedido.conta || ''),
        nick: dados.nome || r.pedido.nick || '',
        detalhes: { conexaoId: String(conexao._id), pedidoId: String(r.pedido._id), status: dados.status, codigo: dados.codigo }
      });
      atualizarMensagemGm(client, r.pedido.punicaoId).catch(() => {});
    }
    if (r.alerta === 'selo') {
      // Selo recusado pela gamemode: ela já pausou do lado dela; aqui a conexão pausa também.
      await PonteConexaoGm.updateOne({ _id: conexao._id }, { $set: { pausada: true } });
      await auditar(req, 'gm_selo_invalido', { punicaoId: r.pedido.punicaoId, detalhes: { conexaoId: String(conexao._id), pedidoId: String(r.pedido._id) } });
      alertarSeloInvalido(client, { conexao, pedido: r.pedido }).catch(() => {});
    }
    if (r.alerta === 'devolucoes') alertarDevolucoes(client, { pedido: r.pedido }).catch(() => {});
    res.json({ ok: true });
  }));

  router.use((req, res) => res.status(404).json({ ok: false, erro: 'Rota não encontrada.' }));

  router.use((erro, req, res, next) => {
    const status = erro.status
      || (erro.type === 'entity.too.large' ? 413 : null)
      || 500;
    if (status >= 500 && status !== 503) log?.error?.(`Erro na API da gamemode (${req.method} ${req.path}): ${erro.stack || erro.message}`);
    res.status(status).json({ ok: false, ...(erro.codigo ? { codigo: erro.codigo } : {}), erro: status === 500 ? 'Erro interno.' : erro.message });
  });

  return router;
}

module.exports = { criarApiGamemode };
