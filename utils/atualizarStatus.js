// utils/atualizarStatus.js

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

        const statusRegexGlobal = /^➱ \*\*Status\*\*: `[^`]*`$/gm;
        let textoSemStatus = msg.content.replace(statusRegexGlobal, '').trim();
        textoSemStatus = textoSemStatus.replace(/\n{2,}/g, '\n');
        const novoStatusLinha = `➱ **Status**: \`${statusMap[novoStatus] || novoStatus}\``;
        let novoTexto = textoSemStatus;
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
