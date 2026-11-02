const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const { usuarioIsento } = require('./usuariosIsentos');

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
    if (await usuarioIsento(userId)) return true;

    const dados = await obterRestricaoTopico(threadId);
    if (!dados.restrito) return true;
    return dados.autorizados.has(userId);
}

// Num tópico privado só entra quem é colocado nele: acusados identificados
// depois da abertura (no aceite ou no Add Player) precisam ser adicionados.
// Em tópico público não faz nada. Devolve quantos entraram.
async function porNoTopicoPrivado(canal, ids = []) {
    if (canal?.type !== ChannelType.PrivateThread) return 0;
    const validos = [...new Set(ids.map(String).filter(id => /^\d{15,21}$/.test(id)))];
    const resultados = await Promise.all(validos.map(id => canal.members.add(id).then(() => true).catch(() => false)));
    return resultados.filter(Boolean).length;
}

// Botão "Entrar no tópico" (só administrador e responsável conseguem usar).
// Com o ID do tópico no botão, ele funciona em qualquer canal: na mensagem
// principal, no Log Admin e no canal de análise.
function botaoEntrarNoTopico(threadId = null) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(threadId ? `entrar_topico:${threadId}` : 'entrar_topico')
            .setLabel('Entrar no tópico').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
    );
}

// Link da mensagem da denúncia no canal. Num tópico privado, o link do tópico
// aparece como "#desconhecido" para quem não está nele; este todos conseguem
// abrir, e a mensagem tem o botão de entrar.
function linkDaMensagemPrincipal(guildId, denuncia) {
    if (!guildId || !denuncia?.channelId || !denuncia?.messageId) return null;
    return `https://discord.com/channels/${guildId}/${denuncia.channelId}/${denuncia.messageId}`;
}

module.exports = {
    botaoEntrarNoTopico,
    linkDaMensagemPrincipal,
    porNoTopicoPrivado,
    registrarTopicoRestrito,
    obterRestricaoTopico,
    usuarioAutorizadoNoTopico,
};