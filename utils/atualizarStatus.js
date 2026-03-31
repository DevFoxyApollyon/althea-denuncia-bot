// utils/atualizarStatus.js

/**
 * Atualiza o status na mensagem principal da denúncia.
 * @param {Client} client - Instância do Discord.js Client
 * @param {Denuncia} denuncia - Documento da denúncia
 * @param {string} novoStatus - Novo status (analise, aceita, recusada, reivindicacao, etc)
 */
async function atualizarStatusNaMensagem(client, denuncia, novoStatus) {
    try {
        const channel = await client.channels.fetch(denuncia.channelId);
        const msg = await channel.messages.fetch(denuncia.messageId);

        const statusMap = {
            'pendente':      'Pendente',
            'analise':       'Em Análise',
            'reivindicacao': 'Reivindicada',
            'reivindicado':  'Reivindicada',
            'aceita':        'Aceita ✅',
            'recusada':      'Recusada ❌',
        };

        // Remove todas as linhas de status antigas e adiciona apenas uma correta ao final
        const statusRegexGlobal = /^➱ \*\*Status\*\*: `[^`]*`$/gm;
        let textoSemStatus = msg.content.replace(statusRegexGlobal, '').trim();
        // Garante que não fique com linhas em branco extras
        textoSemStatus = textoSemStatus.replace(/\n{2,}/g, '\n');
        const novoStatusLinha = `➱ **Status**: \`${statusMap[novoStatus] || novoStatus}\``;
        let novoTexto = textoSemStatus;
        // Se já termina com o status, só atualiza
        if (textoSemStatus.endsWith(novoStatusLinha)) {
            novoTexto = textoSemStatus;
        } else {
            novoTexto = textoSemStatus + '\n' + novoStatusLinha;
        }
        await msg.edit({ content: novoTexto });
    } catch (e) {
        console.warn('Não foi possível atualizar o status na mensagem principal:', e.message);
    }
}

module.exports = { atualizarStatusNaMensagem };
