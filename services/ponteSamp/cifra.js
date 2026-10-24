// Cifra dos segredos da ponte com a gamemode (AES-256-GCM).
// O segredo precisa voltar ao texto original para conferir o HMAC, por isso
// não é guardado como hash. A chave fica só no .env (PONTE_CHAVE_MESTRA).
const crypto = require('node:crypto');

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;

// Chave mestra em Buffer de 32 bytes, ou null quando falta ou está malformada.
function chaveMestra() {
  const valor = String(process.env.PONTE_CHAVE_MESTRA || '').trim();
  if (!valor) return null;
  const chave = Buffer.from(valor, 'base64');
  return chave.length === 32 ? chave : null;
}

const chaveMestraConfigurada = () => chaveMestra() !== null;

function exigirChave() {
  const chave = chaveMestra();
  if (!chave) throw new Error('PONTE_CHAVE_MESTRA ausente ou inválida (base64 de 32 bytes).');
  return chave;
}

// Devolve { iv, tag, dados } em base64.
function cifrar(texto) {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cifrador = crypto.createCipheriv(ALGORITMO, exigirChave(), iv);
  const dados = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return { iv: iv.toString('base64'), tag: cifrador.getAuthTag().toString('base64'), dados: dados.toString('base64') };
}

// Lança erro se o conteúdo, o IV ou a tag tiverem sido alterados.
function decifrar({ iv, tag, dados } = {}) {
  const decifrador = crypto.createDecipheriv(ALGORITMO, exigirChave(), Buffer.from(String(iv || ''), 'base64'));
  decifrador.setAuthTag(Buffer.from(String(tag || ''), 'base64'));
  return Buffer.concat([decifrador.update(Buffer.from(String(dados || ''), 'base64')), decifrador.final()]).toString('utf8');
}

// Segredo novo da gamemode: 32 bytes aleatórios em hex (64 letras).
const gerarSegredo = () => crypto.randomBytes(32).toString('hex');

module.exports = { chaveMestra, chaveMestraConfigurada, cifrar, decifrar, gerarSegredo };
