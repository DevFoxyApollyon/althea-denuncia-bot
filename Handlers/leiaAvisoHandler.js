/**
 * Gera o texto do aviso com o cabeçalho original preservado
 */
function criarAvisoDenuncia(commandChannelId) {
    return `Brasil RolePlay • DENUNCIAS

**Faça sua denúncia aqui** → <#${commandChannelId}>

📝 **COMO ENVIAR SUAS PROVAS:**

**1. Através do YouTube (Recomendado):**
   • Faça o upload do vídeo (pode ser como "Não listado").
   • Utilize qualidade **720p** ou superior para melhor análise.
   • Cole o link do vídeo no campo de provas do formulário.

**2. Diretamente no Tópico:**
   • Caso não consiga upar no YouTube, você pode enviar o arquivo de vídeo ou imagem **diretamente no tópico** que será aberto após o envio da denúncia.

**3. Capturas de Tela (Prints):**
   • Utilize imagens em tela cheia e com boa qualidade.
   • É proibido o envio de prints cortadas ou editadas.

❌ **SUA DENÚNCIA SERÁ RECUSADA SE CONTER:**
• Vídeos com menos de 10 segundos (sem contexto da situação).
• Arquivos que exijam download externo (.rar, .zip, .mp4 anexado).
• Links de sites de hospedagem de arquivos desconhecidos.

⚠️ **REGRAS E PUNIÇÕES:**
• **PROVAS DELETADAS:** Apagar provas após o envio resultará em punição severa.
• **TOPICO RESTRITO:** O canal é exclusivo para denúncia/contra-prova. Conversas desnecessárias ou "farpas" resultarão em **7 dias de castigo**.
• **ATAQUES PESSOAIS:** Mute de 7 dias para qualquer desrespeito.
• **DENÚNCIAS FALSAS:** Má fé ou provas forjadas resultarão em banimento grave.

💡 **DICA:** Seja claro, objetivo e respeite os administradores. Aguarde o prazo de análise da nossa equipe.

 **Bom RP a todos** 🦊`;
}

/**
 * Envia o aviso e remove APENAS os avisos antigos em background
 */
async function garantirAvisoNoTopo(channel, commandChannelId) {
    try {
        if (!channel) return;

        // 1. Envia a nova mensagem primeiro (Instantâneo)
        const conteudo = criarAvisoDenuncia(commandChannelId);
        const novaMensagem = await channel.send(conteudo);

        // 2. Limpa apenas os avisos antigos (sem travar a execução)
        limparAvisosAntigosBackground(channel, novaMensagem.id);

        return novaMensagem;
    } catch (error) {
        console.error('Erro ao gerenciar aviso no topo:', error);
    }
}

/**
 * Função interna de limpeza: Filtra estritamente pelo título do aviso
 */
async function limparAvisosAntigosBackground(channel, skipMessageId) {
    try {
        // Busca as últimas 50 mensagens
        const messages = await channel.messages.fetch({ limit: 50 });
        
        // Filtro Restrito: 
        // Deve ser do BOT && Conter o título exato && NÃO ser a mensagem nova
        const toDelete = messages.filter(m => 
            m.author.id === channel.client.user.id && 
            m.content.includes('Brasil RolePlay • DENUNCIAS') && 
            m.id !== skipMessageId
        );

        if (toDelete.size > 0) {
            // Tenta bulkDelete (para mensagens < 14 dias)
            await channel.bulkDelete(toDelete).catch(async () => {
                // Fallback: Deleta uma por uma se forem antigas
                for (const [_, msg] of toDelete) {
                    try {
                        await msg.delete();
                        await new Promise(resolve => setTimeout(resolve, 400));
                    } catch (e) { /* Ignora se já apagada */ }
                }
            });
        }
    } catch (error) {
        console.error('Erro na limpeza de fundo:', error);
    }
}

module.exports = {
    garantirAvisoNoTopo,
    criarAvisoDenuncia
};