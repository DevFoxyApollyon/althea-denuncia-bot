// /Handlers/exportDenuncia.js


const { AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { PassThrough } = require('stream');

const EXPORT_CONSTANTS = {
  // Discord normalmente permite 50MB em alguns planos/servidores, mas margem evita erro.
  MAX_UPLOAD_BYTES: 45 * 1024 * 1024,
  COOLDOWN_SECONDS: 30,
  FILES_PER_MESSAGE: 10,
  TIMEZONE: 'America/Sao_Paulo',

  // Segurança / estabilidade
  FETCH_TIMEOUT_MS: 15000,
  MAX_TOTAL_DOWNLOAD_BYTES: 800 * 1024 * 1024, // 800MB por exportação (ajuste como quiser)
  MAX_SINGLE_DOWNLOAD_BYTES: 300 * 1024 * 1024, // proteção extra caso content-length falhe (300MB)
  AVATAR_SIZE: 64,
  GUILD_ICON_SIZE: 64,
};

const urlRegex = /(https?:\/\/[^\s]+)/g;

// cooldown real + anti-duplo clique
const cooldowns = new Map();   // userId -> expiresAt
const inProgress = new Map();  // userId -> true

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeFileName(name = '') {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function nowMs() {
  return Date.now();
}

function getHighestRole(member) {
  if (!member) return { name: '', color: '#99aab5' };
  const highestRole = member.roles.cache
    .filter(role => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .first();

  return {
    name: highestRole ? highestRole.name : '',
    color:
      highestRole && highestRole.color !== 0
        ? '#' + highestRole.color.toString(16).padStart(6, '0')
        : '#99aab5',
  };
}

function fetchWithTimeout(url, timeout = EXPORT_CONSTANTS.FETCH_TIMEOUT_MS) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
  ]);
}

/**
 * Busca TODAS as mensagens do tópico (paginação)
 */
async function fetchAllThreadMessages(thread) {
  const all = [];
  let lastId = undefined;

  while (true) {
    const batch = await thread.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (!batch || batch.size === 0) break;

    const values = Array.from(batch.values());
    all.push(...values);

    // id menor (mais antigo) para paginar
    lastId = values[values.length - 1].id;

    // Se veio menos que 100, acabou
    if (batch.size < 100) break;
  }

  // ordenar por timestamp crescente
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return all;
}

/**
 * ZIP builder robusto via stream
 */
async function buildZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks = [];

    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    archive.on('warning', (err) => {
      // warnings não necessariamente quebram, mas loga
      console.warn('[ZIP WARNING]', err?.message || err);
    });
    archive.on('error', reject);

    archive.pipe(stream);

    for (const f of files) {
      archive.append(f.content, { name: f.name });
    }

    archive.finalize();
  });
}

/**
 * Divide recursivamente uma lista de arquivos até que cada zip final fique <= MAX_UPLOAD_BYTES.
 * Isso resolve o problema "estimei pelo size bruto e o zip final passou".
 */
async function splitFilesIntoZipParts(files, maxBytes) {
  // Caso vazio
  if (!files.length) return [];

  // Tenta zipar tudo
  const buffer = await buildZipBuffer(files);
  if (buffer.length <= maxBytes) {
    return [{ buffer, filesCount: files.length }];
  }

  // Se for 1 arquivo e ainda assim estoura, não tem como mandar pelo Discord.
  // Aqui a gente devolve como "oversize" para você decidir o que fazer (pular ou só link no HTML).
  if (files.length === 1) {
    return [{ buffer, filesCount: 1, oversize: true }];
  }

  // Divide ao meio e repete
  const mid = Math.floor(files.length / 2);
  const left = files.slice(0, mid);
  const right = files.slice(mid);

  const leftParts = await splitFilesIntoZipParts(left, maxBytes);
  const rightParts = await splitFilesIntoZipParts(right, maxBytes);
  return [...leftParts, ...rightParts];
}

