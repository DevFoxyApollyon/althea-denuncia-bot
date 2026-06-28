// notificarPorNumero.js
const Usuarios = require('../models/Usuarios');

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
