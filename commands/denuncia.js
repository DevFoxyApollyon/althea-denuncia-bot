const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { garantirAvisoNoTopo } = require('../Handlers/leiaAvisoHandler');
const Denuncia = require('../models/Denuncia'); 
const Config = require('../models/Config'); 
const { getCachedConfig } = require('../utils/performance');
const { handleExportButton } = require('../Handlers/exportDenuncia'); 
const { handleClaimButton } = require('../Handlers/handlerStatusButton'); 
const dateUtils = require('../utils/dateUtils'); 

const { 
    handleInputIdLogAceite, 
    handleModalLogMessageIdCorrecaoAceite, 
    handleEditarAceiteModal, 
    handleConfirmarCorrecaoAceite, 
    handleSalvarCorrecaoAceite 
} = require('./correcao'); 

require('dotenv').config();

const BUTTON_REFRESH_INTERVAL = 1800000;
const SUPORTE_BOT_ID = process.env.SUPORTE_BOT_ID;

// --- COMPONENTES ---

function createStatusButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reivindicar').setLabel('Reivindicar').setEmoji('📝').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('analiser').setLabel('Analisar').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('aceitar').setLabel('Aceitar').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('recusar').setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('finalizar_denuncia').setLabel('Finalizar').setEmoji('📦').setStyle(ButtonStyle.Secondary)
    );
}

function createDenunciaButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('denuncia_pc').setLabel('Denúncia PC').setEmoji('💻').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('denuncia_mobile').setLabel('Denúncia Mobile').setEmoji('📱').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('minhas_denuncias').setLabel('Minhas Denúncias').setEmoji('📋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('abrir_input_id_log_aceite').setLabel('Correção').setEmoji('🛠️').setStyle(ButtonStyle.Danger)
    );
}

// --- COMANDO PRINCIPAL (!denuncia) ---

async function handleDenunciaCommand(message) {
    try {
        const config = await getCachedConfig(message.guild.id, Config);
        const hasPerm = message.member.roles.cache.has(config.roles.responsavel_admin);
        
        if (!hasPerm && message.author.id !== SUPORTE_BOT_ID) return message.reply('❌ Sem permissão.');

        const embedDesc = [
            '### Faça sua Denúncia',
            'Para realizar a sua denúncia, você deverá apertar no botão abaixo de acordo com o seu dispositivo, lembrando que:',
            '• É obrigatório estar com o Discord autenticado com o jogo',
            '• Após o envio da Denúncia, você **NÃO** poderá apagar',
            '• Caso seja constatado que foi apagada alguma prova, você poderá tomar punição',
            '• O mal uso das denúncias resultará em punição',
            '',
            '### Regras do Tópico:',
            '• O tópico é exclusivo para denúncia e contra-prova',
            '• Conversas paralelas resultarão em punição',
            '• Apagar mensagens ou provas resultará em punição',
            '• Todas as mensagens apagadas serão registradas',
            '',
            '### Sobre as Provas em Vídeo:',
            '• É recomendado enviar vídeos pelo YouTube',
            '• O vídeo deve mostrar claramente a infração',
            '• Você pode deixar o vídeo como "não listado"',
            '• Links de outros sites podem não funcionar',
            '',
            '### Como enviar provas:',
            '**Opção 1 - No formulário:**',
            '1. Faça upload do vídeo no YouTube',
            '2. Copie o link do vídeo',
            '3. Cole o link no campo "Provas" da denúncia',
            '**Opção 2 - No tópico:**',
            '1. Envie sua denúncia normalmente',
            '2. Aguarde o tópico ser criado',
            '3. Envie suas provas (vídeos/imagens) diretamente no tópico',
            '',
            '### Tutorial:',
            'Confira nosso tutorial detalhado aqui: https://www.instagram.com/p/DPcEkcHlHDe/',
            '',
            `🕒 **Horário de Brasília:** \`${dateUtils.getBrasiliaTime()}\``
        ].join('\n');

        const denunciaEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🛡️ Sistema de Denúncias')
            .setDescription(embedDesc)
            .setFooter({ text: 'Brasil RolePlay' });

        const sentMessage = await message.channel.send({
            embeds: [denunciaEmbed],
            components: [createDenunciaButtons()]
        });

        setTimeout(() => refreshButtons(sentMessage, [denunciaEmbed]), BUTTON_REFRESH_INTERVAL);
    } catch (error) { console.error(error); }
}

