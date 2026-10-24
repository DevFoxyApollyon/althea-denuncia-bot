// Tokens dos PCs e códigos de ativação da ponte. Só o hash vai para o banco.
const crypto = require('node:crypto');

const sha256 = (texto) => crypto.createHash('sha256').update(String(texto)).digest('hex');

// Token do PC: 32 bytes aleatórios, mostrado uma única vez.
const gerarToken = () => crypto.randomBytes(32).toString('base64url');

// Código de ativação legível (sem 0/O/1/I), no formato XXXX-XXXX-XXXX-XXXX.
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function gerarCodigo() {
  const bytes = crypto.randomBytes(16);
  const letras = [...bytes].map(b => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join('');
  return letras.match(/.{4}/g).join('-');
}

// O usuário pode digitar o código com espaços ou em minúsculas.
const normalizarCodigo = (codigo) => String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCodigo = (codigo) => sha256(normalizarCodigo(codigo));
const ultimos4 = (texto) => String(texto || '').replace(/-/g, '').slice(-4);

// Compara sem vazar tempo (para hashes do mesmo tamanho).
function hashIgual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { sha256, gerarToken, gerarCodigo, normalizarCodigo, hashCodigo, ultimos4, hashIgual };
