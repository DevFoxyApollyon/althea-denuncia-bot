const Config = require('../models/Config');
const { globalCache } = require('./smartCache');

const CONFIG_TTL_MS = 5 * 60 * 1000;
const CONFIG_AUSENTE_TTL_MS = 60 * 1000;
const AUSENTE = Object.freeze({ ausente: true });

const cacheKey = (guildId) => `config:${guildId}`;

// Cache único das configurações por servidor. Quem altera a Config pelo
// mongoose não precisa invalidar nada: os hooks em models/Config.js fazem isso.
async function getConfig(guildId) {
  if (!guildId) return null;

  const cached = globalCache.get(cacheKey(guildId));
  if (cached) return cached === AUSENTE ? null : cached;

  const config = await Config.findOne({ guildId });
  globalCache.set(cacheKey(guildId), config || AUSENTE, config ? CONFIG_TTL_MS : CONFIG_AUSENTE_TTL_MS);
  return config;
}

// Só o que já está em cache, sem consultar o banco.
function peekConfig(guildId) {
  const cached = globalCache.get(cacheKey(guildId));
  return cached && cached !== AUSENTE ? cached : null;
}

function setConfig(guildId, config) {
  if (!guildId) return;
  if (!config) return invalidateConfig(guildId);
  globalCache.set(cacheKey(guildId), config, CONFIG_TTL_MS);
}

function invalidateConfig(guildId) {
  if (guildId) globalCache.delete(cacheKey(guildId));
}

module.exports = { getConfig, peekConfig, setConfig, invalidateConfig, cacheKey };
