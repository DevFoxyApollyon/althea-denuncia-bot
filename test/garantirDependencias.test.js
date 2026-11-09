const test = require('node:test');
const assert = require('node:assert/strict');
const { atendeMinimo } = require('../utils/garantirDependencias');

test('versão do discord.js: aceita a partir de 14.23.0 e recusa antiga ou ausente', () => {
  assert.equal(atendeMinimo('14.27.0'), true);
  assert.equal(atendeMinimo('14.23.0'), true);
  assert.equal(atendeMinimo('15.0.0'), true);
  assert.equal(atendeMinimo('14.22.9'), false);
  assert.equal(atendeMinimo('14.21.0'), false);
  assert.equal(atendeMinimo('13.99.0'), false);
  assert.equal(atendeMinimo(null), false);
});
