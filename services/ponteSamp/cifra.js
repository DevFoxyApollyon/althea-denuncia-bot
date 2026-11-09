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

// Devolve { iv, tag, dados } em base64. "chave" só é passada na troca da chave mestra.
function cifrar(texto, chave = exigirChave()) {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cifrador = crypto.createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return { iv: iv.toString('base64'), tag: cifrador.getAuthTag().toString('base64'), dados: dados.toString('base64') };
}

// Lança erro se o conteúdo, o IV ou a tag tiverem sido alterados.
function decifrar({ iv, tag, dados } = {}, chave = exigirChave()) {
  const decifrador = crypto.createDecipheriv(ALGORITMO, chave, Buffer.from(String(iv || ''), 'base64'));
  decifrador.setAuthTag(Buffer.from(String(tag || ''), 'base64'));
  return Buffer.concat([decifrador.update(Buffer.from(String(dados || ''), 'base64')), decifrador.final()]).toString('utf8');
}

// Segredo novo da gamemode: 32 bytes aleatórios em hex (64 letras).
const gerarSegredo = () => crypto.randomBytes(32).toString('hex');

// Chave mestra nova, no formato do .env (base64 de 32 bytes).
const gerarChaveMestra = () => crypto.randomBytes(32).toString('base64');

// Identifica a chave sem revelar nada dela (para conferir se o .env do PC e o da hospedagem são iguais).
function impressaoDaChave(texto = String(process.env.PONTE_CHAVE_MESTRA || '').trim()) {
  if (Buffer.from(texto, 'base64').length !== 32) return '';
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 8);
}

module.exports = { chaveMestra, chaveMestraConfigurada, cifrar, decifrar, gerarSegredo, gerarChaveMestra, impressaoDaChave };
