const { 
    ButtonBuilder, 
    ActionRowBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    EmbedBuilder 
} = require('discord.js');

const Config = require('../models/Config');
const Denuncia = require('../models/Denuncia');
const { getBrasiliaDateTime } = require('../utils/dateUtils');
const { handleDenunciaSubmit } = require('../commands/denuncia');

// =======================================================================
// --- CONFIGURAÇÕES E SISTEMA DE CACHE ---
// =======================================================================

let configCache = {
    data: null,
    timestamp: null,
    guildId: null
};

const CACHE_DURATION = 300000; // 5 minutos
// Reduzido para 5 para garantir que o texto de 5 denúncias não estoure 6000 caracteres
const DENUNCIAS_PER_EMBED = 5; 

/**
 * Obtém as configurações do servidor. Usa cache para não sobrecarregar o MongoDB.
 */
async function getConfig(guildId) {
    try {
        const now = Date.now();
        if (configCache.data && configCache.guildId === guildId && (now - configCache.timestamp) < CACHE_DURATION) {
            return configCache.data;
        }

        const config = await Config.findOne({ guildId: guildId });
        if (!config) throw new Error('❌ Configurações não encontradas.');

        configCache = { data: config, timestamp: now, guildId: guildId };
        return config;
    } catch (error) {
        console.error(`❌ Erro ao buscar configurações [${getBrasiliaDateTime()}]:`, error);
        throw error;
    }
}

// =======================================================================
// --- CRIAÇÃO DA INTERFACE (BOTÕES) ---
// =======================================================================

function createDenunciaButtons() {
    // Botão para quem joga no PC
    const pcButton = new ButtonBuilder()
        .setCustomId('denuncia_pc')
        .setLabel('Denúncia PC')
        .setStyle(ButtonStyle.Primary);

    // Botão para quem joga no Mobile
    const mobileButton = new ButtonBuilder()
        .setCustomId('denuncia_mobile')
        .setLabel('Denúncia Mobile')
        .setStyle(ButtonStyle.Success);

    // Botão de consulta de histórico
    const myDenunciasButton = new ButtonBuilder()
        .setCustomId('minhas_denuncias')
        .setLabel('Minhas Denúncias')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📋');

    return new ActionRowBuilder().addComponents(pcButton, mobileButton, myDenunciasButton);
}

// =======================================================================
// --- SISTEMA DE CONSULTA (HISTÓRICO) ---
// =======================================================================

/**
 * Abre o modal de busca quando o usuário clica em "Minhas Denúncias"
 */
async function handleMyDenunciasButton(interaction) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('consulta_denuncias_modal')
            .setTitle('🔍 Consultar Denúncias por ID');

        const idInput = new TextInputBuilder()
            .setCustomId('id_consulta_input')
            .setLabel('ID do Jogador/Denunciante (Separe com , ou +)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 1921 ou ID Discord')
            .setRequired(true)
            .setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput));
        await interaction.showModal(modal);
    } catch (error) {
        console.error(`❌ Erro ao abrir modal de consulta:`, error);
    }
}

/**
 * Processa a busca no banco de dados e exibe os resultados (Mesmo as sem status)
 */
async function handleConsultaModalSubmit(interaction) {
    try {
        // Avisa ao Discord que a resposta vai demorar (evita erro de 3 segundos)
        await interaction.deferReply({ flags: 64 });

        const rawIds = interaction.fields.getTextInputValue('id_consulta_input').trim();
        
        // Trata os IDs recebidos para busca
        const idsToSearch = rawIds.replace(/\s*[+,|]\s*/g, ' ').split(/\s+/).filter(id => id.length > 0);

        if (idsToSearch.length === 0) {
            return await interaction.editReply({ content: '❌ Forneça pelo menos um ID válido.' });
        }

        // Busca denúncias relacionadas ao ID (como autor, acusado ou punido)
        const orQuery = [
            { criadoPor: { $in: idsToSearch } },
            { acusado: { $in: idsToSearch } },
        ];

        idsToSearch.forEach(id => {
            orQuery.push({ acusadoId: { $regex: new RegExp(`(^|\\s)${id}(\\s|$)`) } });
        });

        // Traz TODAS as denúncias (não filtramos status aqui para mostrar as pendentes)
        const allDenuncias = await Denuncia.find({
            guildId: interaction.guild.id,
            $or: orQuery
        }).sort({ dataCriacao: -1 });

        if (allDenuncias.length === 0) {
            return await interaction.editReply({
                content: `✅ Nenhuma denúncia (pendente ou finalizada) encontrada para os IDs: \`${idsToSearch.join(', ')}\`.`,
            });
        }

        const responseEmbeds = [];
        const total = allDenuncias.length;

        // Monta os embeds de resultado
        for (let i = 0; i < total && responseEmbeds.length < 5; i += DENUNCIAS_PER_EMBED) {
            const chunk = allDenuncias.slice(i, i + DENUNCIAS_PER_EMBED);
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`🔍 Resultados da Consulta (${i + 1} de ${total})`)
                .setTimestamp();

            chunk.forEach((d) => {
                // Lógica de Status: Se não tiver status definido, assume-se que é Pendente (Lupa)
                let statusEmoji = '🔍'; 
                let statusNome = 'PENDENTE / EM ANÁLISE';

                if (d.status === 'aceita') { statusEmoji = '✅'; statusNome = 'ACEITA'; }
                if (d.status === 'recusada') { statusEmoji = '❌'; statusNome = 'RECUSADA'; }

                // Truncagem de segurança para evitar o erro 50035 (Embed Size)
                const motivoOriginal = (d.status === 'aceita' && d.motivoAceite) ? d.motivoAceite : (d.motivo || 'N/A');
                const motivoFinal = motivoOriginal.length > 150 ? motivoOriginal.substring(0, 150) + '...' : motivoOriginal;

                const linkOriginal = `https://discord.com/channels/${d.guildId}/${d.channelId}/${d.messageId}`;

                embed.addFields({
                    name: `${statusEmoji} Denúncia #${d._id.toString().substring(0, 8)} [${statusNome}]`,
                    value: `**Denunciante:** <@${d.criadoPor}> (\`${d.denunciante || '?'}\`)\n` +
                           `**Acusado:** \`${d.acusado || '?'}\`\n` +
                           `**Motivo:** ${motivoFinal}\n` +
                           `**Link:** [Ver Mensagem](${linkOriginal})`
                });
            });

            responseEmbeds.push(embed);
        }

        await interaction.editReply({ embeds: responseEmbeds });

    } catch (error) {
        console.error(`❌ Erro no modal de consulta:`, error);
        await interaction.editReply({ content: '❌ Erro ao consultar o banco de dados.' });
    }
}

