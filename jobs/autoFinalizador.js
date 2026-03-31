const chalk = require('chalk');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { getBrasiliaDate } = require('../utils/dateUtils');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { PassThrough } = require('stream');

const log = {
    info:    (msg, meta = {}) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[INFO]')} [${meta.guildName || ''}] ${msg}`),
    success: (msg, meta = {}) => console.log(`${chalk.green('✔')} ${chalk.gray('[SUCESSO]')} [${meta.guildName || ''}] ${msg}`),
    warn:    (msg, meta = {}) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[AVISO]')} [${meta.guildName || ''}] ${msg}`),
    error:   (msg, meta = {}) => console.log(`${chalk.red('✖')} ${chalk.gray('[ERRO]')} [${meta.guildName || ''}] ${msg}`),
    system:  (msg, meta = {}) => console.log(`${chalk.magenta('⚙')} ${chalk.gray('[SISTEMA]')} [${meta.guildName || ''}] ${msg}`),
};

const DIAS_PARA_FINALIZAR = 15;
const INTERVALO_VERIFICACAO_MS = 1 * 60 * 1000;
const LOTE_MAXIMO = 10;
const DELAY_ENTRE_ITENS_MS = 30000;
const STATUS_FINALIZAVEIS = ['pendente', 'analise', 'reivindicacao'];

const EXPORT = {
    MAX_UPLOAD_BYTES: 45 * 1024 * 1024,
    FILES_PER_MESSAGE: 10,
    TIMEZONE: 'America/Sao_Paulo',
    FETCH_TIMEOUT_MS: 15000,
    MAX_TOTAL_DOWNLOAD_BYTES: 800 * 1024 * 1024,
    MAX_SINGLE_DOWNLOAD_BYTES: 300 * 1024 * 1024,
    AVATAR_SIZE: 64,
    GUILD_ICON_SIZE: 64,
};

const urlRegex = /(https?:\/\/[^\s]+)/g;

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
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

function getHighestRole(member) {
    if (!member) return { name: '', color: '#99aab5' };
    const highestRole = member.roles.cache
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .first();
    return {
        name: highestRole ? highestRole.name : '',
        color: highestRole && highestRole.color !== 0
            ? '#' + highestRole.color.toString(16).padStart(6, '0')
            : '#99aab5',
    };
}

async function fetchWithTimeout(url, timeout = EXPORT.FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Timeout após ${timeout}ms`);
        }
        throw error;
    }
}
function isValidUrl(str) {
    try {
        const url = new URL(str);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function makeStatusMeta(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'aceita') return { label: 'ACEITA', color: '#43B581', bg: 'rgba(67,181,129,0.12)' };
    if (s === 'recusada') return { label: 'RECUSADA', color: '#F04747', bg: 'rgba(240,71,71,0.12)' };
    return { label: (status || 'PENDENTE').toUpperCase(), color: '#99AAB5', bg: 'rgba(153,170,181,0.12)' };
}

async function fetchAllThreadMessages(thread) {
    const all = [];
    let lastId = undefined;
    while (true) {
        const batch = await thread.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
        if (!batch || batch.size === 0) break;
        const values = Array.from(batch.values());
        all.push(...values);
        lastId = values[values.length - 1].id;
        if (batch.size < 100) break;
    }
    all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    return all;
}

async function buildZipBuffer(files) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const stream = new PassThrough();
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
        archive.on('error', reject);
        archive.pipe(stream);
        for (const f of files) archive.append(f.content, { name: f.name });
        archive.finalize();
    });
}

async function splitFilesIntoZipParts(files, maxBytes) {
    if (!files.length) return [];
    const buffer = await buildZipBuffer(files);
    if (buffer.length <= maxBytes) return [{ buffer, filesCount: files.length }];
    if (files.length === 1) return [{ buffer, filesCount: 1, oversize: true }];
    const mid = Math.floor(files.length / 2);
    const leftParts = await splitFilesIntoZipParts(files.slice(0, mid), maxBytes);
    const rightParts = await splitFilesIntoZipParts(files.slice(mid), maxBytes);
    return [...leftParts, ...rightParts];
}

async function generateHtml(thread, denunciaData, executorTag, useRelativePaths, preparedMaps) {
    const guild = thread.guild;
    const guildIconURL = guild.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || '';
    const guildName = escapeHtml(thread.name);
    const sortedMessages = preparedMaps?.sortedMessages || (await fetchAllThreadMessages(thread));
    const statusMeta = makeStatusMeta(denunciaData.status);

    const motivoHtml = denunciaData.motivo
        ? `<p>Motivo da Denuncia: <strong>${escapeHtml(denunciaData.motivo)}</strong></p>` : '';

    let provasHtml = '';
    if (denunciaData.provas) {
        const provasList = String(denunciaData.provas).split('\n').map(s => s.trim()).filter(Boolean);
        if (provasList.length > 0) {
            provasHtml = `<p>Provas (Links):</p><ul>`;
            for (const provaRaw of provasList) {
                const prova = escapeHtml(provaRaw);
                const lower = provaRaw.trim().toLowerCase();
                if (lower === 'topico' || lower === 'topico') {
                    provasHtml += `<li>${prova}</li>`;
                } else {
                    const m = provaRaw.match(urlRegex);
                    const link = m ? m[0] : provaRaw;
                    provasHtml += `<li><a href="${String(link).replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${prova}</a></li>`;
                }
            }
            provasHtml += `</ul>`;
        }
    }

    const motivoAceiteHtml = String(denunciaData.status).toLowerCase() === 'aceita' && denunciaData.motivoAceite
        ? `<p>Motivo do Aceite (Staff): <strong>${escapeHtml(denunciaData.motivoAceite)}</strong></p>` : '';

    const avatarNameByUserId = preparedMaps?.avatarNameByUserId || new Map();
    const attachmentNameByUrl = preparedMaps?.attachmentNameByUrl || new Map();

    let htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Registro de Denuncia #${escapeHtml(String(denunciaData.messageId))} | ${guildName}</title>
<style>
:root{--bg-primary:#36393f;--bg-secondary:#2f3136;--text-normal:#dcddde;--text-muted:#72767d;--link-color:#00AFF4;--user-denunciante:#5865f2;--user-bot:#7289DA;}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background-color:var(--bg-primary);color:var(--text-normal);padding:0;margin:0;}
.container{max-width:960px;margin:0 auto;padding:20px;}
.header{background-color:var(--bg-secondary);padding:20px;border-radius:4px;margin-bottom:25px;border-left:4px solid ${statusMeta.color};}
.header h1{font-size:1.5em;font-weight:700;color:#fff;margin:0 0 5px 0;padding-bottom:10px;border-bottom:1px solid #4f545c;}
.server-info{display:flex;align-items:center;margin-bottom:15px;}
.server-logo{width:32px;height:32px;border-radius:50%;margin-right:10px;}
.header p{margin:5px 0;line-height:1.6;}
.header code{background-color:rgba(32,34,37,0.7);padding:2px 4px;border-radius:3px;font-size:0.85em;}
h2{font-size:1.2em;color:#fff;margin-top:20px;margin-bottom:15px;padding-bottom:5px;border-bottom:1px solid var(--bg-secondary);}
.message{display:flex;padding:10px 0;border-top:1px solid #202225;}
.avatar-col{width:56px;flex-shrink:0;padding-top:3px;}
.avatar{width:40px;height:40px;border-radius:50%;}
.content-col{flex-grow:1;min-width:0;}
.message-header{display:flex;align-items:center;margin-bottom:5px;flex-wrap:wrap;}
.username{font-weight:600;font-size:1em;margin-right:8px;}
.timestamp{font-size:0.7em;color:var(--text-muted);margin-left:8px;}
.user-role{font-size:0.7em;font-weight:800;padding:2px 4px;border-radius:3px;margin-left:5px;text-transform:uppercase;color:#fff !important;}
.content-block{font-size:0.9em;white-space:pre-wrap;word-wrap:break-word;line-height:1.4;}
img,video{max-width:100%;max-height:350px;height:auto;display:block;margin-top:8px;border-radius:4px;}
.attachment,.embed{margin-top:8px;background-color:#202225;border-radius:4px;padding:10px;border-left:4px solid #72767d;max-width:500px;}
a{color:var(--link-color);text-decoration:none;}
</style>
</head>
<body>
<div class="container">
<div class="header">
<div class="server-info"><img class="server-logo" src="${guildIconURL}" alt="Logo"><span>${guildName}</span></div>
<h1>Registro de Denuncia Arquivada</h1>
<p>ID da Denuncia: <code>${escapeHtml(String(denunciaData.messageId))}</code></p>
<p>Criada Por: ${escapeHtml(String(denunciaData.denunciante))} (ID: <code>${escapeHtml(String(denunciaData.criadoPor))}</code>)</p>
<p>Acusado: ${escapeHtml(String(denunciaData.acusado))}</p>
${motivoHtml}${provasHtml}
<hr style="border-top:1px solid #4f545c;margin:10px 0;">
<p>Status: <strong style="color:${statusMeta.color}">${escapeHtml(statusMeta.label)}</strong></p>
${motivoAceiteHtml}
<p>Finalizada Por: ${escapeHtml(executorTag)}</p>
</div>
<h2>Mensagens do Topico (${guildName})</h2>`;

    for (const msg of sortedMessages) {
        if (msg.id === thread.parentMessageId) continue;

        let member = null;
        try { member = await thread.guild.members.fetch(msg.author.id).catch(() => null); } catch (_) {}

        const avatarFileName = avatarNameByUserId.get(msg.author.id) || `avatar_${msg.author.id}.png`;
        const avatarURL = msg.author.displayAvatarURL({ extension: 'png', size: EXPORT.AVATAR_SIZE });
        const avatarSrc = useRelativePaths ? `./anexos/${avatarFileName}` : avatarURL;
        const timestamp = msg.createdAt.toLocaleString('pt-BR', { timeZone: EXPORT.TIMEZONE });
        const displayUsername = escapeHtml(member ? member.displayName : msg.author.tag);
        const { name: roleName, color: roleColor } = getHighestRole(member);

        let content = escapeHtml(msg.content || '');
        content = content.replace(urlRegex, (url) =>
            `<a href="${String(url).replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
        );

        let usernameStyle = member && member.displayColor !== 0 ? `color:#${member.displayColor.toString(16).padStart(6, '0')};` : '';
        if (msg.author.id === String(denunciaData.criadoPor)) usernameStyle = 'color:var(--user-denunciante);';
        else if (msg.author.bot) usernameStyle = 'color:var(--user-bot);';

        let attachmentsHtml = '';
        if (msg.attachments?.size > 0) {
            msg.attachments.forEach((attachment) => {
                const uniqueName = attachmentNameByUrl.get(attachment.url) || safeFileName(attachment.name || 'arquivo');
                const mediaPath = useRelativePaths ? `./anexos/${uniqueName}` : attachment.url;
                const safeHref = String(mediaPath).replace(/"/g, '%22');
                attachmentsHtml += `<div class="attachment">
<p>Arquivo: <a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(uniqueName)}</a></p>
${attachment.contentType?.startsWith('image/') ? `<img src="${safeHref}" alt="Imagem">` : ''}
${attachment.contentType?.startsWith('video/') ? `<video controls src="${safeHref}"></video>` : ''}
</div>`;
            });
        }

        let embedsHtml = '';
        if (msg.embeds?.length > 0) {
            msg.embeds.forEach((embed) => {
                const embedColor = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#72767d';
                const fieldsHtml = (embed.fields || []).map(f => `<strong>${escapeHtml(f.name)}:</strong> ${escapeHtml(f.value)}<br>`).join('');
                const embedImg = embed.image?.url ? `<img src="${String(embed.image.url).replace(/"/g, '%22')}" alt="Embed Image">` : '';
                embedsHtml += `<div class="embed" style="border-left-color:${embedColor}">
${embed.author?.name ? `<h4>${escapeHtml(embed.author.name)}</h4>` : ''}
<h3>${escapeHtml(embed.title || 'Embed')}</h3>
<p>${escapeHtml(embed.description || '')}</p>
${embedImg}${fieldsHtml}
</div>`;
            });
        }

        htmlContent += `
<div class="message">
<div class="avatar-col"><img class="avatar" src="${avatarSrc}" alt="Avatar"></div>
<div class="content-col">
<div class="message-header">
<span class="username" style="${usernameStyle}">${displayUsername}</span>
${roleName ? `<span class="user-role" style="background-color:${roleColor};">${escapeHtml(roleName)}</span>` : ''}
<span class="timestamp">${escapeHtml(timestamp)}</span>
</div>
${content.trim() !== '' ? `<div class="content-block">${content}</div>` : ''}
${attachmentsHtml}${embedsHtml}
</div>
</div>`;
    }

    htmlContent += `</div></body></html>`;
    return { htmlContent, sortedMessages };
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calcularDataLimite() {
    const data = getBrasiliaDate();
    data.setDate(data.getDate() - DIAS_PARA_FINALIZAR);
    return data;
}

async function finalizarDenuncia(client, denuncia) {
    let guild = null;
    let guildName = '';
    try {
        const config = await Config.findOne({ guildId: denuncia.guildId });
        guild = client.guilds.cache.get(denuncia.guildId);
        guildName = guild ? guild.name : 'Servidor desconhecido';
        if (!config?.channels?.log) {
            log.warn(`Configuração de log ausente para guildId ${denuncia.guildId}`, { guildName });
            return false;
        }

        const thread = denuncia.threadId
            ? await client.channels.fetch(denuncia.threadId).catch(e => { log.warn(`Erro ao buscar thread: ${e.message}`, { guildName }); return null; })
            : null;

        const channel = denuncia.channelId
            ? await client.channels.fetch(denuncia.channelId).catch(e => { log.warn(`Erro ao buscar canal: ${e.message}`, { guildName }); return null; })
            : null;

        if (thread?.isThread?.()) {
            // Se status for 'reivindicada' ou 'analise', recusa automaticamente
            if (['reivindicada', 'analise'].includes(String(denuncia.status).toLowerCase())) {
                try {
                    await Denuncia.findByIdAndUpdate(denuncia._id, {
                        status: 'recusada',
                        dataAtualizacao: new Date(),
                        'ultimaEdicao.motivoEdicao': `Recusada automaticamente após ${DIAS_PARA_FINALIZAR} dias sem resolução`,
                        'ultimaEdicao.data': new Date(),
                    });
                    // Mensagem no tópico
                    await thread.send('❌ Denúncia recusada automaticamente após tempo limite sem resolução.');
                    await thread.setLocked(true).catch(() => {});
                    await thread.setArchived(true).catch(() => {});
                    log.success(`Denúncia ${denuncia._id} recusada automaticamente por tempo limite.`, { guildName });
                } catch (err) {
                    log.error(`Erro ao recusar denúncia automaticamente: ${err.message}`, { guildName });
                }
                return true;
            }
            const sortedMessages = await fetchAllThreadMessages(thread).catch(e => { log.warn(`Erro ao buscar mensagens do tópico: ${e.message}`, { guildName }); return []; });

            // Unificar processamento de attachments e avatares
            const avatarNameByUserId = new Map();
            const attachmentNameByUrl = new Map();
            let zipFiles = [];
            let downloadedBytes = 0;
            for (const msg of sortedMessages) {
                // Avatares
                if (!avatarNameByUserId.has(msg.author.id)) {
                    avatarNameByUserId.set(msg.author.id, safeFileName(`avatar_${msg.author.id}.png`));
                }
                // Attachments
                for (const attachment of msg.attachments.values()) {
                    if (!attachmentNameByUrl.has(attachment.url)) {
                        attachmentNameByUrl.set(attachment.url, safeFileName(`${msg.id}_${attachment.id}_${attachment.name || 'arquivo'}`));
                    }
                    if (downloadedBytes < EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) {
                        try {
                            const res = await fetchWithTimeout(attachment.url);
                            if (!res?.ok) continue;
                            const len = Number(res.headers.get('content-length') || 0);
                            if (len && len > EXPORT.MAX_SINGLE_DOWNLOAD_BYTES) continue;
                            const buf = await res.buffer();
                            if (buf.length > EXPORT.MAX_SINGLE_DOWNLOAD_BYTES) continue;
                            if (downloadedBytes + buf.length > EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) break;
                            downloadedBytes += buf.length;
                            zipFiles.push({ name: `anexos/${attachmentNameByUrl.get(attachment.url)}`, content: buf });
                        } catch (err) {
                            log.warn(`Falha ao baixar attachment: ${err.message}`, { guildName });
                        }
                    }
                }
            }
            // Avatares (após attachments)
            for (const [uid, avatarName] of avatarNameByUserId.entries()) {
                if (downloadedBytes >= EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) break;
                try {
                    const user = await client.users.fetch(uid).catch(() => null);
                    if (!user) continue;
                    const res = await fetchWithTimeout(user.displayAvatarURL({ extension: 'png', size: EXPORT.AVATAR_SIZE }));
                    if (!res?.ok) continue;
                    const buf = await res.buffer();
                    downloadedBytes += buf.length;
                    zipFiles.push({ name: `anexos/${avatarName}`, content: buf });
                } catch (err) {
                    log.warn(`Falha ao baixar avatar: ${err.message}`, { guildName });
                }
            }

            const preparedMaps = { sortedMessages, avatarNameByUserId, attachmentNameByUrl };
            const executorTag = 'Sistema Automatico';
            const baseFileName = safeFileName(`denuncia_${denuncia.messageId}_${denuncia.acusado}`);

            const { htmlContent: zipHtmlContent } = await generateHtml(thread, denuncia, executorTag, true, preparedMaps);
            const { htmlContent: previewHtmlContent } = await generateHtml(thread, denuncia, executorTag, false, preparedMaps);
            zipFiles.unshift({ name: `${baseFileName}.html`, content: Buffer.from(zipHtmlContent, 'utf8') });

            const zipParts = await splitFilesIntoZipParts(zipFiles, EXPORT.MAX_UPLOAD_BYTES);
            const finalZipParts = zipParts.filter(p => !p.oversize);

            const zipAttachments = finalZipParts.map((part, idx) =>
                new AttachmentBuilder(part.buffer, { name: `${baseFileName}_PARTE_${idx + 1}.zip` })
            );
            const htmlAttachment = new AttachmentBuilder(Buffer.from(previewHtmlContent, 'utf8'), {
                name: `${baseFileName}_PREVIEW.html`,
            });

            const statusMeta = makeStatusMeta(denuncia.status);
            const logsChannel = config?.channels?.log
                ? client.channels.cache.get(config.channels.log)
                : null;

            let logMessage = null;
            if (logsChannel) {
                try {
                    logMessage = await logsChannel.send({
                        content: `**[ARQUIVAMENTO AUTOMATICO - PARTE 1]**`,
                        files: zipAttachments.slice(0, EXPORT.FILES_PER_MESSAGE),
                    });
                    // Adicionar embed depois de obter logMessage
                    const denunciaMsgLink = `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
                    const logEmbed = new EmbedBuilder()
                        .setColor('#2F3136')
                        .setAuthor({
                            name: `Denúncia Finalizada e Arquivada`,
                            iconURL: guild?.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || undefined
                        })
                        .setThumbnail(guild?.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || '')
                        .setDescription(
                            `📦 **Status:** ${statusMeta.label}\n` +
                            `🗓️ **Criada em:** <t:${Math.floor(new Date(denuncia.dataCriacao).getTime()/1000)}:f>\n` +
                            `📝 **Motivo:** ${denuncia.motivo || 'N/A'}\n` +
                            `👤 **Denunciante:** ${denuncia.denunciante || 'N/A'} (ID: ${denuncia.criadoPor || 'N/A'})\n` +
                            `🎯 **Acusado:** ${denuncia.acusado || 'N/A'}\n` +
                            (denuncia.provas ? `📎 **Provas:**\n${String(denuncia.provas).split('\n').map(p => `- ${p}`).join('\n')}` : '') +
                            (denuncia.motivoAceite ? `\n🟢 **Motivo do Aceite (Staff):** ${denuncia.motivoAceite}` : '') +
                            `\n\n[🔗 Abrir Mensagem Original](${denunciaMsgLink})`
                        )
                        .addFields(
                            { name: 'Arquivos ZIP Gerados', value: `${zipAttachments.length}`, inline: true },
                            { name: 'ID da Mensagem', value: `${denuncia.messageId}`, inline: true },
                            { name: 'Servidor', value: guildName, inline: false },
                            { name: 'Data de Finalização', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: false },
                            { name: 'Status Original', value: String(denuncia.status).toUpperCase(), inline: true },
                            { name: 'ID da Denúncia', value: String(denuncia._id), inline: true }
                        )
                        .setFooter({
                            text: `Finalizado automaticamente após ${DIAS_PARA_FINALIZAR} dias | Sistema Althea`,
                            iconURL: 'https://cdn-icons-png.flaticon.com/512/1828/1828640.png'
                        })
                        .setTimestamp();
                    await logMessage.edit({ embeds: [logEmbed] });
                } catch (err) {
                    log.error(`Falha ao enviar log ou editar embed: ${err.message}`, { guildName });
                }

                for (let i = EXPORT.FILES_PER_MESSAGE; i < zipAttachments.length; i += EXPORT.FILES_PER_MESSAGE) {
                    try {
                        await logsChannel.send({
                            content: `**[ARQUIVAMENTO AUTOMATICO - PARTE ${Math.floor(i / EXPORT.FILES_PER_MESSAGE) + 2}]**`,
                            files: zipAttachments.slice(i, i + EXPORT.FILES_PER_MESSAGE),
                        });
                    } catch (err) {
                        log.warn(`Falha ao enviar parte extra: ${err.message}`, { guildName });
                    }
                }

                try {
                    await logsChannel.send({
                        content: `**[PRE-VISUALIZACAO]** ${thread.name}`,
                        files: [htmlAttachment],
                    });
                } catch (err) {
                    log.warn(`Falha ao enviar preview: ${err.message}`, { guildName });
                }
            }

            const denunciante = await client.users.fetch(String(denuncia.criadoPor)).catch(() => null);
            if (denunciante) {
                try {
                    await denunciante.send({
                        embeds: [new EmbedBuilder()
                            .setColor(statusMeta.color)
                            .setTitle(`Denuncia Arquivada - Status: ${statusMeta.label}`)
                            .setDescription(`Sua denuncia sobre **${denuncia.acusado}** foi finalizada automaticamente apos ${DIAS_PARA_FINALIZAR} dias sem resolucao.`)
                            .addFields({ name: 'Motivo Registrado', value: String(denuncia.motivo || 'N/A') })
                            .setTimestamp()
                        ],
                        files: [htmlAttachment],
                    });
                } catch (err) {
                    log.warn(`Falha ao notificar denunciante: ${err.message}`, { guildName });
                }
            }

            try {
                await thread.send(`🚨 Denúncia Finalizada e Arquivada.\n\nCaso precise de reanálise ou queira recorrer da decisão, por favor, abra um TICKET no canal de suporte. Este tópico será trancado.`);
            } catch (err) { log.warn(`Falha ao enviar mensagem no tópico: ${err.message}`, { guildName }); }
            try { await thread.setLocked(true); } catch (err) { log.warn(`Falha ao trancar tópico: ${err.message}`, { guildName }); }
            try { await thread.setArchived(true); } catch (err) { log.warn(`Falha ao arquivar tópico: ${err.message}`, { guildName }); }

            if (logMessage) {
                try {
                    await Denuncia.findByIdAndUpdate(denuncia._id, {
                        logMessageId: logMessage.id,
                        $push: {
                            historico: {
                                acao: 'FINALIZADA_AUTOMATICAMENTE',
                                staffId: 'sistema',
                                data: new Date(),
                                detalhes: { messageLink: logMessage.url },
                            }
                        }
                    });
                } catch (err) {
                    log.warn(`Falha ao atualizar histórico no banco: ${err.message}`, { guildName });
                }
            }
        }

        if (channel?.isTextBased?.() && denuncia.messageId) {
            try {
                const mainMsg = await channel.messages.fetch(denuncia.messageId);
                if (mainMsg) {
                    const novoTexto = mainMsg.content.replace(
                        /\u27B1 \*\*Status\*\*: `[^`]*`/,
                        `\u27B1 **Status**: \`Finalizado 📦\``
                    );
                    if (novoTexto !== mainMsg.content) {
                        await mainMsg.edit({ content: novoTexto });
                    }
                }
            } catch (err) {
                log.warn(`Falha ao editar mensagem principal: ${err.message}`, { guildName });
            }
        }

        try {
            await Denuncia.findByIdAndUpdate(denuncia._id, {
                status: 'finalizada',
                dataAtualizacao: new Date(),
                'ultimaEdicao.motivoEdicao': `Finalizado automaticamente apos ${DIAS_PARA_FINALIZAR} dias`,
                'ultimaEdicao.data': new Date(),
            });
        } catch (err) {
            log.warn(`Falha ao atualizar status no banco: ${err.message}`, { guildName });
        }

        log.success(`AutoFinalizador: Denuncia ${chalk.white.bold(denuncia._id)} finalizada. Denunciante: ${chalk.white(denuncia.denunciante || 'N/A')} | Acusado: ${chalk.white(denuncia.acusado || 'N/A')} | ID da Mensagem: ${chalk.yellow(denuncia.messageId)} | Servidor: ${chalk.cyan(guildName)}`, { guildName });
        return true;
    } catch (error) {
        log.error(`AutoFinalizador: Erro ao finalizar denuncia ${denuncia._id}: ${error.message}`, { guildName });
        return false;
    }
}

async function verificarEFinalizarDenuncias(client) {
    try {
        const dataLimite = calcularDataLimite();

        const denuncias = await Denuncia.find({
            status: { $in: STATUS_FINALIZAVEIS },
            dataCriacao: { $lte: dataLimite },
        })
        .sort({ dataCriacao: 1 })
        .limit(LOTE_MAXIMO)
        .lean();

        if (!denuncias || denuncias.length === 0) {
            log.info(`AutoFinalizador: Nenhuma denuncia para finalizar.`);
            return;
        }

        log.info(`AutoFinalizador: ${chalk.yellow.bold(denuncias.length)} denuncia(s) encontradas para finalizacao.`);

        let finalizadas = 0;
        let erros = 0;

        for (const denuncia of denuncias) {
            const sucesso = await finalizarDenuncia(client, denuncia);
            if (sucesso) finalizadas++;
            else erros++;
            await sleep(DELAY_ENTRE_ITENS_MS);
        }

        log.info(`AutoFinalizador: ${chalk.green.bold(finalizadas)} finalizadas, ${chalk.red.bold(erros)} com erro.`);
    } catch (error) {
        log.error(`AutoFinalizador: Erro durante verificacao: ${error.message}`);
    }
}

let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;
function iniciarAutoFinalizador(client) {
    const jitter = Math.random() * 30000; // 0-30s
    const intervalo = INTERVALO_VERIFICACAO_MS + jitter;
    log.system(`AutoFinalizador iniciado. Verificacao a cada ${Math.round(intervalo/1000)}s. Prazo: ${chalk.white.bold(DIAS_PARA_FINALIZAR + ' dias')}.`);

    const executar = async () => {
        try {
            await verificarEFinalizarDenuncias(client);
            consecutiveErrors = 0;
        } catch (e) {
            consecutiveErrors++;
            log.error(`AutoFinalizador: Erro no ciclo: ${e.message}`, {});
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                log.error('AutoFinalizador: Muitas falhas consecutivas, pausando por 5 minutos.', {});
                setTimeout(() => { consecutiveErrors = 0; }, 5 * 60 * 1000);
                return;
            }
        }
    };

    const timer = setInterval(executar, intervalo);
    timer.unref?.();
    setTimeout(executar, 30 * 1000);
    return timer;
}

module.exports = { iniciarAutoFinalizador };