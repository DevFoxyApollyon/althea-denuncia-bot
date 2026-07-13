const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

const GIFS_STRIKE = {
  1: 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDdqbzhjczU2aGZ2MXFhd3N0b3BsNHhqdTBsYzdwdnR5MGVmZWdpZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/geslvCFM31sFW/giphy.gif',
  2: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWUxaXN0cm5ldmc0cHZoZzllam5ucnVyZGQ2dTBvNjB4OXg2bjFqeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/eSwGh3YK54JKU/giphy.gif',
  3: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOG0yZTY1bmRoN3huMXFwY3V6c3ZvNTZ3eHh0Z3Flc2lvNnZpY2lvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0u7x2NpbMwtToOoSsY/giphy.gif',
};

// GIFs próprios pro strike de link (pode trocar pelos que quiser, ou reaproveitar os de cima)
const GIFS_STRIKE_LINK = {
  1: 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDdqbzhjczU2aGZ2MXFhd3N0b3BsNHhqdTBsYzdwdnR5MGVmZWdpZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/geslvCFM31sFW/giphy.gif',
  2: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWUxaXN0cm5ldmc0cHZoZzllam5ucnVyZGQ2dTBvNjB4OXg2bjFqeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/eSwGh3YK54JKU/giphy.gif',
  3: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOG0yZTY1bmRoN3huMXFwY3V6c3ZvNTZ3eHh0Z3Flc2lvNnZpY2lvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0u7x2NpbMwtToOoSsY/giphy.gif',
};

// GIFs próprios pro strike de emoji/figurinha/gif
const GIFS_STRIKE_EMOJI = {
  1: 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDdqbzhjczU2aGZ2MXFhd3N0b3BsNHhqdTBsYzdwdnR5MGVmZWdpZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/geslvCFM31sFW/giphy.gif',
  2: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWUxaXN0cm5ldmc0cHZoZzllam5ucnVyZGQ2dTBvNjB4OXg2bjFqeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/eSwGh3YK54JKU/giphy.gif',
  3: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOG0yZTY1bmRoN3huMXFwY3V6c3ZvNTZ3eHh0Z3Flc2lvNnZpY2lvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0u7x2NpbMwtToOoSsY/giphy.gif',
};

const TEMPO_AVISO_CANAL = 5_000;

const PALAVRAS_PROIBIDAS = [
  'animal', 'anta', 'arrombada', 'arrombado',
  'babaca', 'besta', 'bobalhão', 'bobalhona', 'bocó', 'bosta', 'burra', 'burrice', 'burro',
  'canalha', 'caralho', 'corna', 'corno', 'cretina', 'cretino', 'crápula', 'cuzão', 'cuzona',
  'desgraçado', 'doente', 'doida', 'doido',
  'energúmeno', 'escrota', 'escroto',
  'fdp', 'v conta', 'vendo conta',
  'galinha','mds', 'seu buraquinho','mrd',
  'idiota', 'idiotice', 'imbecil','Chora n','Desgracado','vacilão','vacilão',
  'jegue', 'jumento',
  'lambe botas', 'lixo',
  'maluca', 'maluco', 'mané', 'merda', 'mongoloide', 'mongol', 'mula',
  'noob',
  'otaria', 'otário', 'otária',
  'palhaça', 'palhaço', 'panaca', 'passa pano', 'piranha', 'pnc', 'porra', 'prostituta', 'puta', 'puto', 'puxa saco',
  'retardada', 'retardado',
  'tanso', 'tapada', 'tapado', 'traste', 'trouxa',
  'vadia', 'vagabunda', 'vagabundo', 'viado',
  'zé ninguém', 'zé povinho', 'zé ruela',
  'chorao',
];

const PALAVRAS_INTEIRAS_PROIBIDAS = [
  /\bk+\b/i,
];

function contemPalavraProibida(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  if (PALAVRAS_PROIBIDAS.some(p => lower.includes(p))) return true;
  if (PALAVRAS_INTEIRAS_PROIBIDAS.some(r => r.test(lower))) return true;
  return false;
}

function palavraProibidaUsada(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();
  const encontrada = PALAVRAS_PROIBIDAS.find(p => lower.includes(p));
  if (encontrada) return encontrada;
  for (const r of PALAVRAS_INTEIRAS_PROIBIDAS) {
    const match = lower.match(r);
    if (match) return match[0];
  }
  return null;
}

async function contemMarcacaoAdmin(message, config) {
  if (message.mentions.everyone) return true;
  if (message.mentions.roles.size > 0) return true;

  // Qualquer marcação de pessoa (exceto o próprio autor se ele se marcar sem querer)
  const usuariosMencionados = message.mentions.users.filter(u => u.id !== message.author.id);
  if (usuariosMencionados.size > 0) return true;

  return false;
}

function getMotivoMarcacao(message) {
  if (message.mentions.everyone) return '@everyone/@here';
  if (message.mentions.roles.size > 0) {
    const nomes = message.mentions.roles.map(r => `@${r.name}`).join(', ');
    return `marcação de cargo: ${nomes}`;
  }
  const usuariosMencionados = message.mentions.users.filter(u => u.id !== message.author.id);
  if (usuariosMencionados.size > 0) {
    const nomes = usuariosMencionados.map(u => u.tag).join(', ');
    return `marcação de usuário: ${nomes}`;
  }
  return 'marcação';
}

// ============================================================
// FILTRO DE LINKS
// ============================================================

// Convite de Discord (server/canal externo) — sempre proibido, não entra na lista de permitidos
const REGEX_CONVITE_DISCORD = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/\S+/i;

// Menção/link de outro canal do próprio servidor: formato <#123456789012345678>
const REGEX_MENCAO_CANAL = /<#\d+>/;

// Qualquer URL genérica
const REGEX_LINK_GENERICO = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

// Domínios liberados: apenas YouTube (vídeo) — ajuste aqui se quiser liberar mais coisa
const DOMINIOS_PERMITIDOS = [
  'youtube.com',
  'youtu.be',
  'cdn.discordapp.com',      // anexos/prints enviados direto no Discord
  'media.discordapp.net',    // idem
];

function contemLinkProibido(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();

  if (REGEX_CONVITE_DISCORD.test(lower)) return true;
  if (REGEX_MENCAO_CANAL.test(texto)) return true;

  const links = lower.match(REGEX_LINK_GENERICO);
  if (!links) return false;

  return links.some(link => !DOMINIOS_PERMITIDOS.some(dom => link.includes(dom)));
}

function linkProibidoUsado(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();

  const conviteMatch = lower.match(REGEX_CONVITE_DISCORD);
  if (conviteMatch) return conviteMatch[0];

  const canalMatch = texto.match(REGEX_MENCAO_CANAL);
  if (canalMatch) return `menção de canal: ${canalMatch[0]}`;

  const links = lower.match(REGEX_LINK_GENERICO);
  if (!links) return null;

  return links.find(link => !DOMINIOS_PERMITIDOS.some(dom => link.includes(dom))) || null;
}

// ============================================================
// FILTRO DE EMOJI / FIGURINHA / GIF
// ============================================================

// Emoji customizado do Discord: <:nome:id> ou animado <a:nome:id>
const REGEX_EMOJI_CUSTOM = /<a?:\w+:\d+>/;

// Emojis unicode (faixas mais comuns: emoticons, símbolos, transporte, bandeiras, setas, etc.)
const REGEX_EMOJI_UNICODE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// Links de GIF (Tenor/Giphy) ou arquivo .gif direto na URL
const REGEX_LINK_GIF = /(tenor\.com|giphy\.com|media\.tenor\.com)\/\S+|\.gif(\?\S*)?(\s|$)/i;

