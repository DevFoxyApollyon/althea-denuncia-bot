const GlobalConfig = require('../models/GlobalConfig');

const CACHE_TTL_MS = 60 * 1000;
const envUsuariosIsentos = new Set(
  (process.env.USUARIOS_ISENTOS || '')
    .split(/[\s,;]+/)
    .map(id => id.trim())
    .filter(Boolean)
);

let cachedUsuariosIsentos = null;
let cachedAt = 0;

function normalizarIds(ids) {
  const values = Array.isArray(ids) ? ids : [ids];
  const tokens = values.reduce((result, value) => {
    return result.concat(String(value || '').split(/[\s,+;]+/));
  }, []);

  return [...new Set(
    tokens
      .map(id => id.trim())
      .filter(id => /^\d{10,25}$/.test(id))
  )];
}

async function getUsuariosIsentos(force = false) {
  if (!force && cachedUsuariosIsentos && Date.now() - cachedAt < CACHE_TTL_MS) {
    return [...cachedUsuariosIsentos];
  }

  const config = await GlobalConfig.findOne({ key: 'global' }).lean().catch(() => null);
  cachedUsuariosIsentos = new Set(config ? config.usuariosIsentos : envUsuariosIsentos);
  cachedAt = Date.now();
  return [...cachedUsuariosIsentos];
}

async function usuarioIsento(userId) {
  if (!userId) return false;
  const usuarios = await getUsuariosIsentos();
  return usuarios.includes(String(userId));
}

async function salvarUsuariosIsentos(ids, updatedBy = 'Sistema') {
  const usuariosIsentos = normalizarIds(ids);
  const config = await GlobalConfig.findOneAndUpdate(
    { key: 'global' },
    {
      $set: { usuariosIsentos, updatedBy },
      $setOnInsert: { key: 'global' }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  cachedUsuariosIsentos = new Set(usuariosIsentos);
  cachedAt = Date.now();
  return config;
}

function limparCacheUsuariosIsentos() {
  cachedUsuariosIsentos = null;
  cachedAt = 0;
}

module.exports = {
  getUsuariosIsentos,
  usuarioIsento,
  salvarUsuariosIsentos,
  limparCacheUsuariosIsentos,
  normalizarIds
};
