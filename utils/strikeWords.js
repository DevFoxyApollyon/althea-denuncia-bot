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
  'tapada'
];

function contemPalavraProibida(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  return PALAVRAS_PROIBIDAS.some(p => lower.includes(p));
}

async function contemMarcacaoAdmin(message, config) {
  if (!config?.roles) return false;
  const adminRoleId = config.roles.administrador;
  const respAdminRoleId = config.roles.responsavel_admin;
  if (!adminRoleId && !respAdminRoleId) return false;
  const mentionedRoles = message.mentions.roles;
  return mentionedRoles.has(adminRoleId) || mentionedRoles.has(respAdminRoleId);
}

async function processaStrike(message, Strike, config) {
  try {
    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [] });
    }
    // Limpa strikes antigos
    strike.cleanOldStrikes();
    strike.strikes.push({ timestamp: new Date() });
    const strikesCount = strike.strikes.length;
    await strike.save();

    // Mensagem de aviso personalizada
    let aviso = '';
    if (strikesCount === 1) {
      aviso = '⚠️ Primeiro aviso! (1/3)\nEvite usar palavras proibidas. Você foi silenciado por 5 segundos.';
    } else if (strikesCount === 2) {
      aviso = '⚠️ Segundo aviso! (2/3)\nVocê foi silenciado por 5 segundos.';
    } else if (strikesCount >= 3) {
      aviso = '⛔ Terceiro aviso! (3/3)\nVocê foi silenciado por 1 hora.';
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
      if (strikesCount === 1 || strikesCount === 2) {
        // Mute por 5 segundos
        await member.timeout?.(5000, 'Aviso de palavras proibidas').catch(() => {});
      } else if (strikesCount >= 3) {
        // Mute por 1 hora
        await member.timeout?.(60 * 60 * 1000, 'Terceiro aviso de palavras proibidas').catch(() => {});
        // Reseta strikes
        strike.strikes = [];
        await strike.save();
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
  processaStrike
};