function contemEmojiFigurinhaOuGif(message) {
  if (!message) return false;

  // Figurinha (sticker) do Discord
  if (message.stickers && message.stickers.size > 0) return true;

  const texto = message.content || '';

  // Emoji customizado ou unicode no texto
  if (REGEX_EMOJI_CUSTOM.test(texto)) return true;
  if (REGEX_EMOJI_UNICODE.test(texto)) return true;

  // GIF em texto (link do Tenor/Giphy ou terminando em .gif)
  if (REGEX_LINK_GIF.test(texto.toLowerCase())) return true;

  // GIF/imagem animada anexada como arquivo
  if (message.attachments && message.attachments.size > 0) {
    for (const anexo of message.attachments.values()) {
      const nome = (anexo.name || '').toLowerCase();
      const tipo = (anexo.contentType || '').toLowerCase();
      if (nome.endsWith('.gif') || tipo.includes('gif')) return true;
    }
  }

  return false;
}

function motivoEmojiFigurinhaOuGif(message) {
  if (!message) return null;

  if (message.stickers && message.stickers.size > 0) {
    const nomes = message.stickers.map(s => s.name).join(', ');
    return `figurinha: ${nomes}`;
  }

  const texto = message.content || '';

  const customMatch = texto.match(REGEX_EMOJI_CUSTOM);
  if (customMatch) return `emoji customizado: ${customMatch[0]}`;

  const unicodeMatch = texto.match(REGEX_EMOJI_UNICODE);
  if (unicodeMatch) return `emoji: ${unicodeMatch[0]}`;

  if (REGEX_LINK_GIF.test(texto.toLowerCase())) return 'link de gif';

  if (message.attachments && message.attachments.size > 0) {
    for (const anexo of message.attachments.values()) {
      const nome = (anexo.name || '').toLowerCase();
      const tipo = (anexo.contentType || '').toLowerCase();
      if (nome.endsWith('.gif') || tipo.includes('gif')) return `arquivo gif: ${anexo.name}`;
    }
  }

  return 'emoji/figurinha/gif';
}

// ============================================================
// STRIKE DE PALAVRA / MARCAÇÃO (sistema original, intacto)
// ============================================================

