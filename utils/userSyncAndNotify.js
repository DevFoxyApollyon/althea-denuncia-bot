// utils/userSyncAndNotify.js

const Usuario = require('../models/Usuario');
const { CODIGOS_ESPERADOS, dmPausada, registrarErroDeDM } = require('./dmSegura');

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
                if (match) {
                    conta = match[1];
                } else {
                    conta = userId; // fallback para userId se não encontrar número
                }
            } else {
                conta = userId; // fallback para userId se não houver nickname
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
    // Durante um bloqueio de DMs pelo Discord, o bot não insiste.
    if (dmPausada()) return false;
    try {
        // Busca por userId OU conta (número ou userId)
        const usuario = await Usuario.findOne({
            guildId,
            $or: [
                { userId: acusadoId },
                { conta: acusadoId }
            ]
        }); 
        if (!usuario) return false;
        // Garante que vai buscar o userId correto para enviar DM
        const user = await client.users.fetch(usuario.userId);
        if (!user) return false;
        await user.send(mensagem);
        return true;
    } catch (e) {
        registrarErroDeDM(e);
        if (e.code !== 50001 && !CODIGOS_ESPERADOS.includes(e.code)) {
            console.warn('Não foi possível notificar acusado no PV:', e.message);
        }
        return false;
    }
}

module.exports = {
    syncUserOnNicknameChange,
    notificarAcusadoPv
};
