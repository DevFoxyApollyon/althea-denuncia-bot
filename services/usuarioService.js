const Usuario = require('../models/Usuario');

async function buscarUsuarioPorApelidoOuId(termo) {
    return await Usuario.findOne({
        $or: [
            { apelido: { $regex: new RegExp(`^${termo}$`, 'i') } },
            { discordId: termo }
        ]
    });
}

async function enviarMensagemPvPorApelidoOuId(client, termo, mensagem) {
    const usuario = await buscarUsuarioPorApelidoOuId(termo);
    if (!usuario) return false;

    try {
        const membro = await client.users.fetch(usuario.discordId);
        await membro.send(mensagem);
        return true;
    } catch (e) {
        if (e.code === 50007) return false; 
        console.error('Erro ao enviar DM:', e); 
        return false;
    }
}

module.exports = {
    buscarUsuarioPorApelidoOuId,
    enviarMensagemPvPorApelidoOuId
};