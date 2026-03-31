// Sincroniza todos os nicks dos membros de um servidor para o banco de dados secundário

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Usuario = require('../models/Usuario');
const { extrairContaDoNickname } = require('../utils/nickUtils');

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    const members = guild.members.cache.filter(m => !m.user.bot);
    let count = 0;
    for (const member of members.values()) {
      await Usuario.findOneAndUpdate(
        { guildId: guild.id, discordId: member.user.id },
        { $set: { apelido: member.user.tag } },
        { upsert: true, new: true }
      );
      count++;
    }
    console.log(`Sincronização concluída: ${count} usuários atualizados.`);
  } catch (e) {
    console.error('Erro ao sincronizar usuários:', e);
  } finally {
    client.destroy();
  }
});

client.login(TOKEN);

const Usuarios = require('../models/Usuarios');

module.exports = async function syncUsuarioNick(member) {
  const nick = member.nickname || member.user.username;

  // Extrai o número de conta usando a regra validada
  const numero = extrairContaDoNickname(nick);
  if (!numero) return; // nick inválido ou ambíguo, ignora

  // Anti duplicação: só um userId por número por guild
  const existente = await Usuarios.findOne({ guildId: member.guild.id, numero });
  if (existente && existente.userId !== member.id) {
    return;
  }

  await Usuarios.updateOne(
    { guildId: member.guild.id, numero },
    {
      $set: {
        userId: member.id,
        username: member.user.username,
        nickname: member.nickname,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
};