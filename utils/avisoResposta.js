// Avisa por mensagem direta os acusados identificados quando alguém escreve
// no tópico da denúncia. Cada pessoa recebe no máximo um aviso a cada 10
// minutos por tópico, para uma conversa movimentada não virar spam.

const INTERVALO_MS = 10 * 60 * 1000;
const CABECALHO_DO_SITE = /^(?:📎 \*\*Enviado pelo site\*\* por|Enviado por) <@!?(\d{15,21})>/;
const ultimoAviso = new Map();

function podeAvisar(userId, threadId, agora = Date.now()) {
  const chave = `${userId}:${threadId}`;
  if (ultimoAviso.has(chave) && agora - ultimoAviso.get(chave) < INTERVALO_MS) return false;
  if (ultimoAviso.size > 5000) ultimoAviso.clear();
  ultimoAviso.set(chave, agora);
  return true;
}

// Quem escreveu: o autor da mensagem ou, nas mensagens publicadas pelo site, a
// pessoa indicada no cabeçalho. Outras mensagens do bot não geram aviso.
function autorReal(message) {
  if (!message.author?.bot) return message.author?.id || null;
  return String(message.content || '').match(CABECALHO_DO_SITE)?.[1] || null;
}

async function avisarAcusadosDaResposta(client, denuncia, message) {
  const autorId = autorReal(message);
  if (!autorId) return 0;

  const destinatarios = (denuncia.acusadoUserIds || []).filter(id => id && id !== autorId);
  if (!destinatarios.length) return 0;

  const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  const linkDoTopico = `https://discord.com/channels/${denuncia.guildId}/${denuncia.threadId}`;
  const texto = [
    `💬 **Nova mensagem na denúncia em que você é acusado** (${message.guild?.name || 'servidor'}).`,
    siteUrl ? `Acompanhe pelo site: ${siteUrl}/#/d/${denuncia._id}` : null,
    `Tópico no Discord: ${linkDoTopico}`
  ].filter(Boolean).join('\n');

  let enviados = 0;
  for (const userId of destinatarios) {
    if (!podeAvisar(userId, denuncia.threadId)) continue;
    const usuario = await client.users.fetch(userId).catch(() => null);
    // DM fechada (50007) é comum e não é erro.
    if (await usuario?.send(texto).then(() => true).catch(() => false)) enviados++;
  }
  return enviados;
}

module.exports = { avisarAcusadosDaResposta, autorReal, podeAvisar, INTERVALO_MS };
