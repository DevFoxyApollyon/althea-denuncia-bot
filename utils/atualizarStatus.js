// utils/atualizarStatus.js

const STATUS_MAP = {
    pendente: 'Pendente',
    analise: 'Em Análise',
    reivindicacao: 'Reivindicada',
    reivindicado: 'Reivindicada',
    aceita: 'Aceita ✅',
    recusada: 'Recusada ❌',
};

function atualizarTextoDeStatus(content, novoStatus) {
    const novoStatusLinha = `➱ **Status**: \`${STATUS_MAP[novoStatus] || novoStatus}\``;
    const statusRegexGlobal = /^➱ \*\*Status\*\*: `[^`]*`$/gm;
    const textoSemStatus = String(content || '')
        .replace(statusRegexGlobal, '')
        .trim()
        .replace(/\n{2,}/g, '\n');

    return textoSemStatus.endsWith(novoStatusLinha)
        ? textoSemStatus
        : `${textoSemStatus}\n${novoStatusLinha}`;
}

async function editarStatusMensagem(message, novoStatus) {
    if (!message?.edit || !String(message.content || '').includes('➱ **')) return false;
    const novoTexto = atualizarTextoDeStatus(message.content, novoStatus);
    if (novoTexto === message.content) return false;
    await message.edit({ content: novoTexto });
    return true;
}

async function buscarMensagemInicialDoEspelho(client, threadId) {
    if (!threadId) return null;
    const thread = await client.channels.fetch(threadId, { cache: false }).catch(() => null);
    if (!thread?.isThread?.()) return null;
    if (typeof thread.fetchStarterMessage !== 'function') return null;
    return thread.fetchStarterMessage().catch(() => null);
}

async function atualizarStatusNaMensagem(client, denuncia, novoStatus) {
    const mensagens = [];

    try {
        const channel = await client.channels.fetch(denuncia.channelId, { cache: false });
        const msg = await channel.messages.fetch(denuncia.messageId);
        mensagens.push(msg);
    } catch (e) {
        console.warn('Não foi possível buscar a mensagem principal:', e.message);
    }

    for (const threadId of [denuncia.armazemThreadId, denuncia.registroThreadId].filter(Boolean)) {
        const mensagemInicial = await buscarMensagemInicialDoEspelho(client, threadId);
        if (mensagemInicial) mensagens.push(mensagemInicial);
    }

    for (const mensagem of mensagens) {
        try {
            await editarStatusMensagem(mensagem, novoStatus);
        } catch (e) {
            console.warn(`Não foi possível atualizar o status da mensagem ${mensagem.id}:`, e.message);
        }
    }
}
 
module.exports = { atualizarStatusNaMensagem };
