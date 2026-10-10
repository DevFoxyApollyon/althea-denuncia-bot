const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { normalizarDocumento, enderecoDoBanco, opcoesIndice, deveMigrarColecao } = require('../scripts/migrar-banco-secundario');

test('comparação de migração ignora somente a data de retenção e preserva datas/IDs', () => {
  const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const base = {
    _id: id,
    guildId: 'servidor',
    criadaEm: new Date('2026-01-01T00:00:00.000Z'),
    dataRetencaoAte: new Date('2026-07-01T00:00:00.000Z')
  };
  const outraRetencao = { ...base, dataRetencaoAte: new Date('2026-08-01T00:00:00.000Z') };

  assert.equal(normalizarDocumento(base), normalizarDocumento(outraRetencao));
  assert.notEqual(normalizarDocumento(base), normalizarDocumento({ ...base, guildId: 'outro' }));
  assert.notEqual(normalizarDocumento(base), normalizarDocumento({ ...base, criadaEm: new Date('2026-01-02T00:00:00.000Z') }));
});

test('identifica a mesma base MongoDB e remove TTL ao copiar opções dos índices', () => {
  assert.equal(
    enderecoDoBanco('mongodb+srv://usuario:senha@cluster.example/althea?retryWrites=true'),
    enderecoDoBanco('mongodb+srv://outro:segredo@cluster.example/althea?tls=true')
  );
  assert.deepEqual(opcoesIndice({
    name: 'criadaEm_1',
    key: { criadaEm: 1 },
    ns: 'althea.colecao',
    v: 2,
    expireAfterSeconds: 30
  }), { name: 'criadaEm_1' });
});

test('migração mantém a coleção de configurações no banco principal', () => {
  assert.equal(deveMigrarColecao({ name: 'configs', type: 'collection' }), false);
  assert.equal(deveMigrarColecao({ name: 'denuncias', type: 'collection' }), true);
  assert.equal(deveMigrarColecao({ name: 'system.users', type: 'collection' }), false);
  assert.equal(deveMigrarColecao({ name: 'config_view', type: 'view' }), false);
});