async function processaStrike(message, Strike, config) {
  try {
    const canaisRegistrados = Object.values(config?.channels || {}).filter(Boolean);
    let canalPrincipalId = message.channel.id;

    if (message.channel.isThread?.() && message.channel.parentId) {
      canalPrincipalId = message.channel.parentId;
    }

    if (!canaisRegistrados.includes(canalPrincipalId)) return;

    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [] });
    }

    strike.cleanOldStrikes();
    strike.strikes.push({ timestamp: new Date() });
    const strikesCount = strike.strikes.length;
    await strike.save();

    const motivoBase = palavraProibidaUsada(message.content) || getMotivoMarcacao(message);

    let titulo       = '';
    let descricao    = '';
    let motivo       = '';
    let tempoTimeout = 0;
    let corEmbed     = '#ff9900';

    if (strikesCount === 1) {
      titulo       = '⚠️ Primeiro aviso! (1/3)';
      descricao    = `<@${message.author.id}>, evite usar palavras proibidas ou marcar @everyone, @here, cargos ou qualquer pessoa do servidor.\nVocê foi silenciado por **10 minutos**.`;
      motivo       = `1/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 10 * 60 * 1000;
      corEmbed     = '#ff9900';
    } else if (strikesCount === 2) {
      titulo       = '⚠️ Segundo aviso! (2/3)';
      descricao    = `<@${message.author.id}>, esta é sua última chance antes de um silenciamento longo.\nVocê foi silenciado por **1 hora**.`;
      motivo       = `2/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 60 * 60 * 1000;
      corEmbed     = '#ff6600';
    } else {
      titulo       = '⛔ Terceiro aviso! (3/3)';
      descricao    = `<@${message.author.id}>, você atingiu o limite. Seus strikes foram zerados.\nVocê foi silenciado por **1 dia**.`;
      motivo       = `3/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 24 * 60 * 60 * 1000;
      corEmbed     = '#ff0000';
    }

    const gifUrl = GIFS_STRIKE[Math.min(strikesCount, 3)];

    await message.delete().catch(() => {});

    const embedCanal = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(`${descricao}\n\n*(Esta mensagem some em 5 segundos)*`)
      .setImage(gifUrl)
      .setTimestamp();

    await message.channel.send({
      embeds: [embedCanal],
      allowedMentions: { users: [message.author.id] },
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), TEMPO_AVISO_CANAL))
      .catch(() => {});

    const embedDM = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(descricao)
      .setImage(gifUrl)
      .addFields({ name: 'Servidor', value: message.guild.name, inline: true })
      .setTimestamp();

    const dmEnviada = await message.author.send({ embeds: [embedDM] })
      .then(() => true)
      .catch(() => false);

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      await member.timeout?.(tempoTimeout, motivo).catch(() => {});

      if (strikesCount >= 3) {
        strike.strikes = [];
        await strike.save();
      }
    }

    if (config?.channels?.log) {
      const logChannel = message.guild.channels.cache.get(config.channels.log);
      if (logChannel) {
        const embedLog = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('🚨 Log de Strike Aplicado')
          .setAuthor({
            name: `${message.author.tag} (${message.author.id})`,
            iconURL: message.author.displayAvatarURL?.() || undefined,
          })
          .setThumbnail(message.author.displayAvatarURL?.() || null)
          .setDescription(
            `Strike aplicado no canal <#${message.channel.id}>\n` +
            `[Ir para o canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})`
          )
          .addFields(
            { name: 'Usuário',            value: `<@${message.author.id}>`,                     inline: true  },
            { name: 'Staff (Bot)',         value: `<@${message.client.user.id}>`,                inline: true  },
            { name: 'Motivo',             value: motivo,                                         inline: false },
            { name: 'Mensagem Original',  value: message.content?.slice(0, 1024) || 'N/A',      inline: false },
            { name: 'Strikes Acumulados', value: String(strikesCount),                          inline: true  },
            { name: 'Data/Hora',          value: dateUtils.getBrasiliaDateTime(),                inline: true  },
            { name: 'ID da Mensagem',     value: message.id,                                    inline: true  },
            { name: 'Canal',              value: `<#${message.channel.id}>`,                    inline: true  },
            { name: 'Aviso via DM',       value: dmEnviada ? '✅ Enviado' : '❌ DMs fechadas',  inline: true  },
          )
          .setFooter({ text: `Servidor: ${message.guild.id}` })
          .setTimestamp();

        await logChannel.send({ embeds: [embedLog] }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Erro no sistema de strikes:', e);
  }
}

// ============================================================
// STRIKE DE LINK (sistema novo e separado, contador próprio)
// ============================================================

async function processaStrikeLink(message, Strike, config) {
  try {
    const canaisRegistrados = Object.values(config?.channels || {}).filter(Boolean);
    let canalPrincipalId = message.channel.id;

    if (message.channel.isThread?.() && message.channel.parentId) {
      canalPrincipalId = message.channel.parentId;
    }

    if (!canaisRegistrados.includes(canalPrincipalId)) return;

    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [], strikesLink: [] });
    }
    // Garante que o array existe mesmo em documentos antigos criados antes desse campo
    if (!strike.strikesLink) strike.strikesLink = [];

    // Se você tiver um método próprio no model, troque a linha abaixo por: strike.cleanOldStrikesLink();
    if (typeof strike.cleanOldStrikesLink === 'function') {
      strike.cleanOldStrikesLink();
    }

    strike.strikesLink.push({ timestamp: new Date() });
    const strikesCount = strike.strikesLink.length;
    await strike.save();

    const motivoBase = linkProibidoUsado(message.content) || 'link não permitido';

    let titulo       = '';
    let descricao    = '';
    let motivo       = '';
    let tempoTimeout = 0;
    let corEmbed     = '#ff9900';

    const avisoBase = 'Aqui só é permitido enviar links do **YouTube**. Prints, capturas de tela e outros vídeos devem ser enviados como **anexo/imagem**, não como link.';

    if (strikesCount === 1) {
      titulo       = '🔗 Primeiro aviso de link! (1/3)';
      descricao    = `<@${message.author.id}>, ${avisoBase}\nVocê foi silenciado por **10 minutos**.`;
      motivo       = `1/3 - Link proibido: ${motivoBase}`;
      tempoTimeout = 10 * 60 * 1000;
      corEmbed     = '#ff9900';
    } else if (strikesCount === 2) {
      titulo       = '🔗 Segundo aviso de link! (2/3)';
      descricao    = `<@${message.author.id}>, ${avisoBase}\nEsta é sua última chance antes de um silenciamento longo.\nVocê foi silenciado por **1 hora**.`;
      motivo       = `2/3 - Link proibido: ${motivoBase}`;
      tempoTimeout = 60 * 60 * 1000;
      corEmbed     = '#ff6600';
    } else {
      titulo       = '⛔ Terceiro aviso de link! (3/3)';
      descricao    = `<@${message.author.id}>, você atingiu o limite de links proibidos. Seus strikes de link foram zerados.\nVocê foi silenciado por **1 dia**.`;
      motivo       = `3/3 - Link proibido: ${motivoBase}`;
      tempoTimeout = 24 * 60 * 60 * 1000;
      corEmbed     = '#ff0000';
    }

    const gifUrl = GIFS_STRIKE_LINK[Math.min(strikesCount, 3)];

    await message.delete().catch(() => {});

    const embedCanal = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(`${descricao}\n\n*(Esta mensagem some em 5 segundos)*`)
      .setImage(gifUrl)
      .setTimestamp();

    await message.channel.send({
      embeds: [embedCanal],
      allowedMentions: { users: [message.author.id] },
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), TEMPO_AVISO_CANAL))
      .catch(() => {});

    const embedDM = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(descricao)
      .setImage(gifUrl)
      .addFields({ name: 'Servidor', value: message.guild.name, inline: true })
      .setTimestamp();

    const dmEnviada = await message.author.send({ embeds: [embedDM] })
      .then(() => true)
      .catch(() => false);

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      await member.timeout?.(tempoTimeout, motivo).catch(() => {});

      if (strikesCount >= 3) {
        strike.strikesLink = [];
        await strike.save();
      }
    }

    if (config?.channels?.log) {
      const logChannel = message.guild.channels.cache.get(config.channels.log);
      if (logChannel) {
        const embedLog = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('🔗🚨 Log de Strike de Link Aplicado')
          .setAuthor({
            name: `${message.author.tag} (${message.author.id})`,
            iconURL: message.author.displayAvatarURL?.() || undefined,
          })
          .setThumbnail(message.author.displayAvatarURL?.() || null)
          .setDescription(
            `Strike de link aplicado no canal <#${message.channel.id}>\n` +
            `[Ir para o canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})`
          )
          .addFields(
            { name: 'Usuário',            value: `<@${message.author.id}>`,                     inline: true  },
            { name: 'Staff (Bot)',         value: `<@${message.client.user.id}>`,                inline: true  },
            { name: 'Motivo',             value: motivo,                                         inline: false },
            { name: 'Mensagem Original',  value: message.content?.slice(0, 1024) || 'N/A',      inline: false },
            { name: 'Strikes de Link',    value: String(strikesCount),                          inline: true  },
            { name: 'Data/Hora',          value: dateUtils.getBrasiliaDateTime(),                inline: true  },
            { name: 'ID da Mensagem',     value: message.id,                                    inline: true  },
            { name: 'Canal',              value: `<#${message.channel.id}>`,                    inline: true  },
            { name: 'Aviso via DM',       value: dmEnviada ? '✅ Enviado' : '❌ DMs fechadas',  inline: true  },
          )
          .setFooter({ text: `Servidor: ${message.guild.id}` })
          .setTimestamp();

        await logChannel.send({ embeds: [embedLog] }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Erro no sistema de strikes de link:', e);
  }
}

// ============================================================
// STRIKE DE EMOJI / FIGURINHA / GIF (sistema novo e separado, contador próprio)
// ============================================================

async function processaStrikeEmoji(message, Strike, config) {
  try {
    const canaisRegistrados = Object.values(config?.channels || {}).filter(Boolean);
    let canalPrincipalId = message.channel.id;

    if (message.channel.isThread?.() && message.channel.parentId) {
      canalPrincipalId = message.channel.parentId;
    }

    if (!canaisRegistrados.includes(canalPrincipalId)) return;

    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [], strikesLink: [], strikesEmoji: [] });
    }
    // Garante que o array existe mesmo em documentos antigos criados antes desse campo
    if (!strike.strikesEmoji) strike.strikesEmoji = [];

    // Se você tiver um método próprio no model, troque a linha abaixo por: strike.cleanOldStrikesEmoji();
    if (typeof strike.cleanOldStrikesEmoji === 'function') {
      strike.cleanOldStrikesEmoji();
    }

    strike.strikesEmoji.push({ timestamp: new Date() });
    const strikesCount = strike.strikesEmoji.length;
    await strike.save();

    const motivoBase = motivoEmojiFigurinhaOuGif(message) || 'emoji/figurinha/gif';

    let titulo       = '';
    let descricao    = '';
    let motivo       = '';
    let tempoTimeout = 0;
    let corEmbed     = '#ff9900';

    const avisoBase = 'Aqui é proibido enviar **emojis, figurinhas ou GIFs** nas mensagens.';

    if (strikesCount === 1) {
      titulo       = '😶 Primeiro aviso de emoji/figurinha/gif! (1/3)';
      descricao    = `<@${message.author.id}>, ${avisoBase}\nVocê foi silenciado por **10 minutos**.`;
      motivo       = `1/3 - Emoji/figurinha/gif: ${motivoBase}`;
      tempoTimeout = 10 * 60 * 1000;
      corEmbed     = '#ff9900';
    } else if (strikesCount === 2) {
      titulo       = '😶 Segundo aviso de emoji/figurinha/gif! (2/3)';
      descricao    = `<@${message.author.id}>, ${avisoBase}\nEsta é sua última chance antes de um silenciamento longo.\nVocê foi silenciado por **1 hora**.`;
      motivo       = `2/3 - Emoji/figurinha/gif: ${motivoBase}`;
      tempoTimeout = 60 * 60 * 1000;
      corEmbed     = '#ff6600';
    } else {
      titulo       = '⛔ Terceiro aviso de emoji/figurinha/gif! (3/3)';
      descricao    = `<@${message.author.id}>, você atingiu o limite de emoji/figurinha/gif. Seus strikes foram zerados.\nVocê foi silenciado por **1 dia**.`;
      motivo       = `3/3 - Emoji/figurinha/gif: ${motivoBase}`;
      tempoTimeout = 24 * 60 * 60 * 1000;
      corEmbed     = '#ff0000';
    }

    const gifUrl = GIFS_STRIKE_EMOJI[Math.min(strikesCount, 3)];

    await message.delete().catch(() => {});

    const embedCanal = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(`${descricao}\n\n*(Esta mensagem some em 5 segundos)*`)
      .setImage(gifUrl)
      .setTimestamp();

    await message.channel.send({
      embeds: [embedCanal],
      allowedMentions: { users: [message.author.id] },
    }).then(msg => setTimeout(() => msg.delete().catch(() => {}), TEMPO_AVISO_CANAL))
      .catch(() => {});

    const embedDM = new EmbedBuilder()
      .setColor(corEmbed)
      .setTitle(titulo)
      .setDescription(descricao)
      .setImage(gifUrl)
      .addFields({ name: 'Servidor', value: message.guild.name, inline: true })
      .setTimestamp();

    const dmEnviada = await message.author.send({ embeds: [embedDM] })
      .then(() => true)
      .catch(() => false);

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      await member.timeout?.(tempoTimeout, motivo).catch(() => {});

      if (strikesCount >= 3) {
        strike.strikesEmoji = [];
        await strike.save();
      }
    }

    if (config?.channels?.log) {
      const logChannel = message.guild.channels.cache.get(config.channels.log);
      if (logChannel) {
        const embedLog = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('😶🚨 Log de Strike de Emoji/Figurinha/Gif Aplicado')
          .setAuthor({
            name: `${message.author.tag} (${message.author.id})`,
            iconURL: message.author.displayAvatarURL?.() || undefined,
          })
          .setThumbnail(message.author.displayAvatarURL?.() || null)
          .setDescription(
            `Strike de emoji/figurinha/gif aplicado no canal <#${message.channel.id}>\n` +
            `[Ir para o canal](https://discord.com/channels/${message.guild.id}/${message.channel.id})`
          )
          .addFields(
            { name: 'Usuário',            value: `<@${message.author.id}>`,                     inline: true  },
            { name: 'Staff (Bot)',         value: `<@${message.client.user.id}>`,                inline: true  },
            { name: 'Motivo',             value: motivo,                                         inline: false },
            { name: 'Mensagem Original',  value: message.content?.slice(0, 1024) || 'N/A',      inline: false },
            { name: 'Strikes Emoji',      value: String(strikesCount),                          inline: true  },
            { name: 'Data/Hora',          value: dateUtils.getBrasiliaDateTime(),                inline: true  },
            { name: 'ID da Mensagem',     value: message.id,                                    inline: true  },
            { name: 'Canal',              value: `<#${message.channel.id}>`,                    inline: true  },
            { name: 'Aviso via DM',       value: dmEnviada ? '✅ Enviado' : '❌ DMs fechadas',  inline: true  },
          )
          .setFooter({ text: `Servidor: ${message.guild.id}` })
          .setTimestamp();

        await logChannel.send({ embeds: [embedLog] }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Erro no sistema de strikes de emoji/figurinha/gif:', e);
  }
}

// ============================================================
// VERIFICAÇÃO DE MENSAGEM EDITADA
// ============================================================

async function verificaEdicao(oldMessage, newMessage, Strike, config) {
  try {
    if (!newMessage.author || newMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;

    const msg = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!msg) return;

    const temPalavra = contemPalavraProibida(msg.content);
    const temAdmin   = await contemMarcacaoAdmin(msg, config);
    const temLink    = contemLinkProibido(msg.content);
    const temEmoji   = contemEmojiFigurinhaOuGif(msg);

    if (temLink) {
      await processaStrikeLink(msg, Strike, config);
      return;
    }

    if (temEmoji) {
      await processaStrikeEmoji(msg, Strike, config);
      return;
    }

    if (temPalavra || temAdmin) {
      await processaStrike(msg, Strike, config);
    }
  } catch (e) {
    console.error('Erro ao verificar edição de mensagem:', e);
  }
}

module.exports = {
  PALAVRAS_PROIBIDAS,
  contemPalavraProibida,
  contemMarcacaoAdmin,
  contemLinkProibido,
  contemEmojiFigurinhaOuGif,
  processaStrike,
  processaStrikeLink,
  processaStrikeEmoji,
  palavraProibidaUsada,
  linkProibidoUsado,
  motivoEmojiFigurinhaOuGif,
  verificaEdicao,
};