// leiaAvisoHandler.js
/**
 * Gera o texto do aviso com o cabeÃ§alho original preservado
 */
function criarAvisoDenuncia(commandChannelId) {
    return `Brasil RolePlay â€¢ DENUNCIAS

**FaÃ§a sua denÃºncia aqui** â†’ <#${commandChannelId}>

ðŸ“ **COMO ENVIAR SUAS PROVAS:**

**1. AtravÃ©s do YouTube (Recomendado):**
   â€¢ FaÃ§a o upload do vÃ­deo (pode ser como "NÃ£o listado").
   â€¢ Utilize qualidade **720p** ou superior para melhor anÃ¡lise.
   â€¢ Cole o link do vÃ­deo no campo de provas do formulÃ¡rio.

**2. Diretamente no TÃ³pico:**
   â€¢ Caso nÃ£o consiga upar no YouTube, vocÃª pode enviar o arquivo de vÃ­deo ou imagem **diretamente no tÃ³pico** que serÃ¡ aberto apÃ³s o envio da denÃºncia.

**3. Capturas de Tela (Prints):**
   â€¢ Utilize imagens em tela cheia e com boa qualidade.
   â€¢ Ã‰ proibido o envio de prints cortadas ou editadas.

âŒ **SUA DENÃšNCIA SERÃ RECUSADA SE CONTER:**
â€¢ VÃ­deos com menos de 10 segundos (sem contexto da situaÃ§Ã£o).
â€¢ Arquivos que exijam download externo (.rar, .zip, .mp4 anexado).
â€¢ Links de sites de hospedagem de arquivos desconhecidos.
â€¢ Videos com mais de 48 horas apos ocorrido ( adm ao analisar ou recusar nao tem essa regra para setar essa puniÃ§Ã£o).

âš ï¸ **REGRAS E PUNIÃ‡Ã•ES:**
â€¢ **PROVAS DELETADAS:** Apagar provas apÃ³s o envio resultarÃ¡ em puniÃ§Ã£o severa.
â€¢ **TOPICO RESTRITO:** O canal Ã© exclusivo para denÃºncia/contra-prova. Conversas desnecessÃ¡rias ou "farpas" resultarÃ£o em **7 dias de castigo**.
â€¢ **ATAQUES PESSOAIS:** Mute de 7 dias para qualquer desrespeito.
â€¢ **DENÃšNCIAS FALSAS:** MÃ¡ fÃ© ou provas forjadas resultarÃ£o em banimento grave.
â€¢ **ANT-RP NA PROPRIA DENUNCIA:** Caso comenta ant-rp na denuncia sera punido de acordo com a gravidade.

ðŸ’¡ **DICA:** Seja claro, objetivo e respeite os administradores. Aguarde o prazo de anÃ¡lise da nossa equipe.

 **Bom RP a todos** ðŸ¦Š`;
}

/**
 * Envia o aviso e remove APENAS os avisos antigos em background
 */
async function garantirAvisoNoTopo(channel, commandChannelId) {
    try {
        if (!channel) return;

        // 1. Envia a nova mensagem primeiro (InstantÃ¢neo)
        const conteudo = criarAvisoDenuncia(commandChannelId);
        const novaMensagem = await channel.send(conteudo);

        // 2. Limpa apenas os avisos antigos (sem travar a execuÃ§Ã£o)
        limparAvisosAntigosBackground(channel, novaMensagem.id);

        return novaMensagem;
    } catch (error) {
        console.error('Erro ao gerenciar aviso no topo:', error);
    }
}

/**
 * FunÃ§Ã£o interna de limpeza: Filtra estritamente pelo tÃ­tulo do aviso
 */
async function limparAvisosAntigosBackground(channel, skipMessageId) {
    try {
        // Busca as Ãºltimas 50 mensagens
        const messages = await channel.messages.fetch({ limit: 50 });
        
        // Filtro Restrito: 
        // Deve ser do BOT && Conter o tÃ­tulo exato && NÃƒO ser a mensagem nova
        const toDelete = messages.filter(m => 
            m.author.id === channel.client.user.id && 
            m.content.includes('Brasil RolePlay â€¢ DENUNCIAS') && 
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
                    } catch (e) { /* Ignora se jÃ¡ apagada */ }
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