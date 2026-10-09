const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validarEnv, OBRIGATORIAS } = require('../utils/env');

function comEnv(valores, fn) {
  const original = { ...process.env };
  for (const [nome, valor] of Object.entries(valores)) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  try {
    return fn();
  } finally {
    process.env = original;
  }
}

function logMudo() {
  const erros = [];
  return { erros, warn() {}, error: (msg) => erros.push(msg) };
}

test('aceita quando todas as obrigatórias estão definidas', () => {
  const log = logMudo();
  const ok = comEnv({ DISCORD_TOKEN: 'a', MONGODB_URI: 'b', SECONDARY_DB_URI: 'c' }, () => validarEnv(log));
  assert.equal(ok, true);
  assert.deepEqual(log.erros, []);
});

test('lista todas as variáveis ausentes de uma vez', () => {
  const log = logMudo();
  const ok = comEnv({ DISCORD_TOKEN: undefined, MONGODB_URI: '  ', SECONDARY_DB_URI: 'c' }, () => validarEnv(log));
  assert.equal(ok, false);
  assert.ok(log.erros.some(msg => msg.includes('DISCORD_TOKEN')));
  assert.ok(log.erros.some(msg => msg.includes('MONGODB_URI')));
  assert.ok(!log.erros.some(msg => msg.includes('SECONDARY_DB_URI')));
});

test('toda variável obrigatória está documentada no .env.example', () => {
  const exemplo = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  for (const nome of Object.keys(OBRIGATORIAS)) {
    assert.match(exemplo, new RegExp(`^${nome}=`, 'm'), `${nome} não está no .env.example`);
  }
});
