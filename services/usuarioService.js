const Usuario = require('../models/Usuario');

/**
 * Busca um usuário pelo apelido (ex: fox 1039) OU pelo ID do Discord
 * @param {string} termo - Apelido ou ID do Discord
 * @returns {Promise<Usuario|null>}
 */
async function buscarUsuarioPorApelidoOuId(termo) {
  return await Usuario.findOne({
    $or: [
      { apelido: termo },
      { discordId: termo }
    ]
  });
}

/**
 * Envia mensagem privada para o usuário do Discord, se encontrado
 * @param {object} client - Instância do bot Discord.js
 * @param {string} termo - Apelido ou ID do Discord
 * @param {string} mensagem - Mensagem a ser enviada
 * @returns {Promise<boolean>} - true se enviado, false se não encontrado
 */
async function enviarMensagemPvPorApelidoOuId(client, termo, mensagem) {
  const usuario = await buscarUsuarioPorApelidoOuId(termo);
  if (!usuario) return false;
  try {
    const membro = await client.users.fetch(usuario.discordId);
    if (membro) {
      await membro.send(mensagem);
      return true;
    }
  } catch (e) { /* ignorar erro de DM */ }
  return false;
}

module.exports = {
  buscarUsuarioPorApelidoOuId,
  enviarMensagemPvPorApelidoOuId
};
