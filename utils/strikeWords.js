// utils/strikeWords.js
// Lista inicial de palavras para castigo. Adicione mais conforme necessário.
const PALAVRAS_PROIBIDAS = [
  'chorao',
  'arrombado',
  'otario',
  'burro',
  'corno',
  'fdp',
  'lixo',
  'merda',
  'noob',
  'mongol',
  'retardado',
  'bosta',
  'desgraçado',
  'idiota',
  'imbecil',
  'palhaço',
  'tanso',
  'animal',
  'babaca',
  'trouxa',
  'vagabundo',
  'viado',
  'pnc',
  'porra',
  'caralho',
  'puta',
  'puto',
  'cuzão',
  'cuzona',
  'bocó',
  'mané',
  'tapado',
  'zé ruela',
  'zé povinho',
  'zé ninguém',
  'bobalhão',
  'panaca',
  'traste',
  'escroto',
  'escrota',
  'canalha',
  'crápula',
  'energúmeno',
  'maluco',
  'doente',
  'doida',
  'doido',
  'maluca',
  'idiotice',
  'burrice',
  'otária',
  'arrombada',
  'corna',
  'vagabunda',
  'vadia',
  'piranha',
  'galinha',
  'prostituta',
  'escrota',
  'escroto',
  'cretino',
  'cretina',
  'imbecil',
  'imbecil',
  'mongoloide',
  'mongol',
  'retardada',
  'retardado',
  'besta',
  'anta',
  'mula',
  'jumento',
  'jegue',
  'burra',
  'tapada',
  'bocó',
  'mané',
  'panaca',
  'trouxa',
  'tanso',
  'palhaça',
  'bobalhona',
  'bobalhão',
  'zé ruela',
  'zé povinho',
  'zé ninguém',
  'traste',
  'escroto',
  'escrota',
  'canalha',
  'crápula',
  'energúmeno',
  'maluca',
  'doida',
  'doido',
  'maluco',
  'idiotice',
  'burrice',
  'otária',
  'arrombada',
  'corna',
  'vagabunda',
  'vadia',
  'piranha',
  'galinha',
  'prostituta',
  'escrota',
  'escroto',
  'cretino',
  'cretina',
  'imbecil',
  'mongoloide',
  'mongol',
  'retardada',
  'retardado',
  'besta',
  'anta',
  'mula',
  'jumento',
  'jegue',
  'burra',
  'tapada',
  'passa pano',
  'puxa saco',
  'lambe botas'

];


function contemPalavraProibida(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  return PALAVRAS_PROIBIDAS.some(p => lower.includes(p));
}

// Retorna a palavra proibida encontrada, ou null
function palavraProibidaUsada(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();
  return PALAVRAS_PROIBIDAS.find(p => lower.includes(p)) || null;
}

async function contemMarcacaoAdmin(message, config) {
  if (!config?.roles) return false;
  const adminRoleId = config.roles.administrador;
  const respAdminRoleId = config.roles.responsavel_admin;
  if (!adminRoleId && !respAdminRoleId) return false;
  const mentionedRoles = message.mentions.roles;
  return mentionedRoles.has(adminRoleId) || mentionedRoles.has(respAdminRoleId);
}

const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

async function processaStrike(message, Strike, config) {
  try {
    // Verifica se o canal da mensagem está registrado em config.channels
    const canaisRegistrados = Object.values(config?.channels || {}).filter(Boolean);
    if (!canaisRegistrados.includes(message.channel.id)) {
      // Se não estiver, não processa o strike
      return;
    }

    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [] });
    }
    // Limpa strikes antigos
    strike.cleanOldStrikes();
    strike.strikes.push({ timestamp: new Date() });
    const strikesCount = strike.strikes.length;
    await strike.save();

    // Descobre palavra proibida usada (se houver)
    const palavraUsada = palavraProibidaUsada(message.content);
    let motivo = '';
    let aviso = '';
    if (strikesCount === 1) {
      aviso = `⚠️ Primeiro aviso! (1/3)\nEvite usar palavras proibidas ou marcar cargos de administração. Você foi silenciado por 1 minuto.`;
      motivo = `1/3 - Palavra/cargo: ${palavraUsada || 'marcação de cargo admin'}`;
    } else if (strikesCount === 2) {
      aviso = `⚠️ Segundo aviso! (2/3)\nVocê foi silenciado por 5 minutos.`;
      motivo = `2/3 - Palavra/cargo: ${palavraUsada || 'marcação de cargo admin'}`;
    } else if (strikesCount >= 3) {
      aviso = `⛔ Terceiro aviso! (3/3)\nVocê foi silenciado por 1 hora.`;
      motivo = `3/3 - Palavra/cargo: ${palavraUsada || 'marcação de cargo admin'}`;
    }

    // Tenta deletar a mensagem ofensiva
    await message.delete().catch(() => {});

    // Envia aviso no canal (apenas para o usuário)
    await message.channel.send({
      content: `<@${message.author.id}> ${aviso}`,
      allowedMentions: { users: [message.author.id] }
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 8000));

    // Envia DM
    await message.author.send(aviso).catch(() => {});

    // Aplica punição
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      if (strikesCount === 1) {
        // Mute por 1 minuto
        await member.timeout?.(60 * 1000, motivo).catch(() => {});
      } else if (strikesCount === 2) {
        // Mute por 5 minutos
        await member.timeout?.(5 * 60 * 1000, motivo).catch(() => {});
      } else if (strikesCount >= 3) {
        // Mute por 1 hora
        await member.timeout?.(60 * 60 * 1000, motivo).catch(() => {});
        // Reseta strikes
        strike.strikes = [];
        await strike.save();
      }
    }

    // Envia log detalhado para o canal de auditoria (embed)
    if (config?.channels?.log) {
      const logChannel = message.guild.channels.cache.get(config.channels.log);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('🚨 Log de Strike Aplicado')
          .setAuthor({
            name: `${message.author.tag} (${message.author.id})`,
            iconURL: message.author.displayAvatarURL?.() || undefined
          })
          .setThumbnail(message.author.displayAvatarURL?.() || null)
          .setDescription(`Strike aplicado no canal <#${message.channel.id}> (${message.channel.id})\n[Ir para o canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})`)
          .addFields(
            { name: 'Usuário', value: `<@${message.author.id}>`, inline: true },
            { name: 'Staff (Bot)', value: `<@${message.client.user.id}> (${message.client.user.tag})`, inline: true },
            { name: 'Motivo', value: motivo, inline: false },
            { name: 'Mensagem Original', value: message.content?.slice(0, 1024) || 'Mensagem não disponível', inline: false },
            { name: 'Quantidade de Strikes', value: String(strikesCount), inline: true },
            { name: 'Data/Hora', value: dateUtils.getBrasiliaDateTime(), inline: true },
            { name: 'Mensagem Deletada', value: message.id, inline: true },
            { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }
          )
          .setFooter({
            text: `ID do Servidor: ${message.guild.id}`
          })
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
    return;
  } catch (e) {
    console.error('Erro no sistema de strikes:', e);
  }
}

module.exports = {
  PALAVRAS_PROIBIDAS,
  contemPalavraProibida,
  contemMarcacaoAdmin,
  processaStrike,
  palavraProibidaUsada
};
