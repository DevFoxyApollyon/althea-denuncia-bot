const Usuarios = require('../models/Usuarios');

/**
 * Busca usuário pelo número e envia DM
 * @param {string} numero - Número a buscar
 * @param {object} guild - Instância da guild
 * @param {object} client - Instância do bot
 * @param {string} mensagem - Mensagem a ser enviada
 * @returns {Promise<boolean>} true se enviado, false se não achou
 */
async function notificarPorNumero(numero, guild, client, mensagem) {
  const userDoc = await Usuarios.findOne({ guildId: guild.id, numero });
  if (!userDoc) return false;
  try {
    const user = await client.users.fetch(userDoc.userId);
    if (!user) return false;
    await user.send(mensagem);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = notificarPorNumero;
