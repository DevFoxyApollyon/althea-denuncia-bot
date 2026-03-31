// utils/strikeWords.js

const GIFS_STRIKE = {
  1: 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDdqbzhjczU2aGZ2MXFhd3N0b3BsNHhqdTBsYzdwdnR5MGVmZWdpZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/geslvCFM31sFW/giphy.gif',
  2: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWUxaXN0cm5ldmc0cHZoZzllam5ucnVyZGQ2dTBvNjB4OXg2bjFqeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/eSwGh3YK54JKU/giphy.gif',
  3: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOG0yZTY1bmRoN3huMXFwY3V6c3ZvNTZ3eHh0Z3Flc2lvNnZpY2lvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0u7x2NpbMwtToOoSsY/giphy.gif',
};

// Tempo (em ms) que o aviso fica visível no canal antes de ser deletado
const TEMPO_AVISO_CANAL = 5_000; // 5 segundos

// ─────────────────────────────────────────────────────────────────────────────
// Lista de palavras proibidas (sem duplicatas)
// ─────────────────────────────────────────────────────────────────────────────
const PALAVRAS_PROIBIDAS = [
  'animal', 'anta', 'arrombada', 'arrombado',
  'babaca', 'besta', 'bobalhão', 'bobalhona', 'bocó', 'bosta', 'burra', 'burrice', 'burro',
  'canalha', 'caralho', 'corna', 'corno', 'cretina', 'cretino', 'crápula', 'cuzão', 'cuzona',
  'desgraçado', 'doente', 'doida', 'doido',
  'energúmeno', 'escrota', 'escroto',
  'fdp',
  'galinha',
  'idiota', 'idiotice', 'imbecil',
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function contemPalavraProibida(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  return PALAVRAS_PROIBIDAS.some(p => lower.includes(p));
}

function palavraProibidaUsada(texto) {
  if (!texto) return null;
  const lower = texto.toLowerCase();
  return PALAVRAS_PROIBIDAS.find(p => lower.includes(p)) || null;
}

async function contemMarcacaoAdmin(message, config) {
  // ✅ @everyone e @here sempre bloqueados, independente do config
  if (message.mentions.everyone) return true;

  if (!config?.roles) return false;
  const adminRoleId     = config.roles.administrador;
  const respAdminRoleId = config.roles.responsavel_admin;
  if (!adminRoleId && !respAdminRoleId) return false;
  const mentionedRoles = message.mentions.roles;
  return mentionedRoles.has(adminRoleId) || mentionedRoles.has(respAdminRoleId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Processamento de Strike
// ─────────────────────────────────────────────────────────────────────────────

const { EmbedBuilder } = require('discord.js');
const dateUtils = require('./dateUtils');

async function processaStrike(message, Strike, config) {
  try {
    // Verifica se o canal (ou canal pai de thread) está registrado
    const canaisRegistrados = Object.values(config?.channels || {}).filter(Boolean);
    let canalPrincipalId = message.channel.id;

    if (message.channel.isThread?.() && message.channel.parentId) {
      canalPrincipalId = message.channel.parentId;
    }

    if (!canaisRegistrados.includes(canalPrincipalId)) return;

    // Busca ou cria registro de strikes do usuário
    let strike = await Strike.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!strike) {
      strike = new Strike({ userId: message.author.id, guildId: message.guild.id, strikes: [] });
    }

    strike.cleanOldStrikes();
    strike.strikes.push({ timestamp: new Date() });
    const strikesCount = strike.strikes.length;
    await strike.save();

    // Monta textos e configurações conforme nível do strike
    const motivoBase = palavraProibidaUsada(message.content)
      || (message.mentions.everyone ? '@everyone/@here' : 'marcação de cargo admin');

    let titulo       = '';
    let descricao    = '';
    let motivo       = '';
    let tempoTimeout = 0;
    let corEmbed     = '#ff9900';

    if (strikesCount === 1) {
      titulo       = '⚠️ Primeiro aviso! (1/3)';
      descricao    = `<@${message.author.id}>, evite usar palavras proibidas ou marcar @everyone, @here e cargos de administração.\nVocê foi silenciado por **1 minuto**.`;
      motivo       = `1/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 60 * 1000;
      corEmbed     = '#ff9900';
    } else if (strikesCount === 2) {
      titulo       = '⚠️ Segundo aviso! (2/3)';
      descricao    = `<@${message.author.id}>, esta é sua última chance antes de um silenciamento longo.\nVocê foi silenciado por **5 minutos**.`;
      motivo       = `2/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 5 * 60 * 1000;
      corEmbed     = '#ff6600';
    } else {
      titulo       = '⛔ Terceiro aviso! (3/3)';
      descricao    = `<@${message.author.id}>, você atingiu o limite. Seus strikes foram zerados.\nVocê foi silenciado por **1 hora**.`;
      motivo       = `3/3 - Palavra/cargo: ${motivoBase}`;
      tempoTimeout = 60 * 60 * 1000;
      corEmbed     = '#ff0000';
    }

    const gifUrl = GIFS_STRIKE[Math.min(strikesCount, 3)];

    // Deleta a mensagem ofensiva
    await message.delete().catch(() => {});

    // ── 1) Embed com GIF no canal — temporário (some em 5s) ───────────────
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

    // ── 2) Mesma embed via DM ─────────────────────────────────────────────
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

    // ── 3) Aplica timeout ─────────────────────────────────────────────────
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      await member.timeout?.(tempoTimeout, motivo).catch(() => {});

      if (strikesCount >= 3) {
        strike.strikes = [];
        await strike.save();
      }
    }

    // ── 4) Log de auditoria ───────────────────────────────────────────────
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

module.exports = {
  PALAVRAS_PROIBIDAS,
  contemPalavraProibida,
  contemMarcacaoAdmin,
  processaStrike,
  palavraProibidaUsada,
};