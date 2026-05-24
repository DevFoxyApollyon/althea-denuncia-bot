const chalk = require('chalk');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { toBrasiliaDate } = require('../utils/dateUtils');
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

const DIAS_PARA_FINALIZAR    = 8;
const INTERVALO_CICLO_MS     = 3 * 60 * 1000;
const DELAY_ENTRE_ITENS_MS   = 5 * 1000;
const LOTE_MAXIMO            = 1;
const STATUS_FINALIZAVEIS    = ['pendente', 'analise', 'reivindicacao', 'aceita', 'recusada'];

const EXPORT = {
    MAX_UPLOAD_BYTES:           45 * 1024 * 1024,
    FILES_PER_MESSAGE:          10,
    TIMEZONE:                   'America/Sao_Paulo',
    FETCH_TIMEOUT_MS:           15000,
    MAX_TOTAL_DOWNLOAD_BYTES:   200 * 1024 * 1024,
    MAX_SINGLE_DOWNLOAD_BYTES:  50 * 1024 * 1024,
    AVATAR_SIZE:                64,
    GUILD_ICON_SIZE:            64,
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
        name:  highestRole ? highestRole.name : '',
        color: highestRole && highestRole.color !== 0
            ? '#' + highestRole.color.toString(16).padStart(6, '0')
            : '#99aab5',
    };
}

async function fetchWithTimeout(url, timeout = EXPORT.FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error(`Timeout após ${timeout}ms`);
        throw error;
    }
}

function makeStatusMeta(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'aceita')   return { label: 'ACEITA',   color: '#43B581', bg: 'rgba(67,181,129,0.12)' };
    if (s === 'recusada') return { label: 'RECUSADA', color: '#F04747', bg: 'rgba(240,71,71,0.12)' };
    return { label: (status || 'PENDENTE').toUpperCase(), color: '#99AAB5', bg: 'rgba(153,170,181,0.12)' };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function mbStr(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function logMemoria() {
    const mem = process.memoryUsage();
    log.system(`Memória — heap: ${chalk.yellow(mbStr(mem.heapUsed))}/${chalk.white(mbStr(mem.heapTotal))} | RSS: ${chalk.cyan(mbStr(mem.rss))}`);
}

async function runGcComLog(label = '', meta = {}) {
    if (!global.gc) {
        log.warn('GC manual indisponível — inicie o bot com --expose-gc', meta);
        return;
    }

    const antes = process.memoryUsage();
    global.gc();

    await new Promise(r => setImmediate(r));

    const depois   = process.memoryUsage();
    const deltaHeap = antes.heapUsed - depois.heapUsed;
    const deltaRss  = antes.rss      - depois.rss;

    const sinal    = deltaHeap >= 0 ? chalk.green('▼') : chalk.red('▲');
    const deltaStr = deltaHeap >= 0
        ? chalk.green(`-${mbStr(deltaHeap)}`)
        : chalk.red(`+${mbStr(Math.abs(deltaHeap))}`);

    log.system(
        `${label ? `[GC ${label}] ` : '[GC] '}` +
        `heap: ${chalk.yellow(mbStr(depois.heapUsed))}/${chalk.white(mbStr(depois.heapTotal))} ` +
        `| RSS: ${chalk.cyan(mbStr(depois.rss))} ` +
        `| liberado: heap ${sinal} ${deltaStr}` +
        (deltaRss !== 0
            ? ` / RSS ${deltaRss >= 0 ? chalk.green('▼') : chalk.red('▲')} ${deltaRss >= 0 ? chalk.green('-') : chalk.red('+')}${mbStr(Math.abs(deltaRss))}`
            : ''),
        meta
    );

    return deltaHeap;
}

function calcularDataLimite() {
    const agora = toBrasiliaDate();
    agora.setDate(agora.getDate() - DIAS_PARA_FINALIZAR);
    return agora;
}

async function fetchAllThreadMessages(thread) {
    const all = [];
    let lastId;
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

function buildZipBuffer(files) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 6 } });
        const pass    = new PassThrough();
        const chunks  = [];
        pass.on('data',  c   => chunks.push(c));
        pass.on('end',   ()  => resolve(Buffer.concat(chunks)));
        pass.on('error', reject);
        archive.on('error', reject);
        archive.pipe(pass);
        for (const f of files) if (f.content) archive.append(f.content, { name: f.name });
        archive.finalize();
    });
}

