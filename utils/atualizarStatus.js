// utils/atualizarStatus.js
const DenunciaMensagem = require('../models/DenunciaMensagem');

const STATUS_MAP = {
    pendente: 'Pendente',
    analise: 'Em Análise',
    reivindicacao: 'Reivindicada',
    reivindicado: 'Reivindicada',
    aceita: 'Aceita ✅',
    recusada: 'Recusada ❌',
    finalizada: 'Finalizado 📦',
};

// Linha em branco (caractere ⠀) no fim da mensagem da denúncia com tópico
// privado: separa uma denúncia da outra no canal e continua no fim depois de
// cada troca de status.
const LINHA_EM_BRANCO = '⠀';

function atualizarTextoDeStatus(content, novoStatus) {
    const novoStatusLinha = `➱ **Status**: \`${STATUS_MAP[novoStatus] || novoStatus}\``;
    const statusRegexGlobal = /^➱ \*\*Status\*\*: `[^`]*`$/gm;
    let texto = String(content || '');
    const comLinhaNoFim = texto.trimEnd().endsWith(`\n${LINHA_EM_BRANCO}`);
    if (comLinhaNoFim) texto = texto.trimEnd().slice(0, -LINHA_EM_BRANCO.length);
    const textoSemStatus = texto
        .replace(statusRegexGlobal, '')
        .trim()
        .replace(/\n{2,}/g, '\n');

    const comStatus = textoSemStatus.endsWith(novoStatusLinha)
        ? textoSemStatus
        : `${textoSemStatus}\n${novoStatusLinha}`;
    return comLinhaNoFim ? `${comStatus}\n${LINHA_EM_BRANCO}` : comStatus;
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
            const editou = await editarStatusMensagem(mensagem, novoStatus);
            // A cópia guardada no banco (usada pelo site) acompanha a edição.
            if (editou && mensagem.id === denuncia.messageId) {
                await DenunciaMensagem.updateOne(
                    { denunciaId: denuncia._id, mensagemId: mensagem.id },
                    { $set: { conteudo: atualizarTextoDeStatus(mensagem.content, novoStatus) } }
                ).catch(() => {});
            }
        } catch (e) {
            console.warn(`Não foi possível atualizar o status da mensagem ${mensagem.id}:`, e.message);
        }
    }
}
 
module.exports = { atualizarStatusNaMensagem, atualizarTextoDeStatus };
