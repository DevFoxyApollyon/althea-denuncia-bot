require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');
const { PRAZOS_EM_DIAS, CAMPO_RETENCAO } = require('../utils/retencaoDados');

test.after(fecharConexoes);

test('models da ponte registram sem conflito com a retenção', () => {
  // registrar() lança erro se a coleção não estiver coerente com retencaoDados.js.
  const PonteServidor = require('../models/PonteServidor');
  const PonteCodigo = require('../models/PonteCodigo');
  const PonteInstalacao = require('../models/PonteInstalacao');
  const PontePunicao = require('../models/PontePunicao');
  const PonteUso = require('../models/PonteUso');

  for (const permanente of [PonteServidor, PonteCodigo, PonteInstalacao]) {
    assert.equal(permanente.schema.path(CAMPO_RETENCAO), undefined);
  }
  assert.ok(PontePunicao.schema.path(CAMPO_RETENCAO));
  assert.ok(PonteUso.schema.path(CAMPO_RETENCAO));
  assert.equal(PRAZOS_EM_DIAS.pontepunicoes, 45);
  assert.equal(PRAZOS_EM_DIAS.ponteusos, 90);
});

test('guild nova da ponte começa desligada e com os templates padrão', () => {
  const PonteServidor = require('../models/PonteServidor');
  const doc = new PonteServidor({ guildId: '1' });
  assert.equal(doc.ativo, false);
  assert.match(doc.templates.get('ban'), /^\/.*\{id\}/);
});

test('punição exige denúncia e guild, e valida status', () => {
  const PontePunicao = require('../models/PontePunicao');
  const erro = new PontePunicao({ status: 'outro', origem: 'topico' }).validateSync();
  assert.ok(erro.errors.denunciaId);
  assert.ok(erro.errors.guildId);
  assert.ok(erro.errors.status);
});
