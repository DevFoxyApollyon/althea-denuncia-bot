// Alertas de segurança e de falha da ponte com a gamemode. Vão para o canal de
// alertas da ponte (vazio: Log Admin) e, no selo inválido, também por DM ao dono.
// Nada aqui pode derrubar a API: todo erro só vai para o log.
const { EmbedBuilder } = require('discord.js');
const PonteServidor = require('../../models/PonteServidor');
const { getConfig } = require('../../utils/configCache');
const { dmPausada, registrarErroDeDM } = require('../../utils/dmSegura');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteGamemode' });

async function canalDeAlertas(client, guildId) {
  if (!client || !guildId) return null;
  const [servidor, config] = await Promise.all([
    PonteServidor.findOne({ guildId: String(guildId) }, { canalAlertasId: 1 }).lean().catch(() => null),
    getConfig(guildId).catch(() => null)
  ]);
  const canalId = servidor?.canalAlertasId || config?.channels?.log;
  const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
  return canal?.send ? canal : null;
}

async function avisarDono(client, texto) {
  const dono = String(process.env.OWNER_DISCORD_ID || '').trim();
  if (!client || !dono || dmPausada()) return false;
  try {
    const usuario = await client.users.fetch(dono);
    await usuario.send({ content: texto.slice(0, 2000) });
    return true;
  } catch (erro) {
    registrarErroDeDM(erro);
    log.warn(`Não foi possível avisar o dono por DM: ${erro.message}`);
    return false;
  }
}

async function enviarNoCanal(client, guildId, embed) {
  const canal = await canalDeAlertas(client, guildId);
  if (!canal) return false;
  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

// A gamemode recusou o selo de um pedido: alguém adulterou o pedido ou há um bug grave.
// A conexão já foi pausada no Althea; a gamemode pausou do lado dela.
async function alertarSeloInvalido(client, { conexao, pedido }) {
  try {
    const texto = `🚨 **Ponte com a gamemode:** a conexão **${conexao.nome}** (guild ${conexao.guildId}, …${conexao.ultimos4 || '????'}) recusou o selo do pedido \`${pedido?._id || '?'}\`. A conexão foi **pausada**. Confira a credencial antes de retomar (\`/ponte gamemode retomar\`); se houver suspeita de vazamento, use \`/ponte gamemode renovar\`.`;
    await avisarDono(client, texto);
    await enviarNoCanal(client, conexao.guildId, new EmbedBuilder()
      .setColor('#C0392B')
      .setTitle('🚨 Selo inválido na gamemode')
      .setDescription(texto)
      .setTimestamp());
  } catch (erro) {
    log.warn(`Falha ao alertar selo inválido: ${erro.message}`);
  }
}

// Falhas de autenticação demais: o IP ficou bloqueado por 10 minutos.
async function alertarIpBloqueado(client, { ip, guildId = '', minutos = 10 }) {
  try {
    const texto = `🚨 **Ponte com a gamemode:** o IP \`${ip}\` errou a autenticação várias vezes e ficou **bloqueado por ${minutos} minutos**. Se for o servidor do jogo, confira o relógio (NTP) e o arquivo \`althea_credenciais.txt\`.`;
    const enviado = await enviarNoCanal(client, guildId, new EmbedBuilder()
      .setColor('#E67E22')
      .setTitle('🔒 IP bloqueado na API da gamemode')
      .setDescription(texto)
      .setTimestamp());
    // Sem saber de qual guild era (credencial inexistente), só o dono fica sabendo.
    if (!enviado) await avisarDono(client, texto);
  } catch (erro) {
    log.warn(`Falha ao alertar IP bloqueado: ${erro.message}`);
  }
}

// Pedido devolvido mais de 5 vezes (gamemode pausada ou no limite por hora): virou erro.
async function alertarDevolucoes(client, { pedido }) {
  try {
    await enviarNoCanal(client, pedido.guildId, new EmbedBuilder()
      .setColor('#E67E22')
      .setTitle('⛔ Pedido devolvido demais pela gamemode')
      .setDescription(`O pedido \`${pedido._id}\` (${pedido.tipo} \`${pedido.conta || pedido.nick}\`) foi devolvido ${pedido.devolucoes} vezes (último código: \`${pedido.codigo}\`) e **não foi aplicado**. Confira a gamemode (\`rcon althea status\`) e envie de novo pelo embed da punição.`)
      .setTimestamp());
  } catch (erro) {
    log.warn(`Falha ao alertar devoluções: ${erro.message}`);
  }
}

module.exports = { alertarSeloInvalido, alertarIpBloqueado, alertarDevolucoes, canalDeAlertas, avisarDono };
