// rank.js
// commands/rank.js  âœ… ATUALIZADO (sem opcode 8 / sem fetch geral de membros)
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');

const RankService = require('../services/rankService');
const Denuncia = require('../models/Denuncia');
const { getBrasiliaDate, formatDateBR } = require('../utils/dateUtils');

const ITEMS_PER_PAGE = 8;

// -------------------------
// Helpers (anti rate-limit)
// -------------------------
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Busca somente os membros necessÃ¡rios (por IDs), evitando o Request Guild Members (opcode 8).
 * Isso usa REST e Ã© bem mais seguro do que guild.members.fetch() sem parÃ¢metros.
 */
async function fetchMembersByIdsSafe(guild, ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);

  if (uniqueIds.length === 0) return;

  // 50~80 Ã© um tamanho seguro (evita bursts grandes)
  const chunks = chunkArray(uniqueIds, 80);

  for (const part of chunks) {
    try {
      // âœ… NÃƒO dispara opcode 8
      await guild.members.fetch({ user: part, force: false });
    } catch (e) {
      // NÃ£o quebra o comando por falha em 1 lote
      console.warn('[RANK] Falha ao buscar lote de membros:', e?.message || e);
    }
    // delay curto pra aliviar REST se tiver muitos IDs
    await sleep(800);
  }
}

// -------------------------
// Datas auxiliares
// -------------------------
function getMonthDates() {
  const now = getBrasiliaDate();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end: now
  };
}

function getWeekDatesLocal() {
  const now = getBrasiliaDate();
  const day = now.getDay(); // 0 dom, 1 seg...
  const diffToMonday = (day + 6) % 7;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diffToMonday);

  return { start, end: now };
}

function getTodayDatesLocal() {
  const now = getBrasiliaDate();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
    end: now
  };
}

// -------------------------
// Stats do dia (denÃºncias)
// -------------------------
async function getDailyStats(guildId) {
  try {
    const today = getBrasiliaDate();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const tomorrow = new Date(startOfDay);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const totalDenuncias = await Denuncia.countDocuments({
      guildId,
      createdAt: { $gte: startOfDay, $lt: tomorrow }
    });

    const totalReivindicadas = await Denuncia.countDocuments({
      guildId,
      createdAt: { $gte: startOfDay, $lt: tomorrow },
      claimedBy: { $ne: null }
    });

    return {
      total: totalDenuncias,
      reivindicadas: totalReivindicadas,
      pendentes: Math.max(0, totalDenuncias - totalReivindicadas)
    };
  } catch {
    return { total: 0, reivindicadas: 0, pendentes: 0 };
  }
}

// -------------------------
// Tabela do Embed
// -------------------------
function buildRankTable(actions) {
  if (!actions.length) return 'Nenhuma aÃ§Ã£o registrada.';

  return actions
    .map((mod, index) => {
      const medal = index === 0 ? 'ðŸ¥‡' : index === 1 ? 'ðŸ¥ˆ' : index === 2 ? 'ðŸ¥‰' : 'â–«ï¸';
      return `${medal} ${(index + 1).toString().padStart(2)}Âº ${mod.tag}
ðŸ“Š Total: ${mod.total} | âœ… ${mod.aceitas} | âŒ ${mod.recusadas} | ðŸ”Ž ${mod.analises}
ðŸ“ Reivindicadas: ${mod.reivindicacoes}
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€`;
    })
    .join('\n');
}

// -------------------------
// TXT Completo
// -------------------------
function generateRankTxt(actions, guildName, label, period, daily) {
  const lines = [
    `ðŸ† RANKING ${label.toUpperCase()} - ${guildName.toUpperCase()}`,
    `PerÃ­odo: ${formatDateBR(period.start)} atÃ© ${formatDateBR(period.end)}`,
    `Gerado em: ${formatDateBR(getBrasiliaDate())}`,
    ``,
    `--- ESTATÃSTICAS DE HOJE (DENÃšNCIAS) ---`,
    `ðŸ“« DenÃºncias: ${daily.total}`,
    `ðŸ“ Reivindicadas: ${daily.reivindicadas}`,
    `ðŸ“Š Pendentes: ${daily.pendentes}`,
    ``,
    `--- RANKING INDIVIDUAL ---`,
    `====================================================`
  ];

  actions.forEach((a, i) => {
    lines.push(
      `${i + 1}Âº LUGAR: ${a.plainTag || a.userId}`,
      `ID: ${a.userId}`,
      `Total: ${a.total}`,
      `âœ… Aceitas: ${a.aceitas}`,
      `âŒ Recusadas: ${a.recusadas}`,
      `ðŸ”Ž AnÃ¡lises: ${a.analises}`,
      `ðŸ“ ReivindicaÃ§Ãµes: ${a.reivindicacoes}`,
      `----------------------------------------------------`
    );
  });

  return lines.join('\n');
}

// -------------------------
// Comando !rank
// -------------------------
// PadrÃ£o: MENSAL
// !rank
// !rank mensal | mes
// !rank semanal | semana
// !rank hoje | dia
async function handleRankCommand(message) {
  let loadingMsg = null;
  let page = 0;

  try {
    if (!message?.guild) return;

    const args = message.content.trim().split(/\s+/).slice(1);
    const arg = (args[0] || '').toLowerCase();

    let type = 'month';
    let label = 'Mensal';
    let period = getMonthDates();

    if (arg === 'semanal' || arg === 'semana') {
      type = 'week';
      label = 'Semanal';
      period = getWeekDatesLocal();
    } else if (arg === 'hoje' || arg === 'dia') {
      type = 'day';
      label = 'Hoje';
      period = getTodayDatesLocal();
    }

    loadingMsg = await message.reply(`ðŸ”„ Gerando ranking **${label.toLowerCase()}**...`);

    const { actions: rawActions } = await RankService.getRankData(message.guild, type);

    if (!rawActions || rawActions.length === 0) {
      return loadingMsg.edit(`âš ï¸ Nenhuma aÃ§Ã£o registrada (${label}).`);
    }

    // âœ… Anti-opcode-8: busca SOMENTE os membros do ranking (por IDs)
    const idsToFetch = rawActions.map((a) => a.userId || a._id).filter(Boolean);
    await fetchMembersByIdsSafe(message.guild, idsToFetch);

    const dailyStats = await getDailyStats(message.guild.id);

    // Normaliza e monta tags (agora o cache tem bem mais chances de ter os membros)
    const actions = rawActions.map((a) => {
      const userId = a.userId || a._id;
      const member = message.guild.members.cache.get(userId);

      return {
        ...a,
        userId,
        plainTag: member ? member.user.username : `Desconhecido (${userId})`,
        tag: member ? `<@${userId}> (${member.user.username})` : `<@${userId}>`,
        aceitas: a.aceitas || 0,
        recusadas: a.recusadas || 0,
        analises: a.analises || 0,
        reivindicacoes: a.reivindicacoes || 0
      };
    });

    const totalPages = Math.max(1, Math.ceil(actions.length / ITEMS_PER_PAGE));

    const txt = generateRankTxt(actions, message.guild.name, label, period, dailyStats);
    const file = new AttachmentBuilder(Buffer.from(txt, 'utf8'), {
      name: `ranking_${type}_${message.guild.id}.txt`
    });

    const createEmbed = (pageNum) => {
      const start = pageNum * ITEMS_PER_PAGE;
      const slice = actions.slice(start, start + ITEMS_PER_PAGE);

      return new EmbedBuilder()
        .setColor('#2F3136')
        .setTitle(`ðŸ† Ranking ${label}`)
        .setDescription(
          `*PerÃ­odo: ${formatDateBR(period.start)} atÃ© ${formatDateBR(period.end)}*\n\n` +
            `ðŸ“« **DenÃºncias Hoje:** ${dailyStats.total} | ðŸ“ **Reiv:** ${dailyStats.reivindicadas} | ðŸ“Š **Pend:** ${dailyStats.pendentes}\n\n` +
            buildRankTable(slice)
        )
        .setFooter({ text: `PÃ¡gina ${pageNum + 1} de ${totalPages}` })
        .setTimestamp();
    };

    const buttons = (pageNum) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('Anterior')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageNum === 0),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('PrÃ³ximo')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageNum >= totalPages - 1)
      );

    await loadingMsg.edit({
      content: `âœ… Ranking **${label.toLowerCase()}** pronto!`,
      embeds: [createEmbed(0)],
      components: totalPages > 1 ? [buttons(0)] : [],
      files: [file]
    });

    if (totalPages <= 1) return;

    const collector = loadingMsg.createMessageComponentCollector({ idle: 120000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: 'âŒ Apenas quem usou o comando.', flags: [MessageFlags.Ephemeral] });
      }

      if (i.customId === 'prev') page--;
      if (i.customId === 'next') page++;

      page = Math.max(0, Math.min(page, totalPages - 1));
      await i.update({ embeds: [createEmbed(page)], components: [buttons(page)] });
    });

    collector.on('end', async () => {
      // opcional: desabilitar botÃµes quando expirar
      if (!loadingMsg) return;
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('next').setLabel('PrÃ³ximo').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        await loadingMsg.edit({ components: [disabledRow] }).catch(() => null);
      } catch {}
    });
  } catch (err) {
    console.error(err);
    if (loadingMsg) loadingMsg.edit('âŒ Erro ao gerar ranking.');
  }
}

module.exports = { handleRankCommand };
