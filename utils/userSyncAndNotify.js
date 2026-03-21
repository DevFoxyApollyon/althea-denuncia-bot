// utils/userSyncAndNotify.js

const Usuario = require('../models/Usuario');

async function syncUserOnNicknameChange(oldMember, newMember) {
    try {
        if (oldMember.nickname !== newMember.nickname) {
            const guildId = newMember.guild.id;
            const userId = newMember.id;
            const username = newMember.user.username;
            const nickname = newMember.nickname || null;

            let conta = null;
            if (nickname) {
                const match = nickname.match(/(\d{3,})$/);
                if (match) conta = match[1];
            }

            await Usuario.findOneAndUpdate(
                { guildId, userId },
                { $set: { username, nickname, conta, updatedAt: new Date() } },
                { upsert: true, new: true }
            );
        }
    } catch (e) {
        console.warn('Não foi possível atualizar nick do usuário:', e.message);
    }
}

async function notificarAcusadoPv(client, guildId, acusadoId, mensagem) {
    try {
        const usuario = await Usuario.findOne({
            guildId,
            $or: [
                { userId: acusadoId },
                { conta: acusadoId }
            ]
        });
        if (!usuario) return false;

        const user = await client.users.fetch(usuario.userId);
        await user.send(mensagem);
        return true;
    } catch (e) {
        if (e.code === 50007) return false; 
        console.warn('Não foi possível notificar acusado no PV:', e.message);
        return false;
    }
}

module.exports = {
    syncUserOnNicknameChange,
    notificarAcusadoPv
};