const chalk = require('chalk');
const Usuarios = require('../models/Usuario');
const { syncUserOnNicknameChange } = require('../utils/userSyncAndNotify');
const { extrairContaDoNickname } = require('../utils/nickUtils');

function registerMemberEvents(client, log) {
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            await syncUserOnNicknameChange(oldMember, newMember);

            if (oldMember.nickname === newMember.nickname) return;

            let entry = null;
            for (let tentativa = 0; tentativa < 3; tentativa++) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (tentativa + 1)));

                const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 5, type: 24 });

                entry = auditLogs.entries.find(item =>
                    item.target?.id === newMember.user.id &&
                    item.executor?.id === process.env.BOT_ALVO_ID &&
                    Date.now() - item.createdTimestamp < 15000
                );

                if (entry) break;
            }

            if (!entry) return;

            const nickAtual = newMember.nickname || newMember.user.username;
            const contaExtraida = extrairContaDoNickname(nickAtual);

            const setPayload = {
                username: newMember.user.username,
                nickname: newMember.nickname,
                updatedAt: new Date(),
            };
            if (contaExtraida) setPayload.conta = contaExtraida;

            await Usuarios.findOneAndUpdate(
                { guildId: newMember.guild.id, userId: newMember.user.id },
                { $set: setPayload },
                { upsert: true, new: true }
            );

            log.success(
                `${chalk.white(newMember.user.username)} ${chalk.gray(`(${newMember.user.id})`)} — nickname registrado: ` +
                `${chalk.red(oldMember.nickname ?? 'nenhum')} ${chalk.gray('→')} ${chalk.green(newMember.nickname ?? 'nenhum')}` +
                (contaExtraida ? chalk.gray(` | conta: ${contaExtraida}`) : '') +
                chalk.gray(` | ${newMember.guild.name}`)
            );
        } catch (error) {
            if (error.code === 50278) return;
            log.warn('Erro ao sincronizar nickname: ' + error.message);
        }
    });

    client.on('guildMemberAdd', async member => {
        try {
            const usuario = await Usuarios.findOne({
                guildId: member.guild.id,
                userId: member.user.id,
            });

            if (!usuario?.nickname) return;

            await member.setNickname(usuario.nickname, 'Nickname restaurado automaticamente');

            log.success(
                `${chalk.white(member.user.username)} ${chalk.gray(`(${member.user.id})`)} — nickname restaurado: ${chalk.green(usuario.nickname)} ${chalk.gray(`| ${member.guild.name}`)}`
            );
        } catch (error) {
            if (error.code === 50013) {
                log.warn(`Sem permissão para restaurar nickname de ${member.user.username} em ${member.guild.name}`);
                return;
            }
            log.error(`Erro ao restaurar nickname: ${error.message}`);
        }
    });
}

module.exports = { registerMemberEvents };