// --- SUBMIT DA DENÚNCIA ---

async function handleDenunciaSubmit(interaction, platform) {
    // Atualiza apenas o nick do usuário denunciante no banco secundário se mudou
    try {
        const Usuario = require('../models/Usuario');
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const nickname = interaction.member?.nickname || null;
        // Pega o valor digitado no input do denunciante
        const denuncianteInput = interaction.fields.getTextInputValue('denunciante_input');
        let conta = null;
        if (nickname) {
            const match = nickname.match(/(\d{3,})$/);
            if (match) conta = match[1];
        }
        // Se não achou no nickname, usa o input do formulário
        if (!conta && denuncianteInput) conta = denuncianteInput;
        // Busca registro existente
        const existing = await Usuario.findOne({ guildId, userId });
        if (!existing || existing.username !== username || existing.nickname !== nickname || existing.conta !== conta) {
            await Usuario.findOneAndUpdate(
                { guildId, userId },
                { $set: { username, nickname, conta, updatedAt: new Date() } },
                { upsert: true, new: true }
            );
        }
    } catch (e) {
        console.warn('Não foi possível registrar/atualizar nick do denunciante:', e.message);
    }
    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        }

        const config = await getCachedConfig(interaction.guild.id, Config);

        const denunciante = interaction.fields.getTextInputValue('denunciante_input');
        const acusado = interaction.fields.getTextInputValue('acusado_input');
        const motivo = interaction.fields.getTextInputValue('motivo_input');
        let provas = interaction.fields.getTextInputValue('provas_input') || 'Tópico';

        if (provas && provas !== 'Tópico') {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = provas.match(urlRegex);
            if (links) {
                const allowedDomains = [
                    'youtube.com/',
                    'youtu.be/',
                    'discord.com/',
                    'discord.gg/',
                    'discordapp.com/',
                    'cdn.discordapp.com/',
                    'ptb.discord.com/',
                    'canary.discord.com/',
                    'discord.media/',
                    'media.discordapp.net/'
                ];
                const allAllowed = links.every(link =>
                    allowedDomains.some(domain => link.includes(domain))
                );
                if (!allAllowed) {
                    return await interaction.editReply({
                        content: '❌ Só são permitidos links do YouTube ou dos domínios oficiais do Discord no campo Provas.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            }
        }

        const channelId = platform === 'PC' ? config.channels.pc : config.channels.mobile;
        const channel = interaction.client.channels.cache.get(channelId);

        // Texto que será enviado em ambos os lugares
        const textoDenuncia = [
            `|| ${interaction.user} ||`,
            `➱ **Denunciante**: \`${denunciante}\``,
            `➱ **Acusado**: \`${acusado}\``,
            `➱ **Motivo**: \`${motivo}\``,
            `➱ **Prova(s)**: ${provas}`
        ].join('\n');

        // 1. Envia no canal principal
        const mainMessage = await channel.send({
            content: textoDenuncia,
            allowedMentions: { parse: ['users'] }
        });

        // 2. Abre o tópico na mensagem acima
        const thread = await mainMessage.startThread({
            name: `Denúncia: ${denunciante}`,
            autoArchiveDuration: 1440
        });

        // 3. Envia os mesmos dados dentro do tópico
        await thread.send({
            content: textoDenuncia
        });

        // 4. Envia os botões de status/ação dentro do tópico
        await thread.send({ components: [createStatusButtons()] });

        // Atualiza o usuário com o último threadId criado
        try {
            const Usuario = require('../models/Usuario');
            await Usuario.findOneAndUpdate(
                { guildId: interaction.guild.id, userId: interaction.user.id },
                { $set: { ultimoThreadId: thread.id, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (e) {
            console.warn('Não foi possível atualizar o último threadId do usuário:', e.message);
        }


        // Salva no Banco de Dados
        await new Denuncia({
            guildId: interaction.guild.id,
            messageId: mainMessage.id,
            channelId: channel.id,
            threadId: thread.id,
            denunciante, acusado, motivo, provas, platform,
            criadoPor: interaction.user.id,
            status: 'pendente',
            dataCriacao: dateUtils.getBrasiliaDate() 
        }).save();

        // Envia mensagem privada ao acusado, se encontrado no banco de usuários
        try {
            const { notificarAcusadoPv } = require('../utils/userSyncAndNotify');
            const denunciaLink = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${mainMessage.id}`;
            const mensagemDetalhada = [
                `⚠️ **Você foi denunciado no servidor ${interaction.guild.name}!**`,
                '',
                `**Denunciante:** ${denunciante}`,
                `**Motivo:** ${motivo}`,
                `**Provas:** ${provas}`,
                '',
                `${denunciaLink}`,
                '',
                'Se você acredita que esta denúncia é injusta, responda no tópico da denúncia com as contras provas ou aguarde a análise da equipe.'
            ].join('\n');
            await notificarAcusadoPv(
                interaction.client,
                interaction.guild.id,
                acusado,
                mensagemDetalhada
            );
        } catch (e) {
            console.warn('Não foi possível notificar acusado no PV:', e.message);
        }

        // Envia o aviso e limpa os antigos em background
        await garantirAvisoNoTopo(channel, interaction.channelId);
        
        await interaction.editReply({ 
            content: `✅ Denúncia criada em ${thread} às ${dateUtils.getBrasiliaTime()}` 
        });

    } catch (error) { console.error(error); }
}

// --- REFRESH E EVENTOS DE BOTÃO ---

async function refreshButtons(message, embeds) {
    try {
        await message.edit({ embeds: embeds, components: [createDenunciaButtons()] });
        setTimeout(() => refreshButtons(message, embeds), BUTTON_REFRESH_INTERVAL);
    } catch (error) {}
}

async function handleDenunciaButtons(interaction, client) {
    try {
        if (!interaction.isButton()) return;
        const { customId, user } = interaction;

        if (customId === 'minhas_denuncias') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const logs = await Denuncia.find({ criadoPor: user.id }).sort({ dataCriacao: -1 }).limit(10);
            const desc = logs.map((d, i) => `**${i+1}.** \`${d.status}\` - ${d.acusado} (${dateUtils.getDiscordTimestamp(d.dataCriacao, 'R')})`).join('\n');
            return await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📋 Suas Denúncias').setDescription(desc || 'Nenhuma denúncia encontrada.')] });
        }

        if (customId === 'reivindicar') return await handleClaimButton(interaction);
        if (customId === 'finalizar_denuncia') return await handleExportButton(interaction);
        if (customId === 'abrir_input_id_log_aceite') return await handleInputIdLogAceite(interaction);

        const denuncia = await Denuncia.findOne({ threadId: interaction.channel.id });
        if (!denuncia) return;

        const time = dateUtils.getBrasiliaTime();
        if (customId === 'analiser') {
            await interaction.channel.send(`🔎 **Status:** Em análise por <@${user.id}> às ${time}`);
            denuncia.status = 'analise';
        } else if (customId === 'aceitar') {
            await interaction.channel.send(`✅ **Status:** Denúncia Aceita por <@${user.id}> às ${time}`);
            denuncia.status = 'aceita';
        } else if (customId === 'recusar') {
            await interaction.channel.send(`❌ **Status:** Denúncia Recusada por <@${user.id}> às ${time}`);
            denuncia.status = 'recusada';
        }
        
        await denuncia.save();
        if (['analiser', 'aceitar', 'recusar'].includes(customId)) {
            await interaction.reply({ content: 'Status atualizado.', flags: [MessageFlags.Ephemeral] });
        }

    } catch (error) { console.error(error); }
}

// --- HANDLERS DO MODAL DE DENÚNCIA (MOVIDO DE denunciaButtons.js) ---

/**
 * Abre o modal para denúncia no PC
 */
async function handleDenunciaPC(interaction) {
    // Verifica permissão antes de abrir o modal
    const config = await getCachedConfig(interaction.guild.id, Config);
    const roleRequired = config.roles.pc;
    if (!roleRequired || !interaction.member.roles.cache.has(roleRequired)) {
        return interaction.reply({ content: `❌ Você não tem permissão para usar o botão de denúncia PC. É necessário o cargo <@&${roleRequired}>.`, flags: [MessageFlags.Ephemeral] });
    }
    await openDenunciaModal(interaction, 'PC');
}

/**
 * Abre o modal para denúncia no Mobile
 */
async function handleDenunciaMobile(interaction) {
    // Verifica permissão antes de abrir o modal
    const config = await getCachedConfig(interaction.guild.id, Config);
    const roleRequired = config.roles.permitido;
    if (!roleRequired || !interaction.member.roles.cache.has(roleRequired)) {
        return interaction.reply({ content: `❌ Você não tem permissão para usar o botão de denúncia Mobile. É necessário o cargo <@&${roleRequired}>.`, flags: [MessageFlags.Ephemeral] });
    }
    await openDenunciaModal(interaction, 'Mobile');
}

/**
 * Função unificada para abrir modais de denúncia
 */
async function openDenunciaModal(interaction, platform) {
    try {
        const modal = new ModalBuilder()
            .setCustomId(platform === 'PC' ? 'denuncia_pc_modal' : 'denuncia_mobile_modal')
            .setTitle(`Formulário de Denúncia - ${platform}`);

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

        await interaction.showModal(modal);
    } catch (error) {
        console.error(`❌ Erro ao abrir modal ${platform}:`, error.message);
    }
}

/**
 * Processa o submit do modal de denúncia
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

/**
 * Abre o modal de consulta de denúncias
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
 * Processa a consulta de denúncias por ID
 */
async function handleConsultaModalSubmit(interaction) {
    let deferred = false;
    try {
        // Defer a resposta imediatamente
        await interaction.deferReply({ flags: 64 });
        deferred = true;

        const rawIds = interaction.fields.getTextInputValue('id_consulta_input').trim();
        const idsToSearch = rawIds.replace(/\s*[+,|]\s*/g, ' ').split(/\s+/).filter(id => id.length > 0);

        if (idsToSearch.length === 0) {
            return await interaction.editReply({ content: '❌ Forneça pelo menos um ID válido.' });
        }

        const orQuery = [
            { criadoPor: { $in: idsToSearch } },
            { acusado: { $in: idsToSearch } },
        ];

        idsToSearch.forEach(id => {
            orQuery.push({ acusadoId: { $regex: new RegExp(`(^|\\s)${id}(\\s|$)`) } });
        });

        // Adiciona timeout de 10 segundos à consulta
        const allDenuncias = await Promise.race([
            Denuncia.find({
                guildId: interaction.guild.id,
                $or: orQuery
            }).sort({ dataCriacao: -1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Consulta expirou (timeout)')), 10000))
        ]);

        if (allDenuncias.length === 0) {
            return await interaction.editReply({
                content: `✅ Nenhuma denúncia (pendente ou finalizada) encontrada para os IDs: \`${idsToSearch.join(', ')}\`.`,
            });
        }

        const responseEmbeds = [];
        const total = allDenuncias.length;
        const DENUNCIAS_PER_EMBED = 5;

        for (let i = 0; i < total && responseEmbeds.length < 5; i += DENUNCIAS_PER_EMBED) {
            const chunk = allDenuncias.slice(i, i + DENUNCIAS_PER_EMBED);
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`🔍 Resultados da Consulta de denuncias total de: ${total}`)
                .setTimestamp();

            chunk.forEach((d) => {
                let statusEmoji = '🔍';
                let statusNome = 'PENDENTE / EM ANÁLISE';

                if (d.status === 'aceita') { statusEmoji = '✅'; statusNome = 'ACEITA'; }
                if (d.status === 'recusada') { statusEmoji = '❌'; statusNome = 'RECUSADA'; }

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
        
        // Só tenta responder se não foi respondida ainda
        if (!deferred) {
            try {
                await interaction.reply({ content: '❌ Erro ao consultar o banco de dados.', flags: 64 });
            } catch (replyError) {
                console.error('❌ Não foi possível responder à interação:', replyError.code);
            }
        } else {
            try {
                await interaction.editReply({ content: '❌ Erro ao consultar o banco de dados.' });
            } catch (editError) {
                console.error('❌ Não foi possível editar a resposta:', editError.code);
            }
        }
    }
}

module.exports = {
    handleDenunciaCommand,
    handleDenunciaSubmit,
    handleDenunciaButtons,
    handleDenunciaPC,
    handleDenunciaMobile,
    handleModalSubmit,
    handleMyDenunciasButton,
    handleConsultaModalSubmit,
    handleDenunciaModals: async (interaction) => {
        const { customId } = interaction;
        if (customId === 'modal_logmessageid_para_correcao_aceite') return await handleModalLogMessageIdCorrecaoAceite(interaction);
        if (customId.startsWith('salvar_correcao_aceite_')) return await handleSalvarCorrecaoAceite(interaction);
    }
};