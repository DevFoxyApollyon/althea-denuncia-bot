// Notificações do navegador (Web Push): chegam no celular ou no PC mesmo com o
// site fechado. Cada aparelho que aceita os avisos vira uma inscrição no banco.
const webpush = require('web-push');
const ChavePush = require('../models/ChavePush');
const InscricaoPush = require('../models/InscricaoPush');
const { ouvirStatus } = require('../utils/eventosDenuncia');

const MAX_INSCRICOES_POR_PESSOA = 10;
const INTERVALO_MENSAGENS_MS = 2 * 60 * 1000;
// Só os serviços de notificação dos navegadores: o servidor nunca envia
// requisições para um endereço qualquer informado pelo cliente.
const SERVICOS_ACEITOS = [
  /^fcm\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /\.push\.apple\.com$/
];
const ROTULOS_STATUS = {
  reivindicacao: 'foi reivindicada pela staff',
  analise: 'entrou em análise',
  aceita: 'foi aceita',
  recusada: 'foi recusada',
  finalizada: 'foi finalizada'
};

let chaves = null;
let buscandoChaves = null;
const ultimoAviso = new Map();

const numeroDoCaso = (id) => `#${String(id).slice(-6).toUpperCase()}`;

function contatoDoSite() {
  const url = String(process.env.SITE_URL || '').trim();
  return url.startsWith('https://') ? url : 'mailto:contato@localhost.invalid';
}

// Lê o par de chaves do banco ou cria um na primeira vez.
async function chavesDoSite() {
  if (chaves) return chaves;
  buscandoChaves ||= (async () => {
    const novas = webpush.generateVAPIDKeys();
    const doc = await ChavePush.findOneAndUpdate(
      { _id: 'vapid' },
      { $setOnInsert: { publica: novas.publicKey, privada: novas.privateKey } },
      { new: true, upsert: true }
    ).lean();
    chaves = { publica: doc.publica, privada: doc.privada };
    return chaves;
  })().finally(() => { buscandoChaves = null; });
  return buscandoChaves;
}

function validarInscricao(entrada) {
  const endpoint = String(entrada?.endpoint || '');
  const p256dh = String(entrada?.keys?.p256dh || '');
  const auth = String(entrada?.keys?.auth || '');

  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  const servicoAceito = url?.protocol === 'https:' && SERVICOS_ACEITOS.some(regra => regra.test(url.hostname));
  const chaveValida = (valor) => /^[\w-]{10,200}=*$/.test(valor);

  if (!servicoAceito || endpoint.length > 1000 || !chaveValida(p256dh) || !chaveValida(auth)) return null;
  return { endpoint, chaves: { p256dh, auth } };
}

async function salvarInscricao(usuarioId, entrada) {
  const inscricao = validarInscricao(entrada);
  if (!inscricao) return false;

  await InscricaoPush.findOneAndUpdate(
    { endpoint: inscricao.endpoint },
    { $set: { usuarioId, chaves: inscricao.chaves }, $setOnInsert: { criadaEm: new Date() } },
    { upsert: true }
  );

  // Mantém só os aparelhos mais recentes de cada pessoa.
  const antigas = await InscricaoPush.find({ usuarioId }).sort({ criadaEm: -1 }).skip(MAX_INSCRICOES_POR_PESSOA).select('_id').lean();
  if (antigas.length) await InscricaoPush.deleteMany({ _id: { $in: antigas.map(item => item._id) } });
  return true;
}

const removerInscricao = (usuarioId, endpoint) =>
  InscricaoPush.deleteOne({ usuarioId, endpoint: String(endpoint || '') });

// Envia a mesma notificação para todos os aparelhos das pessoas indicadas.
// Inscrições que o navegador já cancelou (404/410) são apagadas.
async function enviarPush(usuarioIds, { titulo, corpo, url, tag }) {
  const ids = [...new Set(usuarioIds)].filter(Boolean);
  if (!ids.length) return 0;

  const inscricoes = await InscricaoPush.find({ usuarioId: { $in: ids } }).lean();
  if (!inscricoes.length) return 0;

  const { publica, privada } = await chavesDoSite();
  const conteudo = JSON.stringify({ titulo, corpo, url, tag });
  let enviadas = 0;

  await Promise.all(inscricoes.map(async (inscricao) => {
    try {
      await webpush.sendNotification(
        { endpoint: inscricao.endpoint, keys: inscricao.chaves },
        conteudo,
        { TTL: 24 * 60 * 60, vapidDetails: { subject: contatoDoSite(), publicKey: publica, privateKey: privada } }
      );
      enviadas++;
    } catch (erro) {
      if ([404, 410].includes(erro?.statusCode)) await InscricaoPush.deleteOne({ _id: inscricao._id }).catch(() => {});
    }
  }));
  return enviadas;
}

// Quem acompanha o caso: denunciante, acusados identificados e a staff que reivindicou.
function envolvidos(denuncia, excetoId) {
  return [denuncia.criadoPor, ...(denuncia.acusadoUserIds || []), denuncia.claimedBy]
    .filter(id => id && id !== excetoId);
}

function podeAvisar(usuarioId, threadId, agora = Date.now()) {
  const chave = `${usuarioId}:${threadId}`;
  if (ultimoAviso.has(chave) && agora - ultimoAviso.get(chave) < INTERVALO_MENSAGENS_MS) return false;
  if (ultimoAviso.size > 5000) ultimoAviso.clear();
  ultimoAviso.set(chave, agora);
  return true;
}

// Mensagem nova no tópico: no máximo um aviso a cada 2 minutos por pessoa e caso.
function notificarMensagem(denuncia, autorId) {
  if (!process.env.SITE_URL) return Promise.resolve(0);
  const destinatarios = envolvidos(denuncia, autorId).filter(id => podeAvisar(id, denuncia.threadId));
  return enviarPush(destinatarios, {
    titulo: `Nova mensagem na denúncia ${numeroDoCaso(denuncia._id)}`,
    corpo: `Acusado ${denuncia.acusado}. Toque para abrir a conversa.`,
    url: `/#/d/${denuncia._id}`,
    tag: `mensagem-${denuncia._id}`
  });
}

function notificarStatus(denuncia) {
  const rotulo = ROTULOS_STATUS[denuncia.status];
  if (!rotulo || !process.env.SITE_URL) return Promise.resolve(0);
  // Quem mudou o status foi a staff; o aviso vai para o denunciante e os acusados.
  const destinatarios = [denuncia.criadoPor, ...(denuncia.acusadoUserIds || [])]
    .filter(id => id && id !== denuncia.staffId && id !== denuncia.claimedBy);
  return enviarPush(destinatarios, {
    titulo: `Denúncia ${numeroDoCaso(denuncia._id)} ${rotulo}`,
    corpo: `Acusado ${denuncia.acusado}. Toque para ver os detalhes.`,
    url: `/#/d/${denuncia._id}`,
    tag: `status-${denuncia._id}`
  });
}

// Liga os avisos de mudança de status. Chamado uma vez, quando o site sobe.
function iniciarPush(log) {
  return ouvirStatus((denuncia) => {
    notificarStatus(denuncia).catch(erro => log?.warn?.(`Notificação do navegador falhou: ${erro.message}`));
  });
}

module.exports = {
  chavesDoSite,
  validarInscricao,
  salvarInscricao,
  removerInscricao,
  enviarPush,
  notificarMensagem,
  notificarStatus,
  iniciarPush,
  podeAvisar
};