function makeStatusMeta(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'aceita') {
    return { label: 'ACEITA', color: '#43B581', bg: 'rgba(67, 181, 129, 0.12)' };
  }
  if (s === 'recusada') {
    return { label: 'RECUSADA', color: '#F04747', bg: 'rgba(240, 71, 71, 0.12)' };
  }
  return { label: (status || 'PENDENTE').toUpperCase(), color: '#99AAB5', bg: 'rgba(153, 170, 181, 0.12)' };
}

/**
 * Gera HTML base (preview ou arquivado), com escape anti-XSS.
 * - useRelativePaths: true => ./anexos/arquivo.ext
 * - useRelativePaths: false => links originais do Discord CDN
 */
async function generateBaseHtml(thread, denunciaData, executor, useRelativePaths, preparedMaps) {
  const guild = thread.guild;
  const guildIconURL =
    guild.iconURL({ extension: 'png', size: EXPORT_CONSTANTS.GUILD_ICON_SIZE }) ||
    'https://discord.com/assets/2c21aee128c70415a761e1b7c3d052a4.png';

  const guildName = escapeHtml(thread.name);

  // Mensagens (já paginadas e ordenadas)
  const sortedMessages = preparedMaps?.sortedMessages || (await fetchAllThreadMessages(thread));

  const motivoHtml = denunciaData.motivo
    ? `<p>Motivo da Denúncia: <strong>${escapeHtml(denunciaData.motivo)}</strong></p>`
    : '';

  let provasHtml = '';
  if (denunciaData.provas) {
    const provasList = String(denunciaData.provas)
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    if (provasList.length > 0) {
      provasHtml = `<p>Provas (Links):</p><ul>`;
      for (const provaRaw of provasList) {
        const prova = escapeHtml(provaRaw);
        const lowered = provaRaw.trim().toLowerCase();

        if (lowered === 'tópico' || lowered === 'topico') {
          provasHtml += `<li>${prova}</li>`;
        } else {
          const m = provaRaw.match(urlRegex);
          const link = m ? m[0] : provaRaw;
          // link vai no href sem escape, mas você pode proteger:
          const safeHref = String(link).replace(/"/g, '%22');
          provasHtml += `<li><a href="${safeHref}" target="_blank" rel="noopener noreferrer">${prova}</a></li>`;
        }
      }
      provasHtml += `</ul>`;
    }
  }

  let motivoAceiteHtml = '';
  if (String(denunciaData.status).toLowerCase() === 'aceita' && denunciaData.motivoAceite) {
    motivoAceiteHtml = `<p style="margin-top: 10px;">Motivo do Aceite (Staff): <strong>${escapeHtml(
      denunciaData.motivoAceite
    )}</strong></p>`;
  }

  const statusMeta = makeStatusMeta(denunciaData.status);

  const finalizationStatusHtml = `
    <p>Status na Finalização:
      <span class="status-finalizacao" style="color: ${statusMeta.color}; background-color: ${statusMeta.bg};">
        ${escapeHtml(statusMeta.label)}
      </span>
    </p>`;

  // Mapeamentos para nomes únicos (evita sobrescrita no zip)
  const avatarNameByUserId = preparedMaps?.avatarNameByUserId || new Map();
  const attachmentNameByUrl = preparedMaps?.attachmentNameByUrl || new Map();

  let htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Registro de Denúncia #${escapeHtml(String(denunciaData.messageId))} | ${guildName}</title>
  <style>
    :root {
      --bg-primary: #36393f;
      --bg-secondary: #2f3136;
      --text-normal: #dcddde;
      --text-muted: #72767d;
      --link-color: #00AFF4;
      --user-denunciante: #5865f2;
      --user-bot: #7289DA;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif, 'Noto Sans';
      background-color: var(--bg-primary);
      color: var(--text-normal);
      padding: 0; margin: 0;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 20px; }
    .header {
      background-color: var(--bg-secondary);
      padding: 20px;
      border-radius: 4px;
      margin-bottom: 25px;
      border-left: 4px solid ${statusMeta.color};
      box-shadow: 0 2px 10px 0 rgba(0,0,0,0.2);
    }
    .header h1 {
      font-size: 1.5em; font-weight: 700; color: #fff;
      margin: 0 0 5px 0; padding-bottom: 10px;
      border-bottom: 1px solid #4f545c;
    }
    .server-info { display: flex; align-items: center; margin-bottom: 15px; padding-bottom: 10px; }
    .server-logo { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; }
    .server-name { font-size: 1.1em; font-weight: 500; color: var(--text-muted); }
    .header p { margin: 5px 0; line-height: 1.6; }
    .header ul { list-style-type: disc; margin-left: 20px; padding-left: 0; }
    .header li { margin: 3px 0; }
    .status-finalizacao { font-weight: 700; padding: 2px 6px; border-radius: 3px; }
    .header code { background-color: rgba(32,34,37,0.7); padding: 2px 4px; border-radius: 3px; font-size: 0.85em; }

    h2 {
      font-size: 1.2em; color: #fff;
      margin-top: 20px; margin-bottom: 15px;
      padding-bottom: 5px; border-bottom: 1px solid var(--bg-secondary);
    }

    .message { display: flex; padding: 10px 0; border-top: 1px solid #202225; }
    .message:first-child { border-top: none; }
    .avatar-col { width: 56px; flex-shrink: 0; padding-top: 3px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; }
    .content-col { flex-grow: 1; min-width: 0; }
    .message-header { display: flex; align-items: center; margin-bottom: 5px; line-height: 1.2; flex-wrap: wrap; }
    .username { font-weight: 600; font-size: 1em; margin-right: 8px; }
    .timestamp { font-size: 0.7em; color: var(--text-muted); margin-left: 8px; white-space: nowrap; }
    .user-role {
      font-size: 0.7em; font-weight: 800;
      padding: 2px 4px; border-radius: 3px;
      margin-left: 5px; text-transform: uppercase; color: #fff !important;
    }
    .content-block {
      padding: 0; margin: 0;
      font-size: 0.9em; white-space: pre-wrap;
      word-wrap: break-word; line-height: 1.4;
    }
    img, video { max-width: 100%; max-height: 350px; height: auto; display: block; margin-top: 8px; border-radius: 4px; }
    .attachment, .embed {
      margin-top: 8px; background-color: #202225;
      border-radius: 4px; padding: 10px;
      border-left: 4px solid #72767d; max-width: 500px;
    }
    .attachment p { margin: 0; }
    .embed h3, .embed h4 { margin: 0 0 5px 0; }
    .embed p { margin-top: 0; font-size: 0.9em; }
    a { color: var(--link-color); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="server-info">
      <img class="server-logo" src="${guildIconURL}" alt="Logo do Servidor">
      <span class="server-name">${guildName}</span>
    </div>
    <h1>Registro de Denúncia Arquivada</h1>
    <p>ID da Denúncia: <code>${escapeHtml(String(denunciaData.messageId))}</code></p>
    <p>Criada Por: ${escapeHtml(String(denunciaData.denunciante))} (ID: <code>${escapeHtml(String(denunciaData.criadoPor))}</code>)</p>
    <p>Acusado: ${escapeHtml(String(denunciaData.acusado))}</p>
    ${motivoHtml}
    ${provasHtml}
    <hr style="border-top: 1px solid #4f545c; margin: 10px 0;">
    ${finalizationStatusHtml}
    ${motivoAceiteHtml}
    <p>Finalizada Por: ${escapeHtml(executor.tag)}</p>
  </div>
  <h2>Mensagens do Tópico (${escapeHtml(thread.name)})</h2>
`;

  for (const msg of sortedMessages) {
    if (msg.id === thread.parentMessageId) continue;

    let member = null;
    try {
      member = await thread.guild.members.fetch(msg.author.id).catch(() => null);
    } catch (_) {}

    // avatar local no html arquivado, ou URL no preview
    const avatarFileName = avatarNameByUserId.get(msg.author.id) || `avatar_${msg.author.id}.png`;
    const avatarURL = msg.author.displayAvatarURL({ extension: 'png', size: EXPORT_CONSTANTS.AVATAR_SIZE });
    const avatarSrc = useRelativePaths ? `./anexos/${avatarFileName}` : avatarURL;

    const timestamp = msg.createdAt.toLocaleString('pt-BR', { timeZone: EXPORT_CONSTANTS.TIMEZONE });
    const displayUsername = escapeHtml(member ? member.displayName : msg.author.tag);

    const { name: roleName, color: roleColor } = getHighestRole(member);

    // conteúdo com escape + auto-link
    let content = escapeHtml(msg.content || '');
    content = content.replace(urlRegex, (url) => {
      const safeHref = String(url).replace(/"/g, '%22');
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    });

    let usernameStyle = member && member.displayColor !== 0 ? `color: #${member.displayColor.toString(16).padStart(6, '0')};` : '';
    let usernameClass = '';

    if (msg.author.id === String(denunciaData.criadoPor)) {
      usernameStyle = 'color: var(--user-denunciante);';
      usernameClass = 'denunciante-user';
    } else if (msg.author.bot) {
      usernameStyle = 'color: var(--user-bot);';
      usernameClass = 'bot-user';
    }

    let attachmentsHtml = '';
    if (msg.attachments?.size > 0) {
      msg.attachments.forEach((attachment) => {
        const originalUrl = attachment.url;
        const uniqueName = attachmentNameByUrl.get(originalUrl) || safeFileName(attachment.name || 'arquivo');
        const mediaPath = useRelativePaths ? `./anexos/${uniqueName}` : originalUrl;

        const safeName = escapeHtml(uniqueName);
        const safeHref = String(mediaPath).replace(/"/g, '%22');

        attachmentsHtml += `<div class="attachment">
  <p>Arquivo: <a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeName}</a></p>
  ${attachment.contentType && attachment.contentType.startsWith('image/') ? `<img src="${safeHref}" alt="Imagem">` : ''}
  ${attachment.contentType && attachment.contentType.startsWith('video/') ? `<video controls src="${safeHref}"></video>` : ''}
</div>`;
      });
    }

    let embedsHtml = '';
    if (msg.embeds?.length > 0) {
      msg.embeds.forEach((embed) => {
        const embedColor = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#72767d';
        const title = escapeHtml(embed.title || 'Embed');
        const desc = escapeHtml(embed.description || '');

        let fieldsHtml = '';
        if (embed.fields?.length) {
          fieldsHtml = embed.fields
            .map((field) => `<strong>${escapeHtml(field.name)}:</strong> ${escapeHtml(field.value)}<br>`)
            .join('');
        }

        const embedImg = embed.image?.url
          ? `<img src="${String(embed.image.url).replace(/"/g, '%22')}" alt="Embed Image">`
          : '';

        const authorName = embed.author?.name ? `<h4>${escapeHtml(embed.author.name)}</h4>` : '';

        embedsHtml += `
<div class="embed" style="border-left-color: ${embedColor}">
  ${authorName}
  <h3>${title}</h3>
  <p>${desc}</p>
  ${embedImg}
  ${fieldsHtml}
</div>`;
      });
    }

    const contentBlock = content.trim() !== '' ? `<div class="content-block">${content}</div>` : '';

    htmlContent += `
<div class="message">
  <div class="avatar-col">
    <img class="avatar" src="${avatarSrc}" alt="Avatar de ${displayUsername}">
  </div>
  <div class="content-col">
    <div class="message-header">
      <span class="username ${usernameClass}" style="${usernameStyle}">${displayUsername}</span>
      ${roleName ? `<span class="user-role" style="background-color: ${roleColor};">${escapeHtml(roleName)}</span>` : ''}
      <span class="timestamp">${escapeHtml(timestamp)}</span>
    </div>
    ${contentBlock}
    ${attachmentsHtml}
    ${embedsHtml}
  </div>
</div>`;
  }

  htmlContent += `
</div>
</body>
</html>`;

  return { htmlContent, sortedMessages };
}

async function createHtmlArchivedTranscript(thread, denunciaData, executor, preparedMaps) {
  return generateBaseHtml(thread, denunciaData, executor, true, preparedMaps);
}
async function createHtmlPreviewTranscript(thread, denunciaData, executor, preparedMaps) {
  return generateBaseHtml(thread, denunciaData, executor, false, preparedMaps);
}

async function handleExportButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;

  // anti-duplo clique enquanto processa
  if (inProgress.get(userId)) {
    return interaction.editReply({
      content: `⏳ Já estou exportando uma denúncia para você. Aguarde finalizar.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // cooldown real
  const now = nowMs();
  const expiresAt = cooldowns.get(userId);
  if (expiresAt && expiresAt > now) {
    const seconds = Math.ceil((expiresAt - now) / 1000);
    return interaction.editReply({
      content: `⏳ Por favor, espere **${seconds}s** para usar o botão novamente.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // marca processando
  inProgress.set(userId, true);

  try {
    if (!interaction.channel.isThread()) {
      return interaction.editReply({
        content: '❌ Este comando só pode ser usado dentro do tópico de uma denúncia.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = interaction.guild;
    const config = await Config.findOne({ guildId: guild.id });

    if (!config) {
      return interaction.editReply({
        content: '❌ Configurações do servidor não encontradas.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const requiredRoleId = config.roles?.responsavel_admin;
    if (!requiredRoleId || !interaction.member.roles.cache.has(requiredRoleId)) {
      return interaction.editReply({
        content: `❌ Você não tem permissão para usar este botão. Apenas membros com o cargo de responsável (${requiredRoleId ? `<@&${requiredRoleId}>` : 'ID não configurado'}) podem finalizar e exportar denúncias.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const thread = interaction.channel;
    const denuncia = await Denuncia.findOne({ threadId: thread.id });

    if (!denuncia) {
      return interaction.editReply({
        content: '❌ Denúncia não encontrada no banco de dados.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // nome base seguro
    const baseFileName = safeFileName(`denuncia_${denuncia.messageId}_${denuncia.acusado}`);

    // Busca TODAS mensagens
    const sortedMessages = await fetchAllThreadMessages(thread);

    // Preparar mapas de nomes únicos (anexos e avatares) antes de gerar HTML
    const avatarNameByUserId = new Map();
    const attachmentNameByUrl = new Map();

    // 1) Anexos (nomes únicos)
    for (const msg of sortedMessages) {
      for (const attachment of msg.attachments.values()) {
        const originalUrl = attachment.url;
        if (!attachmentNameByUrl.has(originalUrl)) {
          const originalName = attachment.name || 'arquivo';
          const unique = safeFileName(`${msg.id}_${attachment.id}_${originalName}`);
          attachmentNameByUrl.set(originalUrl, unique);
        }
      }
      // 2) Avatares (um por usuário)
      if (!avatarNameByUserId.has(msg.author.id)) {
        avatarNameByUserId.set(msg.author.id, safeFileName(`avatar_${msg.author.id}.png`));
      }
    }

    const preparedMaps = { sortedMessages, avatarNameByUserId, attachmentNameByUrl };

    // HTMLs
    const { htmlContent: zipHtmlContent } = await createHtmlArchivedTranscript(thread, denuncia, interaction.user, preparedMaps);
    const { htmlContent: previewHtmlContent } = await createHtmlPreviewTranscript(thread, denuncia, interaction.user, preparedMaps);

    // Coletar downloads priorizando ANEXOS, depois AVATARES (pra não gastar limite à toa)
    const attachmentsToDownload = [];
    const avatarsToDownload = [];

    for (const msg of sortedMessages) {
      // anexos
      for (const attachment of msg.attachments.values()) {
        const uniqueName = attachmentNameByUrl.get(attachment.url);
        attachmentsToDownload.push({
          url: attachment.url,
          filename: `anexos/${uniqueName}`,
          kind: 'attachment',
        });
      }
    }

    // avatares (1 por user)
    for (const [uid, avatarName] of avatarNameByUserId.entries()) {
      // pega um usuário de referência (da última msg, etc). Aqui basta usar interaction.client.users.fetch.
      const user = await interaction.client.users.fetch(uid).catch(() => null);
      if (!user) continue;

      const avatarURL = user.displayAvatarURL({ extension: 'png', size: EXPORT_CONSTANTS.AVATAR_SIZE });
      avatarsToDownload.push({
        url: avatarURL,
        filename: `anexos/${avatarName}`,
        kind: 'avatar',
      });
    }

    // Primeiro arquivo HTML do zip
    const zipFiles = [
      { name: `${baseFileName}.html`, content: Buffer.from(zipHtmlContent, 'utf8') },
    ];

    // Baixar anexos com limite total
    let downloadedBytes = 0;
    let skippedLargeCount = 0;
    let skippedByBudgetCount = 0;
    let downloadErrors = 0;

    async function downloadAndPush(item) {
      if (downloadedBytes >= EXPORT_CONSTANTS.MAX_TOTAL_DOWNLOAD_BYTES) {
        skippedByBudgetCount++;
        return;
      }

      let res;
      try {
        res = await fetchWithTimeout(item.url);
      } catch (e) {
        downloadErrors++;
        console.error('[DOWNLOAD_ERROR]', item.filename, e.message);
        return;
      }

      if (!res?.ok) {
        downloadErrors++;
        console.warn('[WARN] Falha ao baixar', item.filename, 'Status:', res?.status);
        return;
      }

      // tenta pular arquivos grandes via content-length
      const len = Number(res.headers.get('content-length') || 0);
      if (len && len > EXPORT_CONSTANTS.MAX_UPLOAD_BYTES) {
        // Se o arquivo é maior que o que dá pra anexar de qualquer jeito,
        // ainda pode valer salvar no zip (pois o zip será dividido),
        // mas vídeos enormes podem matar RAM. Aqui fazemos regra: se for MUITO grande, pula.
        if (len > EXPORT_CONSTANTS.MAX_SINGLE_DOWNLOAD_BYTES) {
          skippedLargeCount++;
          return;
        }
      }

      const buf = await res.buffer();

      if (buf.length > EXPORT_CONSTANTS.MAX_SINGLE_DOWNLOAD_BYTES) {
        skippedLargeCount++;
        return;
      }

      if (downloadedBytes + buf.length > EXPORT_CONSTANTS.MAX_TOTAL_DOWNLOAD_BYTES) {
        skippedByBudgetCount++;
        return;
      }

      downloadedBytes += buf.length;
      zipFiles.push({ name: item.filename, content: buf });
    }

    // 1) anexos
    for (const item of attachmentsToDownload) {
      await downloadAndPush(item);
    }

    // 2) avatares (somente se sobrar orçamento)
    for (const item of avatarsToDownload) {
      await downloadAndPush(item);
    }

    // Agora dividir em zips garantindo o tamanho REAL do zip <= limite
    const zipParts = await splitFilesIntoZipParts(zipFiles, EXPORT_CONSTANTS.MAX_UPLOAD_BYTES);

    // Se algum zipPart ficou oversize (1 arquivo impossivel), a gente remove esse arquivo e segue.
    // (Mantém como link no HTML, mas o arquivo não entra no zip).
    const finalZipParts = [];
    let oversizeCount = 0;

    for (const part of zipParts) {
      if (part.oversize) {
        oversizeCount++;
        continue;
      }
      finalZipParts.push(part);
    }

    const zipAttachments = finalZipParts.map((part, idx) => {
      return new AttachmentBuilder(part.buffer, {
        name: `${baseFileName}_ARQUIVADO_PARTE_${idx + 1}.zip`,
      });
    });

    const htmlAttachment = new AttachmentBuilder(Buffer.from(previewHtmlContent, 'utf8'), {
      name: `${baseFileName}_PREVIEW.html`,
    });

    const statusMeta = makeStatusMeta(denuncia.status);
    const statusLabel = statusMeta.label;

    const zipCount = zipAttachments.length;
    const totalLogBatches = Math.ceil(zipCount / EXPORT_CONSTANTS.FILES_PER_MESSAGE);

    // Avisos para staff (quando pulou coisa)
    const warnings = [];
    if (skippedLargeCount > 0) warnings.push(`• ${skippedLargeCount} arquivo(s) foram ignorados por serem grandes demais/arriscados.`);
    if (skippedByBudgetCount > 0) warnings.push(`• ${skippedByBudgetCount} arquivo(s) foram ignorados por limite total de download (orçamento).`);
    if (downloadErrors > 0) warnings.push(`• ${downloadErrors} arquivo(s) falharam ao baixar (timeout/erro).`);
    if (oversizeCount > 0) warnings.push(`• ${oversizeCount} item(ns) não puderam ser anexados por exceder o limite mesmo sozinho.`);

    const warningText = warnings.length ? `\n\n⚠️ **Avisos:**\n${warnings.join('\n')}` : '';

    const logEmbed = new EmbedBuilder()
      .setColor(statusMeta.color)
      .setTitle(`📦 Arquivamento de Denúncia - Finalizada`)
      .setDescription(
        `**STATUS:** ${statusLabel}\n\n` +
        `**MENSAGEM 1 DE MÚLTIPLAS (PROVAS PERMANENTES):** ${zipCount} arquivo(s) ZIP (máx. ~45MB cada).` +
        warningText
      )
      .setThumbnail(guild.iconURL({ extension: 'png', size: EXPORT_CONSTANTS.GUILD_ICON_SIZE }))
      .setFooter({ text: `ID da Denúncia: ${denuncia.messageId} | Arquivado por: ${interaction.user.tag}` });

    const fields = [
      { name: 'Denunciante', value: String(denuncia.denunciante || 'N/A'), inline: true },
      { name: 'Acusado', value: String(denuncia.acusado || 'N/A'), inline: true },
      { name: 'Tópico Original', value: `<#${thread.id}>`, inline: true },
      { name: 'Motivo', value: String(denuncia.motivo || 'N/A'), inline: false },
      { name: 'Link de Pré-visualização Rápida', value: 'Aguarde... (Próxima Mensagem)', inline: false },
    ];

    if (String(denuncia.status).toLowerCase() === 'aceita' && denuncia.motivoAceite) {
      fields.push({ name: 'Motivo da Aceitação (Staff)', value: String(denuncia.motivoAceite), inline: false });
    } else if (String(denuncia.status).toLowerCase() === 'recusada') {
      fields.push({ name: 'Motivo da Recusa (Staff)', value: String(denuncia.motivoRecusa || 'Não registrado'), inline: false });
    }

    logEmbed.addFields(fields);

    const logsChannelId = config.channels?.log;
    const logsChannel = logsChannelId ? interaction.client.channels.cache.get(logsChannelId) : null;

    let logMessage = null;

    if (logsChannel) {
      const initialZipBatch = zipAttachments.slice(0, EXPORT_CONSTANTS.FILES_PER_MESSAGE);

      logMessage = await logsChannel.send({
        content: `**[ARQUIVAMENTO - PROVAS PERMANENTES: PARTE 1 DE ${totalLogBatches}]**`,
        embeds: [logEmbed],
        files: initialZipBatch,
      });

      for (let i = EXPORT_CONSTANTS.FILES_PER_MESSAGE; i < zipAttachments.length; i += EXPORT_CONSTANTS.FILES_PER_MESSAGE) {
        const nextBatch = zipAttachments.slice(i, i + EXPORT_CONSTANTS.FILES_PER_MESSAGE);
        await logsChannel.send({
          content: `**[ARQUIVAMENTO - PROVAS PERMANENTES: PARTE ${Math.floor(i / EXPORT_CONSTANTS.FILES_PER_MESSAGE) + 2} DE ${totalLogBatches}]**`,
          files: nextBatch,
        });
      }

      const previewMessage = await logsChannel.send({
        content: `**[PRÉ-VISUALIZAÇÃO]** ${thread.name} - Arquivo HTML solto.`,
        files: [htmlAttachment],
      });

      const previewLink = previewMessage.url;

      // Atualiza o campo de preview
      logEmbed.spliceFields(
        fields.findIndex(f => f.name === 'Link de Pré-visualização Rápida'),
        1,
        { name: 'Link de Pré-visualização Rápida (HTML)', value: `[Clique Aqui - Mídia Original](${previewLink})`, inline: false }
      );

      await logMessage.edit({ embeds: [logEmbed] });

      await interaction.editReply({
        content: `✅ Denúncia exportada e arquivada em **${zipCount}** arquivo(s) ZIP. O tópico foi trancado e arquivado.\n\n🔗 **Link do Log Principal:** [Clique Aqui](${logMessage.url})`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // fallback DM staff
      try {
        logMessage = await interaction.user.send({
          content: `⚠️ **Aviso:** O canal de logs não foi encontrado. A exportação (ZIPs e HTML) foi enviada por DM.`,
          embeds: [logEmbed],
          files: [...zipAttachments, htmlAttachment].slice(0, 10), // proteção: dm também tem limite
        });

        await interaction.editReply({
          content: `✅ Denúncia exportada e arquivada. O **canal de logs não foi encontrado**, os arquivos foram enviados para sua DM.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (dmError) {
        console.error('Erro ao enviar log por DM:', dmError);
        await interaction.editReply({
          content: `❌ **O canal de logs e sua DM falharam.** Não foi possível salvar os arquivos.`,
          flags: MessageFlags.Ephemeral,
        });
        logMessage = null;
      }
    }

    // DM para denunciante (somente preview, que é leve)
    const denunciante = await interaction.client.users.fetch(String(denuncia.criadoPor)).catch(() => null);
    if (denunciante) {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(statusMeta.color)
          .setTitle(`📢 Denúncia Arquivada - Status: ${statusLabel}`)
          .setDescription(`Sua denúncia sobre **${denuncia.acusado}** no servidor **${guild.name}** foi finalizada pela equipe de moderação.`)
          .addFields(
            { name: 'Motivo Registrado', value: String(denuncia.motivo || 'N/A'), inline: false },
            { name: 'Documentação', value: 'O histórico de conversas está no arquivo HTML anexo (links de mídia originais incluídos).', inline: false }
          )
          .setTimestamp();

        await denunciante.send({
          embeds: [dmEmbed],
          files: [htmlAttachment],
        });
      } catch (dmError) {
        await interaction.followUp({
          content: `⚠️ Aviso: Não foi possível enviar a DM para o denunciante. Motivo: **${dmError.code === 50007 ? 'O usuário bloqueou o bot ou desativou as DMs.' : 'Erro de conexão/API.'}** O staff tem acesso total aos arquivos no canal de logs.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Salvar histórico no banco se logMessage existe
    if (logMessage) {
      await Denuncia.updateOne(
        { _id: denuncia._id },
        {
          logMessageId: logMessage.id,
          historico: [
            ...(denuncia.historico || []),
            {
              acao: 'EXPORTADA_MULTIPLOS_ZIP_E_HTML',
              staffId: interaction.user.id,
              data: new Date(),
              detalhes: {
                messageLink: logMessage.url,
                zipCount: zipAttachments.length,
                downloadedBytes,
                skippedLargeCount,
                skippedByBudgetCount,
                downloadErrors,
                oversizeCount,
              },
            },
          ],
        }
      );
    }

    // Mensagem final no tópico
    try {
      await thread.send({
        content:
          `**🚨 Denúncia Finalizada e Arquivada.**\n\n` +
          `Caso precise de reanálise ou queira recorrer da decisão, por favor, abra um **NOVO TICKET** no canal de suporte. ` +
          `Este tópico será trancado.`,
      });
    } catch (error) {
      console.error('Erro ao enviar mensagem de finalização no tópico:', error);
    }

    // Trancar e arquivar
    if (thread.manageable) {
      await thread.setLocked(true, 'Denúncia finalizada e exportada.');
      await thread.setArchived(true, 'Denúncia finalizada e exportada.');
    }

    // seta cooldown depois de concluir (cooldown real)
    cooldowns.set(userId, nowMs() + EXPORT_CONSTANTS.COOLDOWN_SECONDS * 1000);
  } catch (error) {
    console.error('Erro fatal ao exportar denúncia:', error);

    const errorMessage =
      `❌ Ocorreu um erro fatal ao exportar a denúncia. O arquivamento pode não ter sido concluído.\n` +
      `Detalhes: \`\`\`${String(error?.message || error).substring(0, 1500)}\`\`\``;

    await interaction.editReply({
      content: errorMessage,
      flags: MessageFlags.Ephemeral,
    });

    // mesmo com erro, aplica cooldown curto pra evitar spam de erro
    cooldowns.set(userId, nowMs() + 10 * 1000);
  } finally {
    inProgress.delete(userId);
  }
}

module.exports = { handleExportButton };
