const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');

const RankService = require('../services/rankService');
const Denuncia = require('../models/Denuncia');
const { getConfig } = require('../utils/configCache');
const { getBrasiliaDate, formatDateBR } = require('../utils/dateUtils');

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

const CONFIG = {
  itemsPerPage: 6,
  lifetimeMs: 600_000, // o ranking é apagado após 10 minutos
  cooldownMs: 15_000,
  cacheTtlMs: 60_000,
  fetchChunkSize: 80,
  fetchDelayMs: 800,
  color: 0x2f3136,
};

const PERIODS = {
  month: {
    label: 'Mensal',
    aliases: ['mensal', 'mes', 'mês', 'month'],
    getDates() {
      const now = getBrasiliaDate();
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    }
  },
  week: {
    label: 'Semanal',
    aliases: ['semanal', 'semana', 'week'],
    getDates() {
      const now = getBrasiliaDate();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - ((now.getDay() + 6) % 7)); // segunda-feira
      return { start, end: now };
    }
  },
  day: {
    label: 'Hoje',
    aliases: ['hoje', 'dia', 'day'],
    getDates() {
      const now = getBrasiliaDate();
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now };
    }
  }
};

const cache = new Map(); // `${guildId}:${type}` -> { at, data }
const cooldowns = new Map(); // userId -> timestamp

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function resolvePeriod(arg) {
  const key = Object.keys(PERIODS).find((k) => PERIODS[k].aliases.includes(arg));
  return key || 'month';
}

async function canUse({ guild, member }) {
  const config = await getConfig(guild.id);
  const roleIds = [
    config?.roles?.administrador,
    config?.roles?.responsavel_admin
  ].filter(Boolean);

  return roleIds.some((roleId) => member?.roles.cache.has(roleId));
}

function onCooldown(userId) {
  const last = cooldowns.get(userId) || 0;
  const remaining = CONFIG.cooldownMs - (Date.now() - last);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  cooldowns.set(userId, Date.now());
  return 0;
}

// Mesmos critérios do sistema de feedback (ideal: mover para utils/feedbackUtils.js e importar nos dois).
function emojiNota(n) {
  if (n >= 9) return '🌟';
  if (n >= 7) return '✅';
  if (n >= 5) return '⚠️';
  return '❌';
}

function labelNota(n) {
  if (n >= 9) return 'Excelente';
  if (n >= 7) return 'Bom';
  if (n >= 5) return 'Regular';
  if (n >= 3) return 'Ruim';
  return 'Péssimo';
}

function formatQualidade(q) {
  if (!q) return '⭐ *Sem avaliações no período*';
  const plural = q.avaliacoes === 1 ? 'avaliação' : 'avaliações';
  return `${emojiNota(q.media)} **${q.media.toFixed(1)}/10** · ${labelNota(q.media)} · ${q.avaliacoes} ${plural}`;
}

// Busca só quem ainda não está no cache, reduzindo requisições à API do Discord.
async function fetchMissingMembers(guild, ids) {
  const missing = [...new Set(ids)].filter((id) => id && !guild.members.cache.has(id));
  for (const part of chunkArray(missing, CONFIG.fetchChunkSize)) {
    try {
      await guild.members.fetch({ user: part });
    } catch (e) {
      console.warn('[RANK] Falha ao buscar lote de membros:', e?.message || e);
    }
    await sleep(CONFIG.fetchDelayMs);
  }
}

/* ------------------------------------------------------------------ */
/* Dados                                                               */
/* ------------------------------------------------------------------ */

async function getDailyStats(guildId) {
  const now = getBrasiliaDate();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const range = { guildId, createdAt: { $gte: start, $lt: end } };

  try {
    const [total, reivindicadas] = await Promise.all([
      Denuncia.countDocuments(range),
      Denuncia.countDocuments({ ...range, claimedBy: { $ne: null } })
    ]);
    return { total, reivindicadas, pendentes: Math.max(0, total - reivindicadas) };
  } catch (err) {
    console.error('[RANK] Erro ao buscar estatísticas diárias:', err);
    return { total: 0, reivindicadas: 0, pendentes: 0 };
  }
}

// Qualidade de atendimento = média das notas de feedback recebidas no período.
async function getQualidadeStats(guildId, period) {
  const vazio = { porStaff: new Map(), media: null, avaliacoes: 0 };

  try {
    const rows = await Denuncia.aggregate([
      {
        $match: {
          guildId,
          feedbackNota: { $ne: null },
          feedbackStaffId: { $ne: null },
          feedbackEm: { $gte: period.start, $lte: period.end }
        }
      },
      {
        $group: {
          _id: '$feedbackStaffId',
          media: { $avg: '$feedbackNota' },
          avaliacoes: { $sum: 1 }
        }
      }
    ]);

    const avaliacoes = rows.reduce((s, r) => s + r.avaliacoes, 0);
    const soma = rows.reduce((s, r) => s + r.media * r.avaliacoes, 0);

    return {
      porStaff: new Map(rows.map((r) => [r._id, { media: r.media, avaliacoes: r.avaliacoes }])),
      media: avaliacoes ? soma / avaliacoes : null,
      avaliacoes
    };
  } catch (err) {
    console.error('[RANK] Erro ao buscar qualidade de atendimento:', err);
    return vazio;
  }
}

