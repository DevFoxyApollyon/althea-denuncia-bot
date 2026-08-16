const Denuncia = require('../models/Denuncia');

const CACHE_LIMIT = 300;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map();

function setCache(threadId, dados) {
    if (cache.size >= CACHE_LIMIT) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(threadId, dados);
    const timer = setTimeout(() => cache.delete(threadId), CACHE_TTL_MS);
    timer.unref?.();
}

function registrarTopicoRestrito(threadId, criadoPor, acusadoUserIds = [], restrito = false) {
    const autorizados = new Set([criadoPor, ...acusadoUserIds].filter(Boolean));
    setCache(threadId, { restrito: !!restrito, autorizados });
}

async function obterRestricaoTopico(threadId) {
    if (cache.has(threadId)) return cache.get(threadId);

    const denuncia = await Denuncia.findOne({ threadId })
        .select('criadoPor acusadoUserIds restritoParticipacao')
        .lean()
        .catch(() => null);

    if (!denuncia) {
        const dados = { restrito: false, autorizados: new Set() };
        setCache(threadId, dados);
        return dados;
    }

    const dados = {
        restrito: !!denuncia.restritoParticipacao,
        autorizados: new Set([denuncia.criadoPor, ...(denuncia.acusadoUserIds || [])].filter(Boolean)),
    };
    setCache(threadId, dados);
    return dados;
}

async function usuarioAutorizadoNoTopico(threadId, userId) {
    const dados = await obterRestricaoTopico(threadId);
    if (!dados.restrito) return true;
    return dados.autorizados.has(userId);
}

module.exports = {
    registrarTopicoRestrito,
    obterRestricaoTopico,
    usuarioAutorizadoNoTopico,
};