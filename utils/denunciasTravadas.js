// Denúncias travadas: o tópico foi apagado no Discord, mas no banco ela ficou
// "pendente" e sem reivindicação. Com o bloqueio de pendências ligado, isso
// impedia a staff de reivindicar as mais novas do mesmo canal.
//  - Tópico apagado com o bot ligado: marca na hora (evento threadDelete).
//  - As antigas: o Painel do bot (site) procura e tira da fila.
const Denuncia = require('../models/Denuncia');

const DISCORD_CANAL_DESCONHECIDO = 10003;
const PROCURAR_NO_MAXIMO = 30;

// Tópico apagado: marca a denúncia, se for de uma. Só marca uma vez.
async function marcarTopicoApagado(guildId, threadId, por = 'Discord') {
  if (!guildId || !threadId) return false;
  const r = await Denuncia.updateOne(
    { guildId: String(guildId), threadId: String(threadId), topicoApagadoEm: null },
    { $set: { topicoApagadoEm: new Date(), topicoApagadoPor: String(por).slice(0, 100) } }
  );
  return r.modifiedCount > 0;
}

// O Discord diz que o canal não existe mais? Falta de acesso ou erro de rede
// não contam: nesses casos a denúncia não é tocada.
async function topicoSumiu(client, threadId) {
  if (client.channels.cache.has(threadId)) return false;
  try {
    await client.channels.fetch(threadId);
    return false;
  } catch (erro) {
    return erro?.code === DISCORD_CANAL_DESCONHECIDO;
  }
}

// As pendentes mais antigas, sem reivindicação, cujo tópico não existe mais.
async function procurarTravadas(client, guildId) {
  const pendentes = await Denuncia.find({
    guildId: String(guildId),
    status: 'pendente',
    topicoApagadoEm: null,
    claimedBy: { $in: [null, ''] },
    reivindicadoPor: { $in: [null, ''] },
    threadId: { $nin: [null, ''] }
  }).sort({ dataCriacao: 1 }).limit(PROCURAR_NO_MAXIMO)
    .select('_id guildId channelId messageId threadId acusado denunciante motivo dataCriacao').lean();

  const travadas = [];
  for (const denuncia of pendentes) {
    if (await topicoSumiu(client, denuncia.threadId)) travadas.push(denuncia);
  }
  return { travadas, conferidas: pendentes.length };
}

// Tira da fila as escolhidas, conferindo de novo que o tópico sumiu mesmo.
async function tirarDaFila(client, guildId, ids, por) {
  const denuncias = await Denuncia.find({ _id: { $in: ids }, guildId: String(guildId), topicoApagadoEm: null })
    .select('_id threadId').lean();
  let tiradas = 0;
  for (const denuncia of denuncias) {
    if (!(await topicoSumiu(client, denuncia.threadId))) continue;
    if (await marcarTopicoApagado(guildId, denuncia.threadId, por)) tiradas += 1;
  }
  return tiradas;
}

function registrarEventoDeTopicoApagado(client) {
  client.on('threadDelete', (topico) => {
    marcarTopicoApagado(topico.guildId, topico.id).catch(() => {});
  });
}

module.exports = { marcarTopicoApagado, procurarTravadas, tirarDaFila, registrarEventoDeTopicoApagado, topicoSumiu };
