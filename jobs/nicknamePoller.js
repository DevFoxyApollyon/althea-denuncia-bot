const chalk = require('chalk');
const Usuarios = require('../models/Usuario');

const INTERVALO_MS = 5 * 60 * 1000;

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[POLLER]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[POLLER]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[POLLER]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[POLLER]')} ${msg}`),
};

async function verificarNicknames(client) {
    const BOT_ALVO_ID = process.env.BOT_ALVO_ID;

    let totalNovos       = 0;
    let totalAtualizados = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            const auditLogs = await guild.fetchAuditLogs({
                limit: 100,
                type:  24,
            });

            const entradasBot = auditLogs.entries
                .filter(entry => {
                    const ehOBot    = entry.executor?.id === BOT_ALVO_ID;
                    const mudouNick = entry.changes?.some(c => c.key === 'nick');
                    return ehOBot && mudouNick;
                })
                .first(30);

            if (!entradasBot.length) continue;

            for (const entry of entradasBot) {
                const userId    = entry.target?.id;
                const nickNovo  = entry.changes?.find(c => c.key === 'nick')?.new ?? null;
                const nickVelho = entry.changes?.find(c => c.key === 'nick')?.old ?? null;

                if (!userId) continue;

                const existente = await Usuarios.findOne({ guildId: guild.id, userId });

                if (existente && existente.nickname === nickNovo) continue;

                const membro   = await guild.members.fetch(userId).catch(() => null);
                const username = membro?.user?.username ?? 'Desconhecido';

                await Usuarios.findOneAndUpdate(
                    { guildId: guild.id, userId },
                    {
                        $set: {
                            username,
                            nickname:  nickNovo,
                            updatedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true }
                );

                if (!existente) {
                    totalNovos++;
                    log.success(
                        `${chalk.white(username)} ${chalk.gray(`(${userId})`)} — novo registro: ${chalk.green(nickNovo ?? 'nenhum')} ${chalk.gray(`| ${guild.name}`)}`
                    );
                } else {
                    totalAtualizados++;
                    log.success(
                        `${chalk.white(username)} ${chalk.gray(`(${userId})`)} — atualizado: ` +
                        `${chalk.red(nickVelho ?? 'nenhum')} ${chalk.gray('→')} ${chalk.green(nickNovo ?? 'nenhum')} ${chalk.gray(`| ${guild.name}`)}`
                    );
                }
            }

        } catch (err) {
            log.error(`Erro na guild ${chalk.white(guild.name)}: ${err.message}`);
        }
    }

    if (totalNovos > 0 || totalAtualizados > 0) {
        log.info(
            `Verificação concluída — ` +
            `${chalk.green(totalNovos + ' novo(s)')} | ` +
            `${chalk.blue(totalAtualizados + ' atualizado(s)')}`
        );
    }
}

function iniciarPoller(client) {
    log.info(chalk.magenta(`Poller iniciado. Verificando a cada ${chalk.bold('5 minutos')}.`));
    verificarNicknames(client);
    setInterval(() => verificarNicknames(client), INTERVALO_MS);
}

module.exports = { iniciarPoller };