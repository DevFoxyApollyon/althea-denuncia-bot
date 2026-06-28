// nicknamePoller.js
const chalk = require('chalk');
const Usuarios = require('../models/Usuario');
const { extrairContaDoNickname } = require('../utils/nickUtils');

const INTERVALO_MS = 5 * 60 * 1000;

const log = {
    info:    (msg) => console.log(`${chalk.blue('â„¹')} ${chalk.gray('[POLLER]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('âœ”')} ${chalk.gray('[POLLER]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('âš ')} ${chalk.gray('[POLLER]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('âœ–')} ${chalk.gray('[POLLER]')} ${msg}`),
};

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

    for (const registro of registros) {
        try {
            const guild = client.guilds.cache.get(registro.guildId);
            if (!guild) {
                await Usuarios.deleteOne({ _id: registro._id });
                totalRemovidos++;
                continue;
            }

            const auditLogs = await guild.fetchAuditLogs({ limit: 100, type: 24 }).catch(() => null);
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
                // FIX: cache: false + delete apÃ³s uso
                const membro = await guild.members.fetch({ user: registro.userId, cache: false }).catch(() => null);
                const nickAtual    = membro?.nickname || membro?.user?.username || null;
                const contaDoNick  = nickAtual ? extrairContaDoNickname(nickAtual) : null;
                if (membro) guild.members.cache.delete(registro.userId);

                if (!contaDoNick) {
                    await Usuarios.deleteOne({ _id: registro._id });
                    totalRemovidos++;
                    continue;
                }

                await Usuarios.updateOne(
                    { _id: registro._id },
                    { $set: { conta: contaDoNick, updatedAt: new Date() } }
                );
                totalReparados++;
                continue;
            }

            const nickDoLog      = entrada.changes?.find(c => c.key === 'nick')?.new ?? null;
            const contaExtraida  = nickDoLog ? extrairContaDoNickname(nickDoLog) : null;

            if (!contaExtraida) {
                await Usuarios.deleteOne({ _id: registro._id });
                totalRemovidos++;
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
    }

    log.info(
        `[REPARO] ConcluÃ­do â€” ` +
        `${chalk.green(totalReparados + ' reparado(s)')} | ` +
        `${chalk.red(totalRemovidos + ' removido(s)')}`
    );
}

async function verificarNicknames(client) {
    const BOT_ALVO_IDS = (process.env.BOT_ALVO_ID || '').split(',').map(id => id.trim()).filter(Boolean);

    let totalNovos          = 0;
    let totalAtualizados    = 0;
    let totalContaCorrigida = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            const auditLogs = await guild.fetchAuditLogs({ limit: 100, type: 24 });

            const entradasBot = auditLogs.entries.filter(entry =>
                BOT_ALVO_IDS.includes(entry.executor?.id) &&
                entry.changes?.some(c => c.key === 'nick')
            );

            // Ãšltima entrada por userId
            const ultimasEntradas = new Map();
            for (const entry of entradasBot) {
                const userId = entry.target?.id;
                if (userId && !ultimasEntradas.has(userId)) {
                    ultimasEntradas.set(userId, entry);
                }
            }

            if (ultimasEntradas.size > 0) {
                // FIX: buscar todos os registros relevantes em uma query sÃ³
                const userIds = [...ultimasEntradas.keys()];
                const registrosExistentes = await Usuarios.find({
                    guildId: guild.id,
                    userId:  { $in: userIds },
                }).lean();
                const registroMap = new Map(registrosExistentes.map(r => [r.userId, r]));

                const bulkOpsAudit = [];

                for (const entry of ultimasEntradas.values()) {
                    const userId   = entry.target?.id;
                    const nickNovo = entry.changes?.find(c => c.key === 'nick')?.new ?? null;
                    if (!userId) continue;

                    const existente = registroMap.get(userId);
                    if (existente?.nickname?.toLowerCase() === nickNovo?.toLowerCase()) continue;

                    // FIX: cache: false + delete apÃ³s uso
                    const membro   = await guild.members.fetch({ user: userId, cache: false }).catch(() => null);
                    const username = membro?.user?.username ?? 'Desconhecido';
                    if (membro) guild.members.cache.delete(userId);

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

                // FIX: bulkWrite ao invÃ©s de N operaÃ§Ãµes individuais
                if (bulkOpsAudit.length > 0) await Usuarios.bulkWrite(bulkOpsAudit);
            }

            // FIX: REMOVIDO guild.members.fetch() sem argumentos
            // Processar somente membros jÃ¡ presentes no cache (sem forÃ§ar carregamento de todos)
            const membersEmCache = guild.members.cache.filter(m => !m.user.bot);

            if (membersEmCache.size > 0) {
                // FIX: buscar todos os registros dos membros em cache de uma vez
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

                // FIX: bulkWrite ao invÃ©s de N updates individuais
                if (bulkOpsCache.length > 0) await Usuarios.bulkWrite(bulkOpsCache);
            }

        } catch (err) {
            log.error(`Erro na guild ${chalk.white(guild.name)}: ${err.message}`);
        }
    }

    if (totalNovos > 0 || totalAtualizados > 0 || totalContaCorrigida > 0) {
        log.info(
            `VerificaÃ§Ã£o concluÃ­da â€” ` +
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