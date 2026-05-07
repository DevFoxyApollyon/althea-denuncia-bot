const chalk = require('chalk');
const Usuarios = require('../models/Usuario');
const { extrairContaDoNickname } = require('../utils/nickUtils');

const INTERVALO_MS = 5 * 60 * 1000;

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[POLLER]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[POLLER]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[POLLER]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[POLLER]')} ${msg}`),
};

async function repararContasComDiscordId(client) {
    const BOT_ALVO_IDS = (process.env.BOT_ALVO_ID || '').split(',').map(id => id.trim()).filter(Boolean);

    const registros = await Usuarios.find({
        $or: [
            { $expr: { $eq: ['$conta', '$userId'] } },
            { conta: { $regex: /^\d{17,19}$/ } }
        ]
    });

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
                const ehOBot = BOT_ALVO_IDS.includes(entry.executor?.id);
                const ehOAlvo = entry.target?.id === registro.userId;
                const mudouNick = entry.changes?.some(c => c.key === 'nick');
                return ehOBot && ehOAlvo && mudouNick;
            });

            if (!entrada) {
                const membro = await guild.members.fetch(registro.userId).catch(() => null);
                const nickAtual = membro?.nickname || membro?.user?.username || null;
                const contaDoNick = nickAtual ? extrairContaDoNickname(nickAtual) : null;

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

            const nickDoLog = entrada.changes?.find(c => c.key === 'nick')?.new ?? null;
            const contaExtraida = nickDoLog ? extrairContaDoNickname(nickDoLog) : null;

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
        `[REPARO] Concluído — ` +
        `${chalk.green(totalReparados + ' reparado(s)')} | ` +
        `${chalk.red(totalRemovidos + ' removido(s)')}`
    );
}

async function verificarNicknames(client) {
    const BOT_ALVO_IDS = (process.env.BOT_ALVO_ID || '').split(',').map(id => id.trim()).filter(Boolean);

    let totalNovos = 0;
    let totalAtualizados = 0;
    let totalContaCorrigida = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            const auditLogs = await guild.fetchAuditLogs({ limit: 100, type: 24 });

            const entradasBot = auditLogs.entries.filter(entry => {
                const ehOBot = BOT_ALVO_IDS.includes(entry.executor?.id);
                const mudouNick = entry.changes?.some(c => c.key === 'nick');
                return ehOBot && mudouNick;
            });

            const ultimasEntradas = new Map();
            for (const entry of entradasBot) {
                const userId = entry.target?.id;
                if (userId && !ultimasEntradas.has(userId)) {
                    ultimasEntradas.set(userId, entry);
                }
            }

            for (const entry of ultimasEntradas.values()) {
                const userId = entry.target?.id;
                const nickNovo = entry.changes?.find(c => c.key === 'nick')?.new ?? null;
                const nickVelho = entry.changes?.find(c => c.key === 'nick')?.old ?? null;

                if (!userId) continue;

                const existente = await Usuarios.findOne({ guildId: guild.id, userId });

                if (existente?.nickname?.toLowerCase() === nickNovo?.toLowerCase()) continue;

                const membro = await guild.members.fetch(userId).catch(() => null);
                const username = membro?.user?.username ?? 'Desconhecido';

                const contaExtraida = nickNovo ? extrairContaDoNickname(nickNovo) : null;

                const setPayload = {
                    username,
                    nickname: nickNovo ?? username,
                    conta: contaExtraida || existente?.conta || userId,
                    updatedAt: new Date(),
                };

                await Usuarios.findOneAndUpdate(
                    { guildId: guild.id, userId },
                    { $set: setPayload },
                    { upsert: true, new: false }
                );

                if (!existente) totalNovos++;
                else totalAtualizados++;
            }

            await guild.members.fetch();
            const members = guild.members.cache.filter(m => !m.user.bot);

            for (const member of members.values()) {
                const nickAtual = member.nickname || member.user.username;
                const contaNoNick = extrairContaDoNickname(nickAtual);

                const registro = await Usuarios.findOne({ guildId: guild.id, userId: member.id });
                if (!registro) continue;

                if (!contaNoNick && registro.conta && registro.conta !== member.id) continue;

                const contaEsperada = contaNoNick || registro.conta || member.id;

                if (
                    registro.conta === contaEsperada &&
                    registro.nickname === member.nickname
                ) continue;

                await Usuarios.updateOne(
                    { guildId: guild.id, userId: member.id },
                    {
                        $set: {
                            username: member.user.username,
                            nickname: member.nickname ?? member.user.username,
                            conta: contaEsperada,
                            updatedAt: new Date(),
                        },
                    }
                );

                totalContaCorrigida++;
            }

        } catch (err) {
            log.error(`Erro na guild ${chalk.white(guild.name)}: ${err.message}`);
        }
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