const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');

test.after(fecharConexoes);

const mongoose = require('mongoose');
const { linhasDoBanco } = require('../jobs/backupBanco');
const { COLECOES_COM_REGRA_PROPRIA } = require('../utils/retencaoDados');

test('backup: uma linha por registro, com a coleção e o _id preservado', async () => {
  const id = new mongoose.Types.ObjectId();
  const data = new Date('2026-11-01T12:00:00Z');
  const colecoes = {
    denuncias: [{ _id: id, acusado: '1039', dataCriacao: data }],
    configs: [{ _id: 'cfg', guildId: '1' }]
  };
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: 'system.views' }, ...Object.keys(colecoes).map(name => ({ name }))] }),
    collection: (nome) => ({ find: () => colecoes[nome] })
  };

  const linhas = [];
  for await (const linha of linhasDoBanco(db)) linhas.push(linha);
  assert.equal(linhas.length, 2);

  const { EJSON } = mongoose.mongo.BSON;
  const [primeira, segunda] = linhas.map(linha => EJSON.parse(linha, { relaxed: false }));
  assert.equal(primeira.c, 'configs');
  assert.equal(segunda.c, 'denuncias');
  assert.ok(segunda.d._id.equals(id));
  assert.equal(segunda.d.dataCriacao.getTime(), data.getTime());
});

test('backup: as coleções do GridFS de backups não ganham prazo de apagamento', () => {
  assert.ok(COLECOES_COM_REGRA_PROPRIA.includes('backups.files'));
  assert.ok(COLECOES_COM_REGRA_PROPRIA.includes('backups.chunks'));
});