async function loadRank(guild, type) {
  const key = `${guild.id}:${type}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CONFIG.cacheTtlMs) return hit.data;

  const period = PERIODS[type].getDates();
  const [rank, daily, qualidade] = await Promise.all([
    RankService.getRankData(guild, type),
    getDailyStats(guild.id),
    getQualidadeStats(guild.id, period)
  ]);

  const raw = rank?.actions ?? [];
  await fetchMissingMembers(guild, raw.map((a) => a.userId || a._id));

  const actions = raw.map((a) => {
    const userId = a.userId || a._id;
    const member = guild.members.cache.get(userId);
    return {
      ...a,
      userId,
      plainTag: member?.user.username ?? `Ex-membro (${userId})`,
      mention: member ? `<@${userId}>` : `~~<@${userId}>~~ *(saiu)*`,
      aceitas: a.aceitas || 0,
      recusadas: a.recusadas || 0,
      analises: a.analises || 0,
      reivindicacoes: a.reivindicacoes || 0,
      qualidade: qualidade.porStaff.get(userId) ?? null
    };
  });

  const totals = actions.reduce(
    (acc, a) => {
      acc.aceitas += a.aceitas;
      acc.recusadas += a.recusadas;
      acc.analises += a.analises;
      acc.reivindicacoes += a.reivindicacoes;
      return acc;
    },
    { aceitas: 0, recusadas: 0, analises: 0, reivindicacoes: 0 }
  );

  const data = { type, label: PERIODS[type].label, period, daily, qualidade, actions, totals };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/* ------------------------------------------------------------------ */
/* Apresentação                                                        */
/* ------------------------------------------------------------------ */

const MEDALS = ['🥇', '🥈', '🥉'];

// Um campo por moderador: cabeçalho com posição + nome, depois produção e qualidade.
function buildRankFields(slice, offset) {
  return slice.map((a, i) => {
    const pos = offset + i;
    return {
      name: `${MEDALS[pos] || '▪️'} ${pos + 1}º • ${a.plainTag}`,
      value:
        `${a.mention}\n` +
        `✅ **${a.aceitas}** aceitas · ❌ **${a.recusadas}** recusadas\n` +
        `🔎 **${a.analises}** análises · 📌 **${a.reivindicacoes}** reivindicadas\n` +
        formatQualidade(a.qualidade),
      inline: false
    };
  });
}

function buildEmbed(data, page, totalPages, expiresAt) {
  const { actions, totals, daily, qualidade, period, label } = data;
  const offset = page * CONFIG.itemsPerPage;
  const slice = actions.slice(offset, offset + CONFIG.itemsPerPage);

  const decididas = totals.aceitas + totals.recusadas;
  const taxa = decididas ? `${Math.round((totals.aceitas / decididas) * 100)}%` : '—';

  const embed = new EmbedBuilder()
    .setColor(CONFIG.color)
    .setTitle(`🏆 Ranking ${label} • Staff`)
    .setDescription(
      `*Período: ${formatDateBR(period.start)} até ${formatDateBR(period.end)}*\n` +
        `🕒 *Esta mensagem some <t:${Math.floor(expiresAt / 1000)}:R>*` +
        (slice.length ? '' : '\n\n*Nenhuma ação registrada neste período.*')
    )
    .addFields(buildRankFields(slice, offset))
    .addFields(
      {
        name: '📈 Resumo',
        value: `✅ ${totals.aceitas} · ❌ ${totals.recusadas} · 🔎 ${totals.analises}\nAprovação: **${taxa}**`,
        inline: true
      },
      {
        name: '⭐ Qualidade geral',
        value: qualidade.media
          ? `${emojiNota(qualidade.media)} **${qualidade.media.toFixed(1)}/10**\n${qualidade.avaliacoes} avaliações`
          : '*Sem avaliações*',
        inline: true
      },
    )
    .setFooter({ text: `Página ${page + 1} de ${totalPages} • ${actions.length} moderador(es)` })
    .setTimestamp();

  return embed;
}

function buildComponents(type, page, totalPages) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('rank_period')
    .setPlaceholder('Trocar período')
    .addOptions(
      Object.entries(PERIODS).map(([key, p]) => ({
        label: p.label,
        value: key,
        default: key === type
      }))
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rank_prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('rank_next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('rank_export')
      .setLabel('Exportar TXT')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Primary)
  );

  return [new ActionRowBuilder().addComponents(select), buttons];
}

function buildTxt(data, guildName) {
  const { actions, totals, daily, qualidade, period, label } = data;
  const q = (x) => (x ? `${x.media.toFixed(1)}/10 (${labelNota(x.media)}) - ${x.avaliacoes} avaliações` : 'Sem avaliações');

  const lines = [
    `RANKING ${label.toUpperCase()} - ${guildName.toUpperCase()}`,
    `Período: ${formatDateBR(period.start)} até ${formatDateBR(period.end)}`,
    `Gerado em: ${formatDateBR(getBrasiliaDate())}`,
    '',
    '--- RESUMO ---',
    `Aceitas: ${totals.aceitas} | Recusadas: ${totals.recusadas} | Análises: ${totals.analises}`,
    `Qualidade geral: ${q(qualidade.media ? { media: qualidade.media, avaliacoes: qualidade.avaliacoes } : null)}`,
    `Denúncias hoje: ${daily.total} | Reivindicadas: ${daily.reivindicadas} | Pendentes: ${daily.pendentes}`,
    '',
    '--- RANKING INDIVIDUAL ---',
    '===================================================='
  ];

  actions.forEach((a, i) => {
    lines.push(
      `${i + 1}º LUGAR: ${a.plainTag}`,
      `ID: ${a.userId}`,
      `Aceitas: ${a.aceitas}`,
      `Recusadas: ${a.recusadas}`,
      `Análises: ${a.analises}`,
      `Reivindicações: ${a.reivindicacoes}`,
      `Qualidade: ${q(a.qualidade)}`,
      '===================================================='
    );
  });

  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
    name: `ranking_${data.type}_${data.period.end.toISOString().slice(0, 10)}.txt`
  });
}

/* ------------------------------------------------------------------ */
/* Comando                                                             */
/* ------------------------------------------------------------------ */

// ctx abstrai a origem do comando (!rank ou /rank):
//   negar(texto)    -> resposta de erro
//   enviar(texto)   -> envia a mensagem do ranking e devolve a Message
//   editar(payload) -> edita a mensagem do ranking
//   apagar()        -> remove a mensagem do ranking
async function executarRank(ctx) {
  const { guild, userId } = ctx;

  try {
    if (!await canUse(ctx)) {
      return ctx.negar('❌ Apenas os cargos Administrador e Responsável Admin podem acessar o ranking.');
    }
  } catch (err) {
    console.error('[RANK] Erro ao verificar permissões:', err);
    return ctx.negar('❌ Não foi possível verificar sua permissão para acessar o ranking.');
  }

  const wait = onCooldown(userId);
  if (wait) {
    return ctx.negar(`⏳ Aguarde **${wait}s** para usar o ranking novamente.`);
  }

  let type = PERIODS[ctx.periodo] ? ctx.periodo : 'month';
  let page = 0;
  let data;

  const rankMsg = await ctx.enviar(`⏳ Gerando ranking **${PERIODS[type].label.toLowerCase()}**...`);

  try {
    data = await loadRank(guild, type);
  } catch (err) {
    console.error('[RANK] Erro ao gerar ranking:', err);
    return ctx.editar({ content: '❌ Erro ao gerar ranking. Tente novamente em instantes.' }).catch(() => null);
  }

  const expiresAt = Date.now() + CONFIG.lifetimeMs;
  const totalPages = () => Math.max(1, Math.ceil(data.actions.length / CONFIG.itemsPerPage));

  const view = () => ({
    content: '',
    embeds: [buildEmbed(data, page, totalPages(), expiresAt)],
    components: buildComponents(type, page, totalPages())
  });

  await ctx.editar(view());

  const collector = rankMsg.createMessageComponentCollector({ time: CONFIG.lifetimeMs });

  collector.on('collect', async (i) => {
    if (i.user.id !== userId) {
      return i.reply({
        content: '❌ Apenas quem usou o comando pode interagir.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      switch (i.customId) {
        case 'rank_export':
          return await i.reply({
            files: [buildTxt(data, guild.name)],
            flags: MessageFlags.Ephemeral
          });

        case 'rank_period':
          await i.deferUpdate();
          type = i.values[0];
          page = 0;
          data = await loadRank(guild, type);
          return await i.editReply(view());

        case 'rank_prev':
          page = Math.max(0, page - 1);
          break;

        case 'rank_next':
          page = Math.min(totalPages() - 1, page + 1);
          break;

        default:
          return;
      }

      await i.update(view());
    } catch (err) {
      console.error('[RANK] Erro na interação:', err);
    }
  });

  collector.on('end', () => {
    ctx.apagar().catch(() => null);
  });
}

async function handleRankCommand(message) {
  if (!message?.guild) return;

  const quiet = { allowedMentions: { repliedUser: false } };
  let rankMsg = null;

  return executarRank({
    guild: message.guild,
    member: message.member,
    userId: message.author.id,
    periodo: resolvePeriod((message.content.trim().split(/\s+/)[1] || '').toLowerCase()),
    negar: (content) => message.reply({ content, ...quiet }),
    enviar: async (content) => (rankMsg = await message.reply({ content, ...quiet })),
    editar: (payload) => rankMsg.edit(payload),
    apagar: () => rankMsg.delete()
  });
}

async function handleRankSlash(interaction) {
  return executarRank({
    guild: interaction.guild,
    member: interaction.member,
    userId: interaction.user.id,
    periodo: interaction.options.getString('periodo') || 'month',
    negar: (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }),
    enviar: async (content) => {
      await interaction.reply({ content });
      return interaction.fetchReply();
    },
    editar: (payload) => interaction.editReply(payload),
    apagar: () => interaction.deleteReply()
  });
}

module.exports = { handleRankCommand, handleRankSlash };