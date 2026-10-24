// Motivos que disparam o alerta. Os regex rodam sobre o texto sem acento e em minúsculas.
const MOTIVOS_CRITICOS = [
    { nome: 'Zaralho', regex: /\bzaralho\w*/ },
    { nome: 'Dark RP', regex: /\bdark\s*-?\s*rp\b/ },
    { nome: 'Hack', regex: /\bhack\w*/ },
    { nome: 'Mods proibidos', regex: /\bmods?\s+proibid[oa]s?\b/ }
];

function normalizarTexto(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function detectarMotivosCriticos(motivo) {
    const texto = normalizarTexto(motivo);
    return MOTIVOS_CRITICOS.filter((m) => m.regex.test(texto)).map((m) => m.nome);
}

// Ligado por padrão; o responsável desliga no /painel ou no Painel do bot do site.
function alertaMotivoCriticoAtivo(config) {
    return config?.alertaMotivoCritico !== false;
}

// Marca os cargos dentro do tópico da denúncia quando o motivo é crítico.
async function alertarMotivoCritico({ config, thread, motivo }) {
    try {
        if (!alertaMotivoCriticoAtivo(config)) return false;
        const categorias = detectarMotivosCriticos(motivo);
        if (!categorias.length) return false;

        const responsavelAdminId = config?.roles?.responsavel_admin;
        if (!responsavelAdminId) {
            console.warn('[AlertaMotivo] Cargo responsavel_admin não configurado; não foi possível marcar.');
            return false;
        }

        await thread.send({
            content: `<@&${responsavelAdminId}>`,
            allowedMentions: { roles: [responsavelAdminId] }
        });

        return true;
    } catch (err) {
        console.error('[AlertaMotivo] Erro ao enviar alerta:', err);
        return false;
    }
}

module.exports = { alertarMotivoCritico, alertaMotivoCriticoAtivo, detectarMotivosCriticos };