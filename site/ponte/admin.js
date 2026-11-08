// Painel web do dono do bot (/admin): servidores, gamemode, auditoria e códigos da ponte.
// Abre para OWNER_DISCORD_ID e para as pessoas que ele liberou (aba Acessos); para qualquer
// outro responde 404, para não revelar que a rota existe.
// Só o dono: gerenciar acessos, trocar a chave mestra, gerar/expirar códigos e desativar servidores.
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const PonteServidor = require('../../models/PonteServidor');
const PonteCodigo = require('../../models/PonteCodigo');
const PonteUso = require('../../models/PonteUso');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PontePunicao = require('../../models/PontePunicao');
const gestao = require('../../services/ponteSamp/gestao');
const { ACOES_USO, STATUS_PEDIDO_GM, VERSAO_INCLUDE_GM: VERSAO_INCLUDE, LIMITES_GM_PADRAO } = require('../../services/ponteSamp/constantes');
const { chaveMestraConfigurada, impressaoDaChave } = require('../../services/ponteSamp/cifra');
const { trocarChaveMestra } = require('../../services/ponteSamp/chaveMestra');
const acessos = require('../../services/ponteSamp/acessoAdmin');
const { lerIps } = require('../../services/ponteSamp/conexoesGm');
const { criarToken, lerToken } = require('../sessao');
const { criarLimitador } = require('../rotas/comum');

const PASTA = path.join(__dirname, 'painel');
const DURACAO_CSRF_MS = 2 * 60 * 60 * 1000;
// A gamemode busca a cada 10 s com a fila vazia.
const ONLINE_GM_MS = 30 * 1000;

// arquivoEnv: só nos testes (a troca da chave mestra grava no .env do projeto).
function criarAdmin({ client, config, log, arquivoEnv }) {
  const router = express.Router();
  const limite = criarLimitador(120, 60 * 1000);
  const naoExiste = (res) => res.status(404).json({ erro: 'Rota não encontrada.' });
  const nomeGuild = (id) => client?.guilds?.cache?.get(id)?.name || '';

  router.use(async (req, res, next) => {
    if (!req.usuario || !(await acessos.podeAbrirPainel(req.usuario.id))) return naoExiste(res);
    if (!limite(req.usuario.id)) return res.status(429).json({ erro: 'Muitas requisições. Aguarde um minuto.' });
    req.dono = gestao.ehDono(req.usuario.id);
    res.set('Cache-Control', 'no-store');
    next();
  });
  const soDono = (req, res, next) => (req.dono ? next() : res.status(403).json({ erro: 'Só o dono do bot pode fazer isso.' }));

  router.get('/', (req, res) => res.sendFile(path.join(PASTA, 'index.html')));
  router.get(['/admin.js', '/admin.css'], (req, res) => res.sendFile(path.join(PASTA, path.basename(req.path))));

  router.use('/api', express.json({ limit: '8kb' }));
  router.get('/api/csrf', (req, res) => {
    res.json({ csrf: criarToken({ sid: req.sid, csrf: true }, config.segredo, DURACAO_CSRF_MS), dono: req.dono });
  });

  // A checagem de Origin do app já cobre os POSTs; o token CSRF é uma segunda barreira.
  router.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    const dados = lerToken(String(req.get('X-CSRF') || ''), config.segredo);
    if (!dados?.csrf || dados.sid !== req.sid) return res.status(403).json({ erro: 'Token CSRF inválido. Recarregue a página.' });
    next();
  });

  const rota = (fn) => (req, res) => fn(req, res).catch((erro) => {
    log?.error?.(`Erro no /admin (${req.method} ${req.path}): ${erro.stack || erro.message}`);
    res.status(500).json({ erro: 'Erro interno.' });
  });
  const idValido = (id) => mongoose.isValidObjectId(id);

  // Nome de quem fez algo, pelo ID do Discord (cache do bot; se não tiver, pergunta ao Discord).
  async function nomesDe(ids) {
    const unicos = [...new Set(ids.filter(id => /^\d{15,21}$/.test(String(id || ''))))];
    const pares = await Promise.all(unicos.map(async (id) => {
      const usuario = client?.users?.cache?.get(id) || await client?.users?.fetch?.(id).catch(() => null);
      return [id, usuario?.globalName || usuario?.username || ''];
    }));
    return new Map(pares);
  }

  // Quem fez cada registro da auditoria: a gamemode ou a pessoa do Discord.
  async function autoresDe(registros) {
    const conexoes = [...new Set(registros.map(u => u.detalhes?.conexaoId).filter(id => idValido(id)))];
    const [gms, nomes] = await Promise.all([
      conexoes.length ? PonteConexaoGm.find({ _id: { $in: conexoes } }, { nome: 1 }).lean() : [],
      nomesDe(registros.map(u => u.detalhes?.por || u.detalhes?.userId))
    ]);
    const nomeGm = new Map(gms.map(c => [String(c._id), c.nome]));
    return (u) => {
      const por = u.detalhes?.por;
      if (u.detalhes?.nome || por) return { tipo: 'pessoa', nome: u.detalhes?.nome || nomes.get(por) || por, id: por || '' };
      if (nomeGm.has(String(u.detalhes?.conexaoId))) return { tipo: 'gamemode', nome: nomeGm.get(String(u.detalhes.conexaoId)) };
      return { tipo: '', nome: '' };
    };
  }

  // Ações que acontecem sozinhas o tempo todo: não contam como "último uso" nem entram na atividade.
  const ACOES_ROTINA = ['gm_busca'];

  router.get('/api/servidores', rota(async (req, res) => {
    const [servidores, ultimos] = await Promise.all([
      PonteServidor.find().sort({ ativadoEm: -1 }).limit(500).lean(),
      PonteUso.aggregate([
        { $match: { guildId: { $ne: '' }, acao: { $nin: ACOES_ROTINA } } },
        { $sort: { em: -1 } },
        { $group: { _id: '$guildId', registro: { $first: '$$ROOT' } } }
      ])
    ]);
    const ultimoPorGuild = new Map(ultimos.map(u => [u._id, u.registro]));
    const [autor, ativadores] = await Promise.all([
      autoresDe([...ultimoPorGuild.values()]),
      nomesDe(servidores.map(s => s.ativadoPor))
    ]);
    res.json(servidores.map(s => {
      const ultimo = ultimoPorGuild.get(s.guildId);
      return {
        guildId: s.guildId, nome: nomeGuild(s.guildId), ativo: s.ativo, ativadoEm: s.ativadoEm,
        ativadoPor: s.ativadoPor ? { id: s.ativadoPor, nome: ativadores.get(s.ativadoPor) || '' } : null,
        ultimoUso: ultimo ? { em: ultimo.em, acao: ultimo.acao, quem: autor(ultimo) } : null
      };
    }));
  }));

  // Status ao vivo de cada servidor ativo: se a gamemode está online, o que está na fila e a última punição aplicada. A tela pede de
  // novo a cada 15 segundos enquanto a Visão geral está aberta.
  router.get('/api/status', rota(async (req, res) => {
    const servidores = await PonteServidor.find({ ativo: true }, { guildId: 1, gm: 1 }).lean();
    const guilds = servidores.map(s => s.guildId);
    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [conexoes, punicoes, pedidos, aplicadas, respostas] = await Promise.all([
      PonteConexaoGm.find({ guildId: { $in: guilds }, status: 'ativa' }, { guildId: 1, ultimoContatoEm: 1, pausada: 1 }).lean(),
      PontePunicao.aggregate([
        { $match: { guildId: { $in: guilds }, status: { $in: ['aceita', 'executando'] } } },
        { $group: { _id: { guildId: '$guildId', status: '$status' }, total: { $sum: 1 } } }
      ]),
      PontePedidoGm.aggregate([
        { $match: { guildId: { $in: guilds }, status: { $in: ['aprovado', 'entregue', 'incerto'] } } },
        { $group: { _id: { guildId: '$guildId', status: '$status' }, total: { $sum: 1 } } }
      ]),
      PonteUso.aggregate([
        { $match: { guildId: { $in: guilds }, acao: 'gm_resultado' } },
        { $sort: { em: -1 } },
        { $group: { _id: '$guildId', em: { $first: '$em' }, acao: { $first: '$acao' }, nick: { $first: '$nick' }, contaId: { $first: '$contaId' } } }
      ]),
      // Tempo de resposta da gamemode nas últimas 24 h (o timeout conta à parte).
      PontePedidoGm.aggregate([
        { $match: { guildId: { $in: guilds }, respondidoEm: { $gte: desde24h } } },
        { $group: {
          _id: '$guildId',
          media: { $avg: { $cond: [{ $and: [{ $ne: ['$codigo', 'TIMEOUT_GAMEMODE'] }, { $ne: ['$segundosResposta', null] }] }, '$segundosResposta', null] } },
          maximo: { $max: { $cond: [{ $ne: ['$codigo', 'TIMEOUT_GAMEMODE'] }, '$segundosResposta', null] } },
          respondidos: { $sum: { $cond: [{ $ne: ['$codigo', 'TIMEOUT_GAMEMODE'] }, 1, 0] } },
          timeouts: { $sum: { $cond: [{ $eq: ['$codigo', 'TIMEOUT_GAMEMODE'] }, 1, 0] } }
        } }
      ])
    ]);
    const agora = Date.now();
    const conta = (lista, guildId, status) => lista.find(p => p._id.guildId === guildId && p._id.status === status)?.total || 0;
    res.json({
      em: new Date(agora),
      servidores: servidores.map(s => {
        const gms = conexoes.filter(c => c.guildId === s.guildId);
        const contato = gms.map(c => c.ultimoContatoEm).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
        const ultima = aplicadas.find(a => a._id === s.guildId);
        const resposta = respostas.find(r => r._id === s.guildId);
        return {
          guildId: s.guildId,
          nome: nomeGuild(s.guildId),
          pausado: s.gm?.pausado === true,
          modoTeste: s.gm?.modoTeste !== false,
          gamemode: {
            credenciais: gms.length,
            pausadas: gms.filter(c => c.pausada).length,
            online: !!contato && agora - new Date(contato).getTime() < ONLINE_GM_MS,
            ultimoContatoEm: contato
          },
          fila: {
            esperando: conta(punicoes, s.guildId, 'aceita'),
            executando: conta(punicoes, s.guildId, 'executando'),
            paraGamemode: conta(pedidos, s.guildId, 'aprovado'),
            comGamemode: conta(pedidos, s.guildId, 'entregue'),
            incertos: conta(pedidos, s.guildId, 'incerto')
          },
          ultimaAplicada: ultima ? { em: ultima.em, por: 'gamemode', alvo: ultima.nick || ultima.contaId || '' } : null,
          resposta: resposta ? {
            media: resposta.media === null ? null : Math.round(resposta.media),
            maximo: resposta.maximo ?? null,
            respondidos: resposta.respondidos,
            timeouts: resposta.timeouts
          } : null
        };
      })
    });
  }));

  // Pedidos incertos (a gamemode não respondeu), agrupados por punição, para resolver
  // pelo painel com os mesmos efeitos dos botões do Discord.
  router.get('/api/gamemode/incertos', rota(async (req, res) => {
    const incertos = await PontePedidoGm.find({ status: 'incerto' }).sort({ entregueEm: 1 }).limit(200).lean();
    const punicoes = await PontePunicao.find({ _id: { $in: [...new Set(incertos.map(p => String(p.punicaoId)))] } }, { msgDiscord: 1, aceitoPor: 1, guildId: 1 }).lean();
    const porId = new Map(punicoes.map(p => [String(p._id), p]));
    const grupos = new Map();
    for (const p of incertos) {
      const chave = String(p.punicaoId);
      if (!grupos.has(chave)) {
        const punicao = porId.get(chave);
        grupos.set(chave, {
          punicaoId: chave, guildId: p.guildId, guild: nomeGuild(p.guildId),
          link: punicao?.msgDiscord?.link || '', acusado: punicao?.msgDiscord?.acusado || '', aceitoPor: punicao?.aceitoPor?.nome || '',
          alvos: []
        });
      }
      grupos.get(chave).alvos.push({
        pedidoId: String(p._id), conta: p.conta || 0, nick: p.nick || '', tipo: p.tipo, tempo: p.tempo, avisos: p.avisos,
        motivo: p.motivo, codigo: p.codigo || '', entregueEm: p.entregueEm, rodada: p.rodada
      });
    }
    res.json([...grupos.values()]);
  }));

  router.post('/api/gamemode/incertos/:punicaoId', rota(async (req, res) => {
    if (!idValido(req.params.punicaoId)) return res.status(400).json({ erro: 'ID inválido.' });
    const punicao = await PontePunicao.findById(req.params.punicaoId, { guildId: 1 }).lean();
    if (!punicao) return res.status(404).json({ erro: 'Punição não encontrada.' });
    const aplicada = req.body?.aplicada === true;
    const staff = { id: req.usuario.id, nome: `${req.usuario.nome || req.usuario.id} (painel)` };
    const r = await require('../../services/ponteSamp/incertosGm').resolverIncertosDaPunicao({ client, punicaoId: punicao._id, guildId: punicao.guildId, staff, aplicada });
    if (r.erro) return res.status(409).json({ erro: r.erro });
    res.json({ ok: true, ...r, mensagem: aplicada ? 'Registrado como aplicado.' : 'Enviada de novo para a gamemode.' });
  }));

  // O que aconteceu por último na ponte, em todos os servidores (sem as ações de rotina).
  router.get('/api/atividade', rota(async (req, res) => {
    const lista = await PonteUso.find({ acao: { $nin: ACOES_ROTINA } }).sort({ em: -1 }).limit(25).lean();
    const autor = await autoresDe(lista);
    res.json(lista.map(u => ({
      em: u.em, guildId: u.guildId, guild: nomeGuild(u.guildId), acao: u.acao, quem: autor(u),
      contaId: u.contaId, nick: u.nick, comando: u.comando, sub: u.detalhes?.sub || ''
    })));
  }));

  router.post('/api/servidores/:guildId/desativar', soDono, rota(async (req, res) => {
    if (!/^\d{5,25}$/.test(req.params.guildId)) return res.status(400).json({ erro: 'ID inválido.' });
    const s = await gestao.desativarGuild({ guildId: req.params.guildId, por: req.usuario.id });
    log?.info?.(`Ponte desativada pelo dono em ${req.params.guildId}`);
    res.json({ ok: !!s });
  }));

  // Controles da gamemode de um servidor (os mesmos de /ponte gamemode pausar/retomar
  // e dos limites, com o modo teste). Só o dono.
  router.post('/api/servidores/:guildId/gamemode', soDono, rota(async (req, res) => {
    const { guildId } = req.params;
    if (!/^\d{5,25}$/.test(guildId)) return res.status(400).json({ erro: 'ID inválido.' });
    const servidor = await PonteServidor.findOne({ guildId, ativo: true }).lean();
    if (!servidor) return res.status(404).json({ erro: 'A ponte não está ativa neste servidor.' });

    const { pausado, modoTeste, limites } = req.body || {};
    const $set = {};
    // Limites dos envios à gamemode (os mesmos do /ponte gamemode limites).
    if (limites !== undefined) {
      const inteiro = (valor, rotulo, min, max) => {
        const n = Number(valor);
        if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`${rotulo}: use um número de ${min} a ${max}.`), { status: 400 });
        return n;
      };
      try {
        $set['gm.maxBanDias'] = inteiro(limites?.maxBanDias, 'Ban máximo', 1, 99999);
        $set['gm.maxCadeiaMin'] = inteiro(limites?.maxCadeiaMin, 'Cadeia máxima', 1, 99999);
        $set['gm.maxAvisos'] = inteiro(limites?.maxAvisos, 'Avisos', 0, 10);
      } catch (erro) {
        return res.status(400).json({ erro: erro.message });
      }
      $set['gm.permitirPermanente'] = limites?.permitirPermanente === true;
    }
    if (pausado !== undefined) $set['gm.pausado'] = pausado === true;
    if (modoTeste !== undefined) $set['gm.modoTeste'] = modoTeste === true;
    if (!Object.keys($set).length) return res.status(400).json({ erro: 'Nada para mudar.' });

    await PonteServidor.updateOne({ guildId }, { $set });
    // Retomar também solta as credenciais pausadas por selo inválido, como no comando.
    let conexoesRetomadas = 0;
    if (pausado === false) {
      ({ modifiedCount: conexoesRetomadas } = await PonteConexaoGm.updateMany({ guildId, status: 'ativa', pausada: true }, { $set: { pausada: false } }));
    }
    const sub = pausado !== undefined ? (pausado ? 'pausar' : 'retomar') : 'limites';
    const novosLimites = limites !== undefined
      ? { maxBanDias: $set['gm.maxBanDias'], maxCadeiaMin: $set['gm.maxCadeiaMin'], maxAvisos: $set['gm.maxAvisos'], permitirPermanente: $set['gm.permitirPermanente'] }
      : null;
    await PonteUso.create({
      guildId, acao: 'gm_config',
      detalhes: { sub, via: 'admin', por: req.usuario.id,
        ...(modoTeste !== undefined ? { modoTeste: modoTeste === true } : {}), ...(novosLimites || {}), ...(conexoesRetomadas ? { conexoesRetomadas } : {}) }
    }).catch(() => {});
    res.json({ ok: true, conexoesRetomadas });
  }));

  // Paginação por data: "antes" é o "em" do último item da página anterior.
  router.get('/api/uso', rota(async (req, res) => {
    const filtro = {};
    if (/^\d{5,25}$/.test(String(req.query.guildId || ''))) filtro.guildId = String(req.query.guildId);
    if (ACOES_USO.includes(String(req.query.acao || ''))) filtro.acao = String(req.query.acao);
    // "gm": todas as ações da ponte com a gamemode (gm_*).
    else if (req.query.acao === 'gm') filtro.acao = { $in: ACOES_USO.filter(a => a.startsWith('gm_')) };
    const antes = new Date(String(req.query.antes || ''));
    if (!Number.isNaN(antes.getTime())) filtro.em = { $lt: antes };
    const lista = await PonteUso.find(filtro).sort({ em: -1 }).limit(50).lean();
    res.json(lista.map(u => ({
      em: u.em, guildId: u.guildId, guild: nomeGuild(u.guildId), acao: u.acao,
      contaId: u.contaId, nick: u.nick, comando: u.comando, ip: u.ip, detalhes: u.detalhes
    })));
  }));

  router.get('/api/codigos', rota(async (req, res) => {
    const lista = await PonteCodigo.find().sort({ criadoEm: -1 }).limit(200).lean();
    res.json(lista.map(c => ({
      id: String(c._id), ultimos4: c.ultimos4, criadoEm: c.criadoEm, expiraEm: c.expiraEm,
      usadoEm: c.usadoEm, usadoPorGuild: c.usadoPorGuild, guild: nomeGuild(c.usadoPorGuild), expirado: c.expirado
    })));
  }));

  router.post('/api/codigos', soDono, rota(async (req, res) => {
    const validadeDias = Number(req.body?.validadeDias) || null;
    if (validadeDias && (validadeDias < 1 || validadeDias > 365)) return res.status(400).json({ erro: 'Validade (1–365) inválida.' });
    const { codigo } = await gestao.criarCodigo({ criadoPor: req.usuario.id, validadeDias });
    res.json({ ok: true, codigo });
  }));

  // Apagar de vez um código (some da lista). Fica registrado na auditoria quem apagou o quê.
  const apagar = (Modelo, tipo, campos) => rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const doc = await Modelo.findOneAndDelete({ _id: req.params.id }, { projection: campos }).lean();
    if (doc) {
      await PonteUso.create({
        guildId: doc.guildId || doc.usadoPorGuild || '', acao: 'apagar',
        detalhes: { sub: `apagar_${tipo}`, id: req.params.id, item: doc.nome || (doc.ultimos4 ? `…${doc.ultimos4}` : ''), por: req.usuario.id }
      }).catch(() => {});
    }
    res.json({ ok: !!doc });
  });
  router.post('/api/codigos/:id/apagar', soDono, apagar(PonteCodigo, 'codigo', { ultimos4: 1, usadoPorGuild: 1 }));

  router.post('/api/codigos/:id/expirar', soDono, rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const r = await PonteCodigo.updateOne({ _id: req.params.id, usadoEm: null }, { $set: { expirado: true } });
    res.json({ ok: r.matchedCount === 1 });
  }));

  // Credenciais da gamemode. O segredo (nem cifrado) nunca sai daqui.
  router.get('/api/gamemode/conexoes', rota(async (req, res) => {
    const [lista, servidores] = await Promise.all([
      PonteConexaoGm.find({}, { segredoCifrado: 0 }).sort({ criadoEm: -1 }).limit(200).lean(),
      PonteServidor.find({}, { guildId: 1, gm: 1 }).lean()
    ]);
    const porGuild = new Map(servidores.map(s => [s.guildId, s]));
    const agora = Date.now();
    res.json(lista.map(c => {
      const servidor = porGuild.get(c.guildId);
      return {
        id: String(c._id), guildId: c.guildId, guild: nomeGuild(c.guildId), nome: c.nome, status: c.status, pausada: c.pausada,
        online: c.status === 'ativa' && !!c.ultimoContatoEm && agora - new Date(c.ultimoContatoEm).getTime() < ONLINE_GM_MS,
        ultimoContatoEm: c.ultimoContatoEm, ultimoIp: c.ultimoIp, versaoInclude: c.versaoInclude, modoTesteInformado: c.modoTesteInformado,
        ipsPermitidos: c.ipsPermitidos || [], ultimos4: c.ultimos4, criadoEm: c.criadoEm,
        guildPausada: servidor?.gm?.pausado === true, modoTesteGuild: servidor?.gm?.modoTeste !== false
      };
    }));
  }));

  router.post('/api/gamemode/conexoes/:id/revogar', rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' },
      { $set: { status: 'revogada', revogadoEm: new Date(), revogadoPor: req.usuario.id } },
      { projection: { guildId: 1 } }
    ).lean();
    if (c) await PonteUso.create({ guildId: c.guildId, acao: 'gm_credencial', detalhes: { sub: 'revogar', via: 'admin', conexaoId: req.params.id, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: !!c });
  }));

  // Trava por IP da credencial: só esses IPs conseguem usar (vazio = qualquer IP). Só o dono.
  // Nome da credencial (aparece no relatório: "Aplicada pela gamemode (nome)"). Só o dono.
  router.post('/api/gamemode/conexoes/:id/nome', soDono, rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const nome = String(req.body?.nome || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 40);
    if (!nome) return res.status(400).json({ erro: 'Nome inválido: use letras, números, espaço, _ . ou -.' });
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' },
      { $set: { nome } },
      { projection: { guildId: 1, nome: 1 } }
    ).lean();
    if (!c) return res.status(404).json({ erro: 'Credencial não encontrada ou revogada.' });
    await PonteUso.create({
      guildId: c.guildId, acao: 'gm_credencial',
      detalhes: { sub: 'renomear', via: 'admin', conexaoId: req.params.id, por: req.usuario.id, de: c.nome, para: nome }
    }).catch(() => {});
    res.json({ ok: true, nome });
  }));

  router.post('/api/gamemode/conexoes/:id/ips', soDono, rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const lidos = lerIps(Array.isArray(req.body?.ips) ? req.body.ips.join(',') : req.body?.ips);
    if (lidos.erro) return res.status(400).json({ erro: lidos.erro.replace(/`/g, '') });
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' },
      { $set: { ipsPermitidos: lidos.ips } },
      { projection: { guildId: 1, ipsPermitidos: 1 } }
    ).lean();
    if (!c) return res.status(404).json({ erro: 'Credencial não encontrada ou revogada.' });
    await PonteUso.create({
      guildId: c.guildId, acao: 'gm_credencial',
      detalhes: { sub: 'ips', via: 'admin', conexaoId: req.params.id, por: req.usuario.id, de: c.ipsPermitidos || [], para: lidos.ips }
    }).catch(() => {});
    res.json({ ok: true, ips: lidos.ips });
  }));

  router.post('/api/gamemode/conexoes/:id/pausar', rota(async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ erro: 'ID inválido.' });
    const pausada = req.body?.pausada !== false;
    const c = await PonteConexaoGm.findOneAndUpdate(
      { _id: req.params.id, status: 'ativa' }, { $set: { pausada } }, { projection: { guildId: 1 } }
    ).lean();
    if (c) await PonteUso.create({ guildId: c.guildId, acao: 'gm_config', detalhes: { sub: pausada ? 'pausar' : 'retomar', via: 'admin', conexaoId: req.params.id, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: !!c });
  }));

  // Pedidos recentes da gamemode, mais novos primeiro (filtro por status e guild).
  router.get('/api/gamemode/pedidos', rota(async (req, res) => {
    const filtro = {};
    if (STATUS_PEDIDO_GM.includes(String(req.query.status || ''))) filtro.status = String(req.query.status);
    if (/^\d{5,25}$/.test(String(req.query.guildId || ''))) filtro.guildId = String(req.query.guildId);
    const lista = await PontePedidoGm.find(filtro).sort({ criadoEm: -1 }).limit(100).lean();
    res.json(lista.map(p => ({
      id: String(p._id), punicaoId: String(p.punicaoId), guildId: p.guildId, guild: nomeGuild(p.guildId), rodada: p.rodada,
      tipo: p.tipo, conta: p.conta, nick: p.nick, tempo: p.tempo, avisos: p.avisos, motivo: p.motivo, aprovadoPor: p.aprovadoPor,
      teste: p.teste, status: p.status, codigo: p.codigo, entregas: p.entregas, devolucoes: p.devolucoes,
      criadoEm: p.criadoEm, entregueEm: p.entregueEm, resultado: p.resultado, resolvidoPor: p.resolvidoPor?.nome || ''
    })));
  }));

  // Pessoas liberadas no painel (pelo ID do Discord). Só o dono vê e mexe.
  router.get('/api/acessos', soDono, rota(async (req, res) => {
    const lista = await acessos.listarAcessos();
    res.json(lista.map(a => ({ userId: a.userId, nome: a.nome, adicionadoEm: a.adicionadoEm })));
  }));

  router.post('/api/acessos', soDono, rota(async (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    const usuario = /^\d{15,21}$/.test(userId) && client?.users ? await client.users.fetch(userId).catch(() => null) : null;
    const r = await acessos.adicionarAcesso({ userId, nome: usuario?.globalName || usuario?.username || '', por: req.usuario.id });
    if (r.erro) return res.status(400).json({ erro: r.erro });
    await PonteUso.create({ acao: 'gm_config', detalhes: { sub: 'acesso_admin_adicionar', userId, por: req.usuario.id } }).catch(() => {});
    res.json({ ok: true, nome: r.acesso.nome, encontrado: !!usuario });
  }));

  router.post('/api/acessos/:userId/remover', soDono, rota(async (req, res) => {
    const ok = await acessos.removerAcesso(req.params.userId);
    if (ok) await PonteUso.create({ acao: 'gm_config', detalhes: { sub: 'acesso_admin_remover', userId: req.params.userId, por: req.usuario.id } }).catch(() => {});
    res.json({ ok });
  }));

  // Chave mestra da ponte com a gamemode: só a impressão (8 letras do SHA-256) sai daqui.
  router.get('/api/chave', rota(async (req, res) => {
    res.json({ configurada: chaveMestraConfigurada(), impressao: impressaoDaChave(), credenciais: await PonteConexaoGm.countDocuments({}) });
  }));

  // Gera a chave (ou troca a atual) e recifra os segredos das credenciais. A chave nova
  // aparece só nesta resposta, para o dono colar no .env do PC.
  router.post('/api/chave/trocar', soDono, rota(async (req, res) => {
    if (req.body?.confirmar !== 'TROCAR') return res.status(400).json({ erro: 'Confirme digitando TROCAR.' });
    const r = await trocarChaveMestra({ arquivo: arquivoEnv });
    if (r.erro) return res.status(409).json({ erro: r.erro });
    await PonteUso.create({
      acao: 'gm_credencial',
      detalhes: { sub: 'chave_mestra', via: 'admin', por: req.usuario.id, impressao: r.impressao, recifradas: r.recifradas, ilegiveis: r.ilegiveis, envGravado: r.envGravado }
    }).catch(() => {});
    log?.info?.(`Chave mestra da ponte trocada pelo dono (impressão ${r.impressao}, ${r.recifradas} credencial(is) recifrada(s)).`);
    res.json({ ok: true, ...r });
  }));

  // Guia de instalação: em que passo cada servidor está (chave, credencial, contato, modo teste).
  router.get('/api/gamemode/guia', rota(async (req, res) => {
    const [servidores, conexoes, pedidos] = await Promise.all([
      PonteServidor.find({ ativo: true }, { guildId: 1, gm: 1 }).lean(),
      PonteConexaoGm.find({ status: 'ativa' }, { guildId: 1, nome: 1, ultimoContatoEm: 1, ultimoIp: 1, versaoInclude: 1, modoTesteInformado: 1, ipsPermitidos: 1, pausada: 1 }).lean(),
      PontePedidoGm.aggregate([{ $group: { _id: { guildId: '$guildId', status: '$status' }, total: { $sum: 1 } } }])
    ]);
    // Logs da gamemode: os últimos eventos gm_* de cada servidor (busca, resultado, recusa da conexão...).
    const eventos = await PonteUso.find({ guildId: { $in: servidores.map(s => s.guildId) }, acao: /^gm_/ }, { em: 1, guildId: 1, acao: 1, contaId: 1, nick: 1, detalhes: 1 })
      .sort({ em: -1 }).limit(300).lean();
    const eventosDe = (guildId) => eventos.filter(e => e.guildId === guildId).slice(0, 10)
      .map(e => ({ em: e.em, acao: e.acao, contaId: e.contaId || '', nick: e.nick || '', detalhes: e.detalhes || {} }));
    const agora = Date.now();
    const porStatus = (guildId, status) => pedidos.find(p => p._id.guildId === guildId && p._id.status === status)?.total || 0;
    res.json({
      chaveMestra: chaveMestraConfigurada(),
      versaoInclude: VERSAO_INCLUDE,
      servidores: servidores.map(s => {
        const daGuild = conexoes.filter(c => c.guildId === s.guildId);
        const contato = daGuild.map(c => c.ultimoContatoEm).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
        return {
          guildId: s.guildId,
          nome: nomeGuild(s.guildId),
          pausado: s.gm?.pausado === true,
          modoTesteBot: s.gm?.modoTeste !== false,
          permitirPermanente: s.gm?.permitirPermanente !== false,
          limites: {
            maxBanDias: s.gm?.maxBanDias ?? LIMITES_GM_PADRAO.maxBanDias,
            maxCadeiaMin: s.gm?.maxCadeiaMin ?? LIMITES_GM_PADRAO.maxCadeiaMin,
            maxAvisos: s.gm?.maxAvisos ?? LIMITES_GM_PADRAO.maxAvisos,
            permitirPermanente: s.gm?.permitirPermanente ?? LIMITES_GM_PADRAO.permitirPermanente
          },
          credenciais: daGuild.length,
          semIp: daGuild.some(c => !(c.ipsPermitidos || []).length),
          pausadas: daGuild.filter(c => c.pausada).length,
          ultimoContatoEm: contato,
          online: !!contato && agora - new Date(contato).getTime() < ONLINE_GM_MS,
          versaoInclude: daGuild.find(c => c.versaoInclude)?.versaoInclude || '',
          // Algum contato informou modo teste ligado no jogo (null: ainda sem contato).
          modoTesteJogo: daGuild.some(c => c.modoTesteInformado === true) ? true : daGuild.some(c => c.modoTesteInformado === false) ? false : null,
          aplicadas: porStatus(s.guildId, 'aplicada'),
          simuladas: porStatus(s.guildId, 'simulada'),
          incertos: porStatus(s.guildId, 'incerto'),
          // Credenciais ativas, para a trava por IP na aba Controle.
          conexoes: daGuild.map(c => ({ id: String(c._id), nome: c.nome, ipsPermitidos: c.ipsPermitidos || [], ultimoIp: c.ultimoIp || '', pausada: c.pausada === true })),
          eventos: eventosDe(s.guildId)
        };
      })
    });
  }));

  router.use((req, res) => naoExiste(res));
  return router;
}

module.exports = { criarAdmin };
