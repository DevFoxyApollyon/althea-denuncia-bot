// atualizarStatus.js
// utils/atualizarStatus.js

/**
 * Atualiza o status na mensagem principal da denÃºncia.
 * @param {Client} client - InstÃ¢ncia do Discord.js Client
 * @param {Denuncia} denuncia - Documento da denÃºncia
 * @param {string} novoStatus - Novo status (analise, aceita, recusada, reivindicacao, etc)
 */
async function atualizarStatusNaMensagem(client, denuncia, novoStatus) {
    try {
        const channel = await client.channels.fetch(denuncia.channelId);
        const msg = await channel.messages.fetch(denuncia.messageId);

        const statusMap = {
            'pendente':      'Pendente',
            'analise':       'Em AnÃ¡lise',
            'reivindicacao': 'Reivindicada',
            'reivindicado':  'Reivindicada',
            'aceita':        'Aceita âœ…',
            'recusada':      'Recusada âŒ',
        };

        // Remove todas as linhas de status antigas e adiciona apenas uma correta ao final
        const statusRegexGlobal = /^âž± \*\*Status\*\*: `[^`]*`$/gm;
        let textoSemStatus = msg.content.replace(statusRegexGlobal, '').trim();
        // Garante que nÃ£o fique com linhas em branco extras
        textoSemStatus = textoSemStatus.replace(/\n{2,}/g, '\n');
        const novoStatusLinha = `âž± **Status**: \`${statusMap[novoStatus] || novoStatus}\``;
        let novoTexto = textoSemStatus;
        // Se jÃ¡ termina com o status, sÃ³ atualiza
        if (textoSemStatus.endsWith(novoStatusLinha)) {
            novoTexto = textoSemStatus;
        } else {
            novoTexto = textoSemStatus + '\n' + novoStatusLinha;
        }
        await msg.edit({ content: novoTexto });
    } catch (e) {
        console.warn('NÃ£o foi possÃ­vel atualizar o status na mensagem principal:', e.message);
    }
}

module.exports = { atualizarStatusNaMensagem };