class ZipBatcher {
    constructor(maxBytes, onFlush) {
        this.maxBytes     = maxBytes;
        this.onFlush      = onFlush;
        this.currentBatch = [];
        this.currentSize  = 0;
        this.partIndex    = 0;
    }

    async add(name, content) {
        if (this.currentSize + content.length > this.maxBytes && this.currentBatch.length > 0) {
            await this._flush();
        }
        this.currentBatch.push({ name, content });
        this.currentSize += content.length;
    }

    async _flush() {
        if (this.currentBatch.length === 0) return;

        // FIX: usar let para poder nulificar após uso
        let buf = await buildZipBuffer(this.currentBatch);

        for (const f of this.currentBatch) f.content = null;
        this.currentBatch = [];
        this.currentSize  = 0;

        await this.onFlush(buf, this.partIndex++);

        // FIX: liberar buffer após envio
        buf = null;
    }

    async finalize() {
        await this._flush();
    }
}

async function generateHtmlString(thread, denunciaData, executorTag, useRelativePaths, sortedMessages, avatarNameByUserId, attachmentNameByUrl, membersMap) {
    const guild        = thread.guild;
    const guildIconURL = guild.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || '';
    const guildName    = escapeHtml(thread.name);
    const statusMeta   = makeStatusMeta(denunciaData.status);

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
                if (lower === 'topico') {
                    provasHtml += `<li>${prova}</li>`;
                } else {
                    const m    = provaRaw.match(urlRegex);
                    const link = m ? m[0] : provaRaw;
                    provasHtml += `<li><a href="${String(link).replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${prova}</a></li>`;
                }
            }
            provasHtml += `</ul>`;
        }
    }

    const motivoAceiteHtml = String(denunciaData.status).toLowerCase() === 'aceita' && denunciaData.motivoAceite
        ? `<p>Motivo do Aceite (Staff): <strong>${escapeHtml(denunciaData.motivoAceite)}</strong></p>` : '';

    const parts = [];
    parts.push(`<!DOCTYPE html>
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
<h2>Mensagens do Topico (${guildName})</h2>`);

    for (const msg of sortedMessages) {
        if (msg.id === thread.parentMessageId) continue;

        const member         = membersMap.get(msg.author.id) || null;
        const avatarFileName = avatarNameByUserId.get(msg.author.id) || `avatar_${msg.author.id}.png`;
        const avatarURL      = msg.author.displayAvatarURL({ extension: 'png', size: EXPORT.AVATAR_SIZE });
        const avatarSrc      = useRelativePaths ? `./anexos/${avatarFileName}` : avatarURL;
        const timestamp      = msg.createdAt.toLocaleString('pt-BR', { timeZone: EXPORT.TIMEZONE });
        const displayUsername = escapeHtml(member ? member.displayName : msg.author.tag);
        const { name: roleName, color: roleColor } = getHighestRole(member);

        let content = escapeHtml(msg.content || '');
        content = content.replace(urlRegex, (url) =>
            `<a href="${String(url).replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
        );

        let usernameStyle = member && member.displayColor !== 0
            ? `color:#${member.displayColor.toString(16).padStart(6, '0')};` : '';
        if (msg.author.id === String(denunciaData.criadoPor)) usernameStyle = 'color:var(--user-denunciante);';
        else if (msg.author.bot) usernameStyle = 'color:var(--user-bot);';

        let attachmentsHtml = '';
        if (msg.attachments?.size > 0) {
            msg.attachments.forEach((attachment) => {
                const uniqueName = attachmentNameByUrl.get(attachment.url) || safeFileName(attachment.name || 'arquivo');
                const mediaPath  = useRelativePaths ? `./anexos/${uniqueName}` : attachment.url;
                const safeHref   = String(mediaPath).replace(/"/g, '%22');
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
                const fieldsHtml = (embed.fields || []).map(f =>
                    `<strong>${escapeHtml(f.name)}:</strong> ${escapeHtml(f.value)}<br>`
                ).join('');
                const embedImg = embed.image?.url
                    ? `<img src="${String(embed.image.url).replace(/"/g, '%22')}" alt="Embed Image">` : '';
                embedsHtml += `<div class="embed" style="border-left-color:${embedColor}">
${embed.author?.name ? `<h4>${escapeHtml(embed.author.name)}</h4>` : ''}
<h3>${escapeHtml(embed.title || 'Embed')}</h3>
<p>${escapeHtml(embed.description || '')}</p>
${embedImg}${fieldsHtml}
</div>`;
            });
        }

        parts.push(`
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
</div>`);
    }

    parts.push(`</div></body></html>`);
    return parts.join('');
}

function buildPreviewHtml(zipHtml, attachmentNameByUrl) {
    return zipHtml.replace(/src="\.\/anexos\/([^"]+)"/g, (match, fileName) => {
        for (const [url, name] of attachmentNameByUrl.entries()) {
            if (name === fileName) return `src="${url}"`;
        }
        return match;
    });
}

async function finalizarDenuncia(client, denuncia) {
    let guild     = null;
    let guildName = '';
    try {
        if (!denuncia.guildId) {
            log.warn(`Denúncia ignorada: guildId ausente`, { guildName: 'Desconhecido' });
            return false;
        }

        const [config, fetchedGuild] = await Promise.all([
            Config.findOne({ guildId: denuncia.guildId }).lean(),
            Promise.resolve(client.guilds.cache.get(denuncia.guildId)),
        ]);

        guild     = fetchedGuild;
        guildName = guild ? guild.name : 'Servidor desconhecido';

        if (!config?.channels?.log) {
            log.warn(`Denúncia ignorada: configuração de log ausente para guildId ${denuncia.guildId}`, { guildName });
            return false;
        }

        const [thread, channel] = await Promise.all([
            denuncia.threadId
                ? client.channels.fetch(denuncia.threadId, { cache: false }).catch(e => { log.warn(`Erro ao buscar thread: ${e.message}`, { guildName }); return null; })
                : Promise.resolve(null),
            denuncia.channelId
                ? client.channels.fetch(denuncia.channelId, { cache: false }).catch(e => { log.warn(`Erro ao buscar canal: ${e.message}`, { guildName }); return null; })
                : Promise.resolve(null),
        ]);

        if (thread?.isThread?.()) {
            if (thread.archived) {
                try {
                    await thread.setArchived(false);
                    log.info(`Tópico desarquivado: ${denuncia._id}`, { guildName });
                } catch (err) {
                    log.warn(`Falha ao desarquivar tópico: ${err.message}`, { guildName });
                    return 'IGNORADA';
                }
            }

            if (['reivindicada', 'analise'].includes(String(denuncia.status).toLowerCase())) {
                try {
                    await Denuncia.findByIdAndUpdate(denuncia._id, {
                        status: 'recusada',
                        dataAtualizacao: new Date(),
                        'ultimaEdicao.motivoEdicao': `Recusada automaticamente após ${DIAS_PARA_FINALIZAR} dias sem resolução`,
                        'ultimaEdicao.data': new Date(),
                    });
                    const recentMessages = await thread.messages.fetch({ limit: 10 }).catch(() => new Map());
                    const jaEnviada = Array.from(recentMessages.values()).some(m =>
                        m.content?.includes('❌ Denúncia recusada automaticamente após tempo limite sem resolução.')
                    );
                    if (!jaEnviada) {
                        await thread.send('❌ Denúncia recusada automaticamente após o tempo limite sem resolução. Caso deseje recorrer, abra um ticket no suporte.');
                    }
                    thread.messages.cache.clear();
                    await thread.setLocked(true).catch(() => {});
                    await thread.setArchived(true).catch(() => {});
                    // FIX: remover thread do cache após arquivar
                    if (guild) guild.channels.cache.delete(thread.id);
                    log.success(`Denúncia ${denuncia._id} recusada automaticamente.`, { guildName });
                } catch (err) {
                    log.error(`Erro ao recusar automaticamente: ${err.message}`, { guildName });
                }
                return true;
            }

            const sortedMessages = await fetchAllThreadMessages(thread).catch(e => {
                log.warn(`Erro ao buscar mensagens: ${e.message}`, { guildName });
                return [];
            });

            const avatarNameByUserId  = new Map();
            const attachmentNameByUrl = new Map();
            for (const msg of sortedMessages) {
                if (!avatarNameByUserId.has(msg.author.id)) {
                    avatarNameByUserId.set(msg.author.id, safeFileName(`avatar_${msg.author.id}.png`));
                }
                for (const attachment of msg.attachments.values()) {
                    if (!attachmentNameByUrl.has(attachment.url)) {
                        attachmentNameByUrl.set(attachment.url, safeFileName(`${msg.id}_${attachment.id}_${attachment.name || 'arquivo'}`));
                    }
                }
            }

            const authorIds  = [...new Set(sortedMessages.map(m => m.author.id))];
            const membersMap = new Map();
            for (const id of authorIds) {
                const member = await thread.guild.members.fetch({ user: id, cache: false }).catch(() => null);
                membersMap.set(id, member);
            }

            const executorTag  = 'Sistema Automatico';
            const baseFileName = safeFileName(`denuncia_${denuncia.messageId}_${denuncia.acusado}`);
            const statusMeta   = makeStatusMeta(denuncia.status);
            const logsChannel  = config?.channels?.log
                ? client.channels.cache.get(config.channels.log)
                : null;

            let zipHtmlContent = await generateHtmlString(
                thread, denuncia, executorTag, true,
                sortedMessages, avatarNameByUserId, attachmentNameByUrl, membersMap
            );

            let htmlAttachment;
            {
                const previewHtml = buildPreviewHtml(zipHtmlContent, attachmentNameByUrl);
                htmlAttachment = new AttachmentBuilder(Buffer.from(previewHtml, 'utf8'), {
                    name: `${baseFileName}_PREVIEW.html`,
                });
            }

            let logMessage    = null;
            let partsEnviadas = 0;

            const batcher = new ZipBatcher(EXPORT.MAX_UPLOAD_BYTES, async (buf, partIndex) => {
                partsEnviadas++;
                const partLabel = `**[ARQUIVAMENTO AUTOMATICO - PARTE ${partsEnviadas}]**`;

                // FIX: usar let para poder nulificar após envio
                let zipAttachment = new AttachmentBuilder(buf, {
                    name: `${baseFileName}_PARTE_${partsEnviadas}.zip`,
                });

                if (logsChannel) {
                    try {
                        const sent = await logsChannel.send({
                            content: partLabel,
                            files: [zipAttachment],
                        });
                        if (partIndex === 0) logMessage = sent;
                    } catch (err) {
                        log.warn(`Falha ao enviar parte ${partsEnviadas}: ${err.message}`, { guildName });
                    }
                }

                // FIX: liberar buffer interno do AttachmentBuilder após envio
                zipAttachment.attachment = null;
                zipAttachment = null;

                await runGcComLog(`pós-parte-${partsEnviadas}`, { guildName });
            });

            await batcher.add(`${baseFileName}.html`, Buffer.from(zipHtmlContent, 'utf8'));
            zipHtmlContent = null;

            let downloadedBytes = 0;
            for (const msg of sortedMessages) {
                if (downloadedBytes >= EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) break;
                for (const attachment of msg.attachments.values()) {
                    if (downloadedBytes >= EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) break;
                    try {
                        const res = await fetchWithTimeout(attachment.url);
                        if (!res?.ok) continue;
                        const len = Number(res.headers.get('content-length') || 0);
                        if (len && len > EXPORT.MAX_SINGLE_DOWNLOAD_BYTES) continue;
                        let buf = await res.buffer();
                        if (buf.length > EXPORT.MAX_SINGLE_DOWNLOAD_BYTES) { buf = null; continue; }
                        if (downloadedBytes + buf.length > EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) { buf = null; break; }
                        downloadedBytes += buf.length;
                        await batcher.add(`anexos/${attachmentNameByUrl.get(attachment.url)}`, buf);
                        // FIX: liberar referência local após entregar ao batcher
                        buf = null;
                    } catch (err) {
                        log.warn(`Falha ao baixar attachment: ${err.message}`, { guildName });
                    }
                }
            }

            for (const [uid, avatarName] of avatarNameByUserId.entries()) {
                if (downloadedBytes >= EXPORT.MAX_TOTAL_DOWNLOAD_BYTES) break;
                try {
                    const user = await client.users.fetch(uid, { cache: false }).catch(() => null);
                    if (!user) continue;
                    const res = await fetchWithTimeout(user.displayAvatarURL({ extension: 'png', size: EXPORT.AVATAR_SIZE }));
                    if (!res?.ok) continue;
                    let buf = await res.buffer();
                    downloadedBytes += buf.length;
                    await batcher.add(`anexos/${avatarName}`, buf);
                    // FIX: liberar referência local e remover do cache de usuários
                    buf = null;
                    client.users.cache.delete(uid);
                } catch (err) {
                    log.warn(`Falha ao baixar avatar: ${err.message}`, { guildName });
                }
            }

            await batcher.finalize();

            // Limpeza completa de referências
            thread.messages.cache.clear();
            sortedMessages.length = 0;
            membersMap.clear();
            avatarNameByUserId.clear();
            attachmentNameByUrl.clear();

            // FIX: remover membros buscados do cache da guild
            for (const id of authorIds) {
                if (guild) guild.members.cache.delete(id);
            }

            await runGcComLog('pós-batcher', { guildName });

            if (logsChannel && logMessage) {
                try {
                    const denunciaMsgLink = `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
                    const logEmbed = new EmbedBuilder()
                        .setColor('#2F3136')
                        .setAuthor({
                            name:    `Denúncia Finalizada e Arquivada`,
                            iconURL: guild?.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || undefined,
                        })
                        .setThumbnail(guild?.iconURL({ extension: 'png', size: EXPORT.GUILD_ICON_SIZE }) || '')
                        .setDescription(
                            `📦 **Status:** ${statusMeta.label}\n` +
                            `🗓️ **Criada em:** <t:${Math.floor(new Date(denuncia.dataCriacao).getTime() / 1000)}:f>\n` +
                            `📝 **Motivo:** ${denuncia.motivo || 'N/A'}\n` +
                            `👤 **Denunciante:** ${denuncia.denunciante || 'N/A'} (ID: ${denuncia.criadoPor || 'N/A'})\n` +
                            `🎯 **Acusado:** ${denuncia.acusado || 'N/A'}\n` +
                            (denuncia.provas ? `📎 **Provas:**\n${String(denuncia.provas).split('\n').map(p => `- ${p}`).join('\n')}` : '') +
                            (denuncia.motivoAceite ? `\n🟢 **Motivo Por esta aceita:** ${denuncia.motivoAceite}` : '') +
                            `\n\n[🔗 Abrir Mensagem Original](${denunciaMsgLink})`
                        )
                        .addFields(
                            { name: 'Partes ZIP Enviadas',  value: `${partsEnviadas}`,                                    inline: true  },
                            { name: 'ID da Mensagem',       value: `${denuncia.messageId}`,                               inline: true  },
                            { name: 'Servidor',             value: guildName,                                             inline: false },
                            { name: 'Data de Finalização',  value: `<t:${Math.floor(Date.now() / 1000)}:f>`,              inline: false },
                            { name: 'Status Original',      value: String(denuncia.status).toUpperCase(),                 inline: true  },
                            { name: 'ID da Denúncia',       value: String(denuncia._id),                                  inline: true  }
                        )
                        .setFooter({
                            text:    `Finalizado automaticamente após ${DIAS_PARA_FINALIZAR} dias | Sistema Althea`,
                            iconURL: 'https://cdn-icons-png.flaticon.com/512/1828/1828640.png',
                        })
                        .setTimestamp();

                    await logMessage.edit({ embeds: [logEmbed] });
                } catch (err) {
                    log.error(`Falha ao editar embed de log: ${err.message}`, { guildName });
                }
            }

            if (logsChannel) {
                try {
                    await logsChannel.send({
                        content: `**[PRE-VISUALIZACAO]** ${thread.name}`,
                        files:   [htmlAttachment],
                    });
                } catch (err) {
                    log.warn(`Falha ao enviar preview: ${err.message}`, { guildName });
                }
            }

            const denunciante = await client.users.fetch(String(denuncia.criadoPor), { cache: false }).catch(() => null);
            if (denunciante) {
                try {
                    const denunciaMsgLinkDm = `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
                    const threadLinkDm = denuncia.threadId
                        ? `https://discord.com/channels/${denuncia.guildId}/${denuncia.threadId}` : null;
                    await denunciante.send({
                        embeds: [new EmbedBuilder()
                            .setColor(statusMeta.color)
                            .setTitle(`Denuncia Arquivada - Status: ${statusMeta.label}`)
                            .setDescription(
                                `Sua denuncia sobre **${denuncia.acusado}** foi finalizada automaticamente apos ${DIAS_PARA_FINALIZAR} dias sem resolucao.\n\n` +
                                `[🔗 Mensagem Original](${denunciaMsgLinkDm})` +
                                (threadLinkDm ? `\n[🧵 Tópico Encerrado](${threadLinkDm})` : '')
                            )
                            .addFields({ name: 'Motivo Registrado', value: String(denuncia.motivo || 'N/A') })
                            .setTimestamp()
                        ],
                        files: [htmlAttachment],
                    });
                } catch (err) {
                    log.warn(`Falha ao notificar denunciante: ${err.message}`, { guildName });
                }
                // FIX: remover denunciante do cache após uso
                client.users.cache.delete(String(denuncia.criadoPor));
            }

            // FIX: liberar buffer interno do htmlAttachment antes de nulificar
            if (htmlAttachment) {
                htmlAttachment.attachment = null;
                htmlAttachment = null;
            }

            try {
                const recentMessages = await thread.messages.fetch({ limit: 10 }).catch(() => new Map());
                const jaEnviada = Array.from(recentMessages.values()).some(m =>
                    m.content?.includes('🚨 Denúncia Finalizada e Arquivada.')
                );
                if (!jaEnviada) {
                    await thread.send(`🚨 Denúncia Finalizada e Arquivada.\n\nCaso precise de reanálise ou queira recorrer da decisão, por favor, abra um TICKET no canal de suporte. Este tópico será trancado.`);
                }
                thread.messages.cache.clear();
            } catch (err) {
                log.warn(`Falha ao enviar mensagem no tópico: ${err.message}`, { guildName });
            }

            await thread.setLocked(true).catch(err => log.warn(`Falha ao trancar tópico: ${err.message}`, { guildName }));
            await thread.setArchived(true).catch(err => log.warn(`Falha ao arquivar tópico: ${err.message}`, { guildName }));

            // FIX: remover thread do cache de canais após arquivar
            if (guild) guild.channels.cache.delete(thread.id);

            if (logMessage) {
                try {
                    await Denuncia.findByIdAndUpdate(denuncia._id, {
                        logMessageId: logMessage.id,
                        $push: {
                            historico: {
                                acao:      'FINALIZADA_AUTOMATICAMENTE',
                                staffId:   'sistema',
                                data:      new Date(),
                                detalhes:  { messageLink: logMessage.url },
                            },
                        },
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
                    if (novoTexto !== mainMsg.content) await mainMsg.edit({ content: novoTexto });
                }
            } catch (err) {
                log.warn(`Falha ao editar mensagem principal: ${err.message}`, { guildName });
            }
            // FIX: limpar todo o cache do canal, não só uma mensagem
            channel.messages.cache.clear();
        }

        try {
            await Denuncia.findByIdAndUpdate(denuncia._id, {
                status:                         'finalizada',
                dataAtualizacao:                new Date(),
                'ultimaEdicao.motivoEdicao':    `Finalizado automaticamente apos ${DIAS_PARA_FINALIZAR} dias`,
                'ultimaEdicao.data':            new Date(),
            });
            log.success(`Status atualizado para 'finalizada': ${denuncia._id}`, { guildName });
        } catch (err) {
            log.warn(`Falha ao atualizar status no banco: ${err.message}`, { guildName });
        }

        log.success(
            `AutoFinalizador: Denuncia ${chalk.white.bold(denuncia._id)} finalizada. ` +
            `Denunciante: ${chalk.white(denuncia.denunciante || 'N/A')} | ` +
            `Acusado: ${chalk.white(denuncia.acusado || 'N/A')} | ` +
            `ID: ${chalk.yellow(denuncia.messageId)} | ` +
            `Servidor: ${chalk.cyan(guildName)} | ` +
            `messageId: ${chalk.magenta(denuncia.messageId)}`,
            { guildName }
        );
        return true;
    } catch (error) {
        log.error(`AutoFinalizador: Erro ao finalizar ${denuncia._id}: ${error.message}`, { guildName });
        return false;
    }
}

async function verificarEFinalizarDenuncias(client) {
    try {
        logMemoria();

        const dataLimite = calcularDataLimite();
        const denuncias  = await Denuncia.find({
            dataCriacao: { $lte: dataLimite },
            guildId:     { $exists: true, $ne: null, $ne: '' },
            status:      { $in: STATUS_FINALIZAVEIS },
        })
        .sort({ dataCriacao: 1 })
        .limit(LOTE_MAXIMO)
        .lean();

        if (!denuncias || denuncias.length === 0) return;

        log.info(`AutoFinalizador: ${chalk.yellow.bold(denuncias.length)} denuncia(s) para finalização.`);

        let finalizadas = 0;
        let erros       = 0;

        for (let i = 0; i < denuncias.length; i++) {
            const denuncia = denuncias[i];
            log.info(
                `Iniciando finalização: ${chalk.cyan(denuncia._id)} | ` +
                `Acusado: ${chalk.white(denuncia.acusado)} | ` +
                `Denunciante: ${chalk.white(denuncia.denunciante)}`
            );
            try {
                const sucesso = await finalizarDenuncia(client, denuncia);
                if (sucesso) {
                    finalizadas++;
                    log.success(`Finalizada: ${chalk.cyan(denuncia._id)}`);
                } else {
                    erros++;
                    log.error(`Falha: ${chalk.cyan(denuncia._id)}`);
                }
            } catch (err) {
                erros++;
                log.error(`Erro inesperado: ${chalk.cyan(denuncia._id)} | ${err.message}`);
            }
            await runGcComLog('pós-denuncia');
            if (i < denuncias.length - 1) await sleep(DELAY_ENTRE_ITENS_MS);
        }

        log.info(`AutoFinalizador: ${chalk.green.bold(finalizadas)} finalizadas, ${chalk.red.bold(erros)} com erro.`);
    } catch (error) {
        log.error(`AutoFinalizador: Erro durante verificação: ${error.message}`);
    }
}

let consecutiveErrors        = 0;
const MAX_CONSECUTIVE_ERRORS = 5;
let autoFinalizadorLock      = false;

function iniciarAutoFinalizador(client) {
    log.system(
        `AutoFinalizador iniciado. Intervalo: ${chalk.white.bold(INTERVALO_CICLO_MS / 1000 + 's')}. ` +
        `Prazo: ${chalk.white.bold(DIAS_PARA_FINALIZAR + ' dias')}.`
    );

    const executar = async () => {
        if (autoFinalizadorLock) {
            log.warn('AutoFinalizador: Execução anterior ainda em andamento, pulando ciclo.');
            return;
        }
        autoFinalizadorLock = true;
        try {
            await verificarEFinalizarDenuncias(client);
            consecutiveErrors = 0;
        } catch (e) {
            consecutiveErrors++;
            log.error(`AutoFinalizador: Erro no ciclo: ${e.message}`);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                log.error(`AutoFinalizador: ${MAX_CONSECUTIVE_ERRORS} falhas consecutivas. Pausando por 5 minutos.`);
                autoFinalizadorLock = false;
                await sleep(5 * 60 * 1000);
                consecutiveErrors = 0;
                return;
            }
        }
        autoFinalizadorLock = false;
    };

    const timer = setInterval(executar, INTERVALO_CICLO_MS);
    timer.unref?.();
    setTimeout(executar, 30 * 1000);
    return timer;
}

module.exports = { iniciarAutoFinalizador };