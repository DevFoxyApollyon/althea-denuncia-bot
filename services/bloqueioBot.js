// Bloqueio de pessoas no bot inteiro (botões, comandos e site), feito pelo dono do bot
// no painel da ponte. A lista fica em memória por 1 minuto para não consultar o banco a
// cada clique; bloquear ou desbloquear limpa a memória na hora.
const BloqueioBot = require('../models/BloqueioBot');
const { ehDono } = require('./ponteSamp/gestao');

const RE_ID = /^\d{15,21}$/;
const CACHE_MS = 60 * 1000;
const AVISO_BLOQUEADO = '🚫 Você está bloqueado no bot e não pode usar nada dele.';
let cache = { em: 0, ids: new Set() };

async function bloqueados() {
  if (Date.now() - cache.em < CACHE_MS) return cache.ids;
  const lista = await BloqueioBot.find({}, { userId: 1 }).lean().catch(() => null);
  // Banco fora do ar: segue com a última lista conhecida.
  if (lista) cache = { em: Date.now(), ids: new Set(lista.map(item => item.userId)) };
  return cache.ids;
}

const limparCache = () => { cache = { em: 0, ids: new Set() }; };

// O dono nunca fica bloqueado (não tranca a si mesmo para fora).
async function estaBloqueado(userId) {
  if (!userId || ehDono(userId)) return false;
  return (await bloqueados()).has(String(userId));
}

const listarBloqueios = () => BloqueioBot.find({}).sort({ bloqueadoEm: -1 }).limit(500).lean();

async function bloquear({ userId, nome = '', motivo = '', por }) {
  const id = String(userId || '').trim();
  if (!RE_ID.test(id)) return { erro: 'ID do Discord inválido (só números, 15 a 21 dígitos).' };
  if (ehDono(id)) return { erro: 'Este é o dono do bot: não dá para bloquear.' };
  if (await BloqueioBot.exists({ userId: id })) return { erro: 'Esta pessoa já está bloqueada.' };
  const bloqueio = await BloqueioBot.create({ userId: id, nome: String(nome).slice(0, 64), motivo: String(motivo || '').trim().slice(0, 200), bloqueadoPor: String(por || '') });
  limparCache();
  return { bloqueio };
}

async function desbloquear(userId) {
  const r = await BloqueioBot.deleteOne({ userId: String(userId) });
  limparCache();
  return r.deletedCount === 1;
}

// Alguém baniu ou expulsou o dono do bot de um servidor: quem fez fica bloqueado no bot.
// O Discord não diz no evento quem fez; o registro de auditoria diz (precisa da permissão
// "Ver registro de auditoria"). Tenta 3 vezes, porque o registro pode chegar depois do evento.
// tipo: 'ban' ou 'kick'. Devolve o ID bloqueado ou null.
async function bloquearQuemTirouODono(guild, userId, tipo, { esperaMs = 1000 } = {}) {
  if (!guild || !ehDono(userId)) return null;
  const { AuditLogEvent } = require('discord.js');
  const evento = tipo === 'ban' ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberKick;
  let entrada = null;
  for (let tentativa = 0; tentativa < 3 && !entrada; tentativa++) {
    if (esperaMs) await new Promise(resolve => setTimeout(resolve, esperaMs * (tentativa + 1)));
    const registros = await guild.fetchAuditLogs({ limit: 5, type: evento }).catch(() => null);
    entrada = registros?.entries?.find(item => item.target?.id === String(userId) && Date.now() - item.createdTimestamp < 30000) || null;
  }
  const executor = entrada?.executor;
  // Sem registro (saiu sozinho ou sem permissão), ou foi o próprio bot / o dono: nada a fazer.
  if (!executor?.id || executor.id === guild.client?.user?.id || ehDono(executor.id)) return null;
  const acao = tipo === 'ban' ? 'Baniu' : 'Expulsou';
  const r = await bloquear({
    userId: executor.id,
    nome: executor.globalName || executor.username || '',
    motivo: `${acao} o dono do bot do servidor ${guild.name || guild.id}`,
    por: guild.client?.user?.id || 'bot'
  });
  if (r.erro) return null;
  await require('../models/PonteUso').create({
    guildId: guild.id, acao: 'gm_config', detalhes: { sub: 'bloqueio_adicionar', userId: executor.id, motivo: r.bloqueio.motivo, automatico: true }
  }).catch(() => {});
  return executor.id;
}

module.exports = { AVISO_BLOQUEADO, estaBloqueado, listarBloqueios, bloquear, desbloquear, limparCache, bloquearQuemTirouODono };
