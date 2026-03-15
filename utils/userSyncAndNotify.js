// utils/userSyncAndNotify.js
// Atualiza o banco de usuários ao trocar nickname e notifica acusados registrados

const Usuario = require('../models/Usuario');

/**
 * Atualiza o registro do usuário no banco quando o nickname muda
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
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

/**
 * Notifica o acusado no PV se ele estiver registrado no banco
 * @param {Client} client - Instância do bot
 * @param {string} guildId
 * @param {string} acusadoId - ID do acusado (userId)
 * @param {string} mensagem - Mensagem a ser enviada
 * @returns {Promise<boolean>} true se notificado, false se não
 */
async function notificarAcusadoPv(client, guildId, acusadoId, mensagem) {
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
        console.warn('Não foi possível notificar acusado no PV:', e.message);
        return false;
    }
}

module.exports = {
    syncUserOnNicknameChange,
    notificarAcusadoPv
};
