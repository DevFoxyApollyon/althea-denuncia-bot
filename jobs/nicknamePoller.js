const chalk = require('chalk');
const Usuarios = require('../models/Usuario');
const { extrairContaDoNickname } = require('../utils/nickUtils');

const INTERVALO_MS       = 5 * 60 * 1000;
const DELAY_ENTRE_ITENS_MS  = 300;
const DELAY_ENTRE_GUILDS_MS = 500;

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[POLLER]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[POLLER]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[POLLER]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[POLLER]')} ${msg}`),
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function repararContasComDiscordId(client) {
    const BOT_ALVO_IDS = (process.env.BOT_ALVO_ID || '').split(',').map(id => id.trim()).filter(Boolean);

    const registros = await Usuarios.find({
        $or: [
            { $expr: { $eq: ['$conta', '$userId'] } },
            { conta: { $regex: /^\d{17,19}$/ } }
        ]
    }).lean();

    if (registros.length === 0) {
        log.info('[REPARO] Nenhum registro corrompido encontrado.');
        return;
    }

    log.warn(`[REPARO] ${chalk.yellow(registros.length + ' registro(s)')} corrompido(s) encontrado(s). Iniciando reparo...`);

    let totalReparados = 0;
    let totalRemovidos = 0;
    const auditLogsPorGuild = new Map();

    for (const registro of registros) {
        try {
            const guild = client.guilds.cache.get(registro.guildId);
            if (!guild) {
                await Usuarios.deleteOne({ _id: registro._id });
                totalRemovidos++;
                continue;
            }

            let auditLogs = auditLogsPorGuild.get(registro.guildId);
            if (auditLogs === undefined) {
                auditLogs = await guild.fetchAuditLogs({ limit: 100, type: 24 }).catch(() => null);
                auditLogsPorGuild.set(registro.guildId, auditLogs);
            }

            if (!auditLogs) {
                await Usuarios.deleteOne({ _id: registro._id });
                totalRemovidos++;
                continue;
            }

            const entrada = auditLogs.entries.find(entry => {
                const ehOBot   = BOT_ALVO_IDS.includes(entry.executor?.id);
                const ehOAlvo  = entry.target?.id === registro.userId;
                const mudouNick = entry.changes?.some(c => c.key === 'nick');
                return ehOBot && ehOAlvo && mudouNick;
            });

            if (!entrada) {
                const membro = await guild.members.fetch({ user: registro.userId, cache: false }).catch(() => null);
                const nickAtual    = membro?.nickname || membro?.user?.username || null;
                const contaDoNick  = nickAtual ? extrairContaDoNickname(nickAtual) : null;
                if (membro) guild.members.cache.delete(registro.userId);

                if (!contaDoNick) {
                    await Usuarios.deleteOne({ _id: registro._id });
                    totalRemovidos++;
                    await sleep(DELAY_ENTRE_ITENS_MS);
                    continue;
                }

                await Usuarios.updateOne(
                    { _id: registro._id },
                    { $set: { conta: contaDoNick, updatedAt: new Date() } }
                );
                totalReparados++;
                await sleep(DELAY_ENTRE_ITENS_MS);
                continue;
            }

            const nickDoLog      = entrada.changes?.find(c => c.key === 'nick')?.new ?? null;
            const contaExtraida  = nickDoLog ? extrairContaDoNickname(nickDoLog) : null;

            if (!contaExtraida) {
                await Usuarios.deleteOne({ _id: registro._id });
                totalRemovidos++;
                await sleep(DELAY_ENTRE_ITENS_MS);
                continue;
            }

            await Usuarios.updateOne(
                { _id: registro._id },
                { $set: { conta: contaExtraida, updatedAt: new Date() } }
            );
            totalReparados++;
        } catch (err) {
            log.error(`[REPARO] Erro ao reparar userId ${registro.userId}: ${err.message}`);
        }
        await sleep(DELAY_ENTRE_ITENS_MS);
    }

    log.info(
        `[REPARO] Concluído — ` +
        `${chalk.green(totalReparados + ' reparado(s)')} | ` +
        `${chalk.red(totalRemovidos + ' removido(s)')}`
    );
}

async function verificarNicknames(client) {
    const BOT_ALVO_IDS = (process.env.BOT_ALVO_ID || '').split(',').map(id => id.trim()).filter(Boolean);

    let totalNovos          = 0;
    let totalAtualizados    = 0;
    let totalContaCorrigida = 0;

    const guilds = [...client.guilds.cache.values()];

    for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        try {
            const auditLogs = await guild.fetchAuditLogs({ limit: 100, type: 24 });

            const entradasBot = auditLogs.entries.filter(entry =>
                BOT_ALVO_IDS.includes(entry.executor?.id) &&
                entry.changes?.some(c => c.key === 'nick')
            );

            const ultimasEntradas = new Map();
            for (const entry of entradasBot) {
                const userId = entry.target?.id;
                if (userId && !ultimasEntradas.has(userId)) {
                    ultimasEntradas.set(userId, entry);
                }
            }

            if (ultimasEntradas.size > 0) {
                const userIds = [...ultimasEntradas.keys()];
                const registrosExistentes = await Usuarios.find({
                    guildId: guild.id,
                    userId:  { $in: userIds },
                }).lean();
                const registroMap = new Map(registrosExistentes.map(r => [r.userId, r]));

                const nickPorUserId = new Map();
                for (const entry of ultimasEntradas.values()) {
                    const userId   = entry.target?.id;
                    if (!userId) continue;
                    const nickNovo = entry.changes?.find(c => c.key === 'nick')?.new ?? null;
                    const existente = registroMap.get(userId);
                    if (existente?.nickname?.toLowerCase() === nickNovo?.toLowerCase()) continue;
                    nickPorUserId.set(userId, nickNovo);
                }

                const idsParaBuscar = [...nickPorUserId.keys()];
                const membrosBuscados = idsParaBuscar.length > 0
                    ? await guild.members.fetch({ user: idsParaBuscar, cache: false }).catch(() => new Map())
                    : new Map();

                const bulkOpsAudit = [];

                for (const [userId, nickNovo] of nickPorUserId.entries()) {
                    const existente = registroMap.get(userId);
                    const membro    = membrosBuscados.get(userId);
                    const username  = membro?.user?.username ?? 'Desconhecido';
                    const contaExtraida = nickNovo ? extrairContaDoNickname(nickNovo) : null;

                    bulkOpsAudit.push({
                        updateOne: {
                            filter:  { guildId: guild.id, userId },
                            update:  { $set: {
                                username,
                                nickname: nickNovo ?? username,
                                conta:    contaExtraida || existente?.conta || userId,
                                updatedAt: new Date(),
                            }},
                            upsert: true,
                        },
                    });

                    if (!existente) totalNovos++;
                    else totalAtualizados++;
                }

                for (const id of idsParaBuscar) guild.members.cache.delete(id);

                if (bulkOpsAudit.length > 0) await Usuarios.bulkWrite(bulkOpsAudit);
            }

            const membersEmCache = guild.members.cache.filter(m => !m.user.bot);

            if (membersEmCache.size > 0) {
                const cachedIds = [...membersEmCache.keys()];
                const registrosCached = await Usuarios.find({
                    guildId: guild.id,
                    userId:  { $in: cachedIds },
                }).lean();

                const bulkOpsCache = [];

                for (const registro of registrosCached) {
                    const member = membersEmCache.get(registro.userId);
                    if (!member) continue;

                    const nickAtual   = member.nickname || member.user.username;
                    const contaNoNick = extrairContaDoNickname(nickAtual);

                    if (!contaNoNick && registro.conta && registro.conta !== member.id) continue;

                    const contaEsperada = contaNoNick || registro.conta || member.id;

                    if (
                        registro.conta    === contaEsperada &&
                        registro.nickname === member.nickname
                    ) continue;

                    bulkOpsCache.push({
                        updateOne: {
                            filter: { guildId: guild.id, userId: member.id },
                            update: { $set: {
                                username:  member.user.username,
                                nickname:  member.nickname ?? member.user.username,
                                conta:     contaEsperada,
                                updatedAt: new Date(),
                            }},
                        },
                    });
                    totalContaCorrigida++;
                }

                if (bulkOpsCache.length > 0) await Usuarios.bulkWrite(bulkOpsCache);
            }

        } catch (err) {
            log.error(`Erro na guild ${chalk.white(guild.name)}: ${err.message}`);
        }
        if (i < guilds.length - 1) await sleep(DELAY_ENTRE_GUILDS_MS);
    }

    if (totalNovos > 0 || totalAtualizados > 0 || totalContaCorrigida > 0) {
        log.info(
            `Verificação concluída — ` +
            `${chalk.green(totalNovos + ' novo(s)')} | ` +
            `${chalk.blue(totalAtualizados + ' atualizado(s)')} | ` +
            `${chalk.yellow(totalContaCorrigida + ' conta(s) corrigida(s)')}`
        );
    }
}

function iniciarPoller(client) {
    log.info(chalk.magenta(`Poller iniciado. Verificando a cada ${chalk.bold('5 minutos')}.`));

    repararContasComDiscordId(client).then(() => {
        verificarNicknames(client);
        setInterval(() => verificarNicknames(client), INTERVALO_MS);
    });
}

module.exports = { iniciarPoller };