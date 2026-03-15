const fetch = require('node-fetch');

/**
 * Extrai o ID do vídeo do YouTube de uma URL.
 * Aceita links dos formatos: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
 */
function extractYouTubeVideoId(url) {
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Busca o título do vídeo do YouTube usando o endpoint oEmbed (não precisa de API key)
 */
async function fetchYouTubeTitle(videoId) {
    try {
        const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const response = await fetch(oEmbedUrl);
        if (!response.ok) return null;
        const data = await response.json();
        return data.title || null;
    } catch (e) {
        return null;
    }
}

/**
 * Encontra todos os links do YouTube em um texto.
 * Retorna um array de links encontrados ou []
 */
function findYouTubeLinks(text) {
    if (!text) return [];
    const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=;%#@/\.]+)/gi;
    return text.match(ytRegex) || [];
}

module.exports = {
    extractYouTubeVideoId,
    fetchYouTubeTitle,
    findYouTubeLinks
};
