const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairContaDoNickname, normalizarNickname } = require('../utils/nickUtils');

test('extrai a conta do final do nickname', () => {
  assert.equal(extrairContaDoNickname('João 12345'), '12345');
  assert.equal(extrairContaDoNickname('Foxy | 777'), '777');
});

test('usa o último número quando há mais de um', () => {
  assert.equal(extrairContaDoNickname('A 12 B 34'), '34');
});

test('converte números sobrescritos', () => {
  assert.equal(normalizarNickname('Maria ¹²³'), 'Maria 123');
  assert.equal(extrairContaDoNickname('Maria ¹²³'), '123');
});

test('devolve null quando não há conta identificável', () => {
  assert.equal(extrairContaDoNickname('Sem numero'), null);
  assert.equal(extrairContaDoNickname('12345'), null, 'nickname só com número não tem nome antes');
  assert.equal(extrairContaDoNickname(null), null);
});
