const { MessageFlags } = require('discord.js');
const { getConfig } = require('./configCache');
const Denuncia = require('../models/Denuncia');
const dateUtils = require('./dateUtils');
const { usuarioIsento } = require('./usuariosIsentos');

const MAX_LINKS = 5;

// Se true, usuários em usuarioIsento() podem reivindicar mesmo com pendentes anteriores.
// Deixado em false para o bloqueio valer para todos (inclusive em testes feitos por contas isentas).
const ISENTOS_PODEM_BURLAR = false;

const LOG = (msg) => console.log(`[BloqueioReivindicar] ${msg}`);

function linkDoTopico(d) {
    return d.threadId
        ? `https://discord.com/channels/${d.guildId}/${d.threadId}`
        : `https://discord.com/channels/${d.guildId}/${d.channelId}/${d.messageId}`;
}

/**
 * Procura denúncias MAIS ANTIGAS, do mesmo canal, que continuam pendentes e sem reivindicação.
 * Retorna null se a denúncia atual não existe, já foi reivindicada, ou se não há pendente anterior.
 */
async function buscarPendentesAnteriores(interaction) {
    const atual = await Denuncia.findOne({
        guildId: interaction.guild.id,
        threadId: interaction.channelId
    })
        .select('_id guildId channelId dataCriacao claimedBy reivindicadoPor')
        .lean();

    if (!atual?.dataCriacao) {
        LOG(`Nenhuma denúncia encontrada para o tópico ${interaction.channelId}; liberado.`);
        return null; // botão fora de um tópico de denúncia
    }
    if (atual.claimedBy || atual.reivindicadoPor) {
        LOG('Denúncia atual já estava reivindicada; liberado.');
        return null;
    }

    const filtro = {
        guildId: atual.guildId,
        channelId: atual.channelId,
        _id: { $ne: atual._id },
        status: 'pendente',
        // não reivindicada = campo ausente, null ou string vazia
        claimedBy: { $in: [null, ''] },
        reivindicadoPor: { $in: [null, ''] },
        dataCriacao: { $lt: atual.dataCriacao }
    };

    const [total, lista] = await Promise.all([
        Denuncia.countDocuments(filtro),
        Denuncia.find(filtro)
            .sort({ dataCriacao: 1 }) // mais antigas primeiro
            .limit(MAX_LINKS)
            .select('guildId channelId messageId threadId acusado dataCriacao')
            .lean()
    ]);

    return total ? { total, lista } : null;
}

/**
 * Chame ANTES de processar o botão "reivindicar".
 * Retorna true se a reivindicação foi bloqueada (e o usuário já foi avisado); false se pode seguir.
 * Em caso de erro na consulta, libera a reivindicação (não trava o atendimento por falha técnica).
 */
async function bloquearReivindicacaoSeHouverPendentes(interaction) {
    let pendentes;
    try {
        if (!interaction.guild) return false;
        const config = await getConfig(interaction.guild.id);
        if (config?.bloquearReivindicacaoComPendentes === false) return false;

        if (ISENTOS_PODEM_BURLAR && await usuarioIsento(interaction.user.id)) {
            LOG('Usuário isento; liberado.');
            return false;
        }

        pendentes = await buscarPendentesAnteriores(interaction);
        if (!pendentes) return false;
    } catch (err) {
        console.warn('[BloqueioReivindicar] Falha ao verificar pendentes; liberando reivindicação:', err);
        return false;
    }

    const { total, lista } = pendentes;
    const plural = total > 1;
    const linhas = lista.map(
        (d, i) =>
            `**${i + 1}.** ${linkDoTopico(d)} — acusado \`${d.acusado || '?'}\` • ${dateUtils.getDiscordTimestamp(d.dataCriacao, 'R')}`
    );
    const resto = total - lista.length;

    const content = [
        '🚫 **Você não pode reivindicar esta denúncia ainda.**',
        `Há **${total}** denúncia${plural ? 's' : ''} mais antiga${plural ? 's' : ''} ainda pendente${plural ? 's' : ''} e sem reivindicação neste canal. Atenda ${plural ? 'as mais antigas' : 'a mais antiga'} primeiro:`,
        '',
        ...linhas,
        resto > 0 ? `… e mais **${resto}**.` : null
    ]
        .filter((l) => l !== null)
        .join('\n');

    try {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch (err) {
        console.warn('[BloqueioReivindicar] Não foi possível enviar o aviso de bloqueio:', err.message);
    }

    LOG(`${interaction.user.id} BLOQUEADO: ${total} pendente(s) anterior(es).`);
    return true;
}

module.exports = { buscarPendentesAnteriores, bloquearReivindicacaoSeHouverPendentes };