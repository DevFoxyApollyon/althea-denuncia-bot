// Protocolo gm/v1 da ponte com a gamemode (ver doc/PONTE_GAMEMODE.md).
// Estas funções precisam produzir exatamente os valores de gamemode/teste/vetores_protocolo.json,
// que foram conferidos dentro do Pawn (gamemode/althea_ponte/althea_sha256.inc).
const crypto = require('node:crypto');

const sha256 = (texto) => crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
const hmac = (segredo, texto) => crypto.createHmac('sha256', Buffer.from(String(segredo), 'utf8')).update(String(texto), 'utf8').digest('hex');

// corpo: o texto EXATO recebido (Buffer ou string). Em GET, vazio.
function canonicoRequisicao({ metodo, caminho, ts, nonce, corpo = '' }) {
  const hashCorpo = Buffer.isBuffer(corpo) ? crypto.createHash('sha256').update(corpo).digest('hex') : sha256(corpo);
  return `${metodo}\n${caminho}\n${ts}\n${nonce}\n${hashCorpo}`;
}

const assinarRequisicao = (segredo, dados) => hmac(segredo, canonicoRequisicao(dados));

// Compara em tempo constante; formatos inválidos dão false.
function assinaturaConfere(segredo, dados, recebida) {
  if (!/^[0-9a-f]{64}$/.test(String(recebida || ''))) return false;
  return crypto.timingSafeEqual(Buffer.from(assinarRequisicao(segredo, dados)), Buffer.from(String(recebida)));
}

function canonicoPedido(p) {
  return 'pedido\n' + [
    p.id, p.tipo, p.conta, p.nick, p.tempo, p.avisos, p.somar ? 1 : 0,
    p.motivo, p.aprovadoPor, p.emitidoEm, p.teste ? 1 : 0
  ].join('|');
}

const selarPedido = (segredo, p) => ({ ...p, selo: hmac(segredo, canonicoPedido(p)) });

// Motivo que a gamemode aceita: ASCII de um conjunto fechado, até 60 letras, sem "/" no começo.
function motivoParaGamemode(texto) {
  const limpo = String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,:;!?()[\]\-_+#*@&/]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[/\s]+/, '');
  return limpo.slice(0, 60).trim();
}

// Nome de quem confirmou: [A-Za-z0-9_.-], até 24.
function nomeParaGamemode(texto) {
  const limpo = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24);
  return limpo || 'staff';
}

module.exports = {
  sha256, hmac, canonicoRequisicao, assinarRequisicao, assinaturaConfere,
  canonicoPedido, selarPedido, motivoParaGamemode, nomeParaGamemode
};