// =======================================================================
// --- SISTEMA DE CRIAÇÃO DE DENÚNCIAS (PC/MOBILE) ---
// =======================================================================

/**
 * Função unificada para abrir modais de denúncia, evitando repetição de código.
 */
async function openDenunciaModal(interaction, platform) {
    try {
        const modal = new ModalBuilder()
            .setCustomId(platform === 'PC' ? 'denuncia_pc_modal' : 'denuncia_mobile_modal')
            .setTitle(`Formulário de Denúncia - ${platform}`);

        // Define os limites baseados na plataforma (mantendo seus valores originais)
        const limits = platform === 'PC' ? { acusado: 70, motivo: 150, provas: 500 } : { acusado: 120, motivo: 200, provas: 1000 };

        const denuncianteInput = new TextInputBuilder()
            .setCustomId('denunciante_input').setLabel('ID do Denunciante').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);

        const acusadoInput = new TextInputBuilder()
            .setCustomId('acusado_input').setLabel('ID do Acusado').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(limits.acusado);

        const motivoInput = new TextInputBuilder()
            .setCustomId('motivo_input').setLabel('Motivo da Denúncia').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(limits.motivo);

        const provasInput = new TextInputBuilder()
            .setCustomId('provas_input').setLabel('Provas (Links)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(limits.provas);

        modal.addComponents(
            new ActionRowBuilder().addComponents(denuncianteInput),
            new ActionRowBuilder().addComponents(acusadoInput),
            new ActionRowBuilder().addComponents(motivoInput),
            new ActionRowBuilder().addComponents(provasInput)
        );

        // Resposta imediata obrigatória
        await interaction.showModal(modal);

        // Verificação de permissão após mostrar o modal (log de segurança)
        const config = await getConfig(interaction.guild.id);
        const roleRequired = platform === 'PC' ? config.roles.pc : config.roles.permitido;
        if (!config || !interaction.member.roles.cache.has(roleRequired)) {
            console.warn(`⚠️ Usuário ${interaction.user.tag} iniciou denúncia ${platform} sem permissão.`);
        }
    } catch (error) {
        console.error(`❌ Erro ao abrir modal ${platform}:`, error.message);
    }
}

// Funções chamadas pelos botões
async function handleDenunciaPC(interaction) { await openDenunciaModal(interaction, 'PC'); }
async function handleDenunciaMobile(interaction) { await openDenunciaModal(interaction, 'Mobile'); }

/**
 * Envia os dados coletados no modal para o comando de processamento
 */
async function handleModalSubmit(interaction, platform) {
    try {
        await handleDenunciaSubmit(interaction, platform);
    } catch (error) {
        console.error(`❌ Erro ao processar submissão:`, error.message);
        const msg = { content: '❌ Erro ao processar sua denúncia.', flags: 64 };
        if (!interaction.replied && !interaction.deferred) await interaction.reply(msg);
        else await interaction.editReply(msg);
    }
}

// =======================================================================
// --- EXPORTAÇÃO ---
// =======================================================================

module.exports = {
    createDenunciaButtons,
    handleDenunciaPC,
    handleDenunciaMobile,
    handleModalSubmit,
    handleMyDenunciasButton,
    handleConsultaModalSubmit
};