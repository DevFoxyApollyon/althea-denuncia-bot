const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { adicionarMeses, aplicarRetencaoAoSchema } = require('../utils/retencaoDados');

test('calcula seis meses respeitando o último dia dos meses mais curtos', () => {
  assert.equal(adicionarMeses(new Date('2026-01-31T12:00:00.000Z')).toISOString(), '2026-07-31T12:00:00.000Z');
  assert.equal(adicionarMeses(new Date('2026-08-31T12:00:00.000Z')).toISOString(), '2027-02-28T12:00:00.000Z');
});

test('adiciona campo e índice TTL de seis meses ao schema sem duplicar', () => {
  const schema = new mongoose.Schema({ texto: String });
  aplicarRetencaoAoSchema(schema);
  aplicarRetencaoAoSchema(schema);

  assert.equal(schema.path('dataRetencaoAte').instance, 'Date');
  assert.equal(schema.indexes().filter(([, opcoes]) => opcoes.expireAfterSeconds === 0).length, 1);
});
