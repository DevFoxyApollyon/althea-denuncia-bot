// Prévia local do painel da ponte (/admin) com dados de exemplo, para conferir a tela sem
// login nem banco de produção: node site/previaAdmin.js (abre em http://localhost:4190/admin).
require('../test/helpers/env');
const DONO = '900000000000000001';
process.env.OWNER_DISCORD_ID = DONO;
process.env.PONTE_SAMP_ATIVA = '1';
process.env.PONTE_CHAVE_MESTRA = Buffer.alloc(32, 7).toString('base64');

(async () => {
  const { iniciarMongoMemoria } = require('../test/helpers/mongoMemoria');
  await iniciarMongoMemoria();
  const express = require('express');
  const cifra = require('../services/ponteSamp/cifra');
  const PonteServidor = require('../models/PonteServidor');
  const PonteConexaoGm = require('../models/PonteConexaoGm');
  const PonteUso = require('../models/PonteUso');

  const guilds = [['100000000000000003', 'Brasil Roleplay - 3', true], ['100000000000000004', 'BRASIL ROLEPLAY - 4', false]];
  for (const [guildId, , online] of guilds) {
    await PonteServidor.create({ guildId, ativo: true, ativadoEm: new Date(), ativadoPor: DONO, gm: { modoTeste: !online } });
    const segredo = cifra.gerarSegredo();
    const conexao = await PonteConexaoGm.create({
      guildId, nome: `BRP ${guildId.slice(-1)}`, segredoCifrado: cifra.cifrar(segredo), ultimos4: segredo.slice(-4),
      ipsPermitidos: online ? ['151.242.227.133'] : [], ultimoContatoEm: online ? new Date() : null, ultimoIp: online ? '151.242.227.133' : '',
      versaoInclude: online ? '1.0.1' : '', modoTesteInformado: online ? false : null
    });
    await PonteUso.create({ guildId, acao: 'gm_busca', detalhes: { conexaoId: String(conexao._id), pedidos: [] } });
  }

  const client = { guilds: { cache: new Map(guilds.map(([id, nome]) => [id, { id, name: nome }])) }, users: { cache: new Map(), fetch: async () => null } };
  const app = express();
  app.use((req, res, next) => { req.usuario = { id: DONO, nome: 'Dono' }; req.sid = 'previa'; next(); });
  app.use('/admin', require('./ponte/admin').criarAdmin({ client, config: { segredo: 'p'.repeat(40) }, log: console }));
  app.listen(4190, () => console.log('Prévia do painel: http://localhost:4190/admin'));
})();
