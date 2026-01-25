const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags 
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
    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        }

        const config = await getCachedConfig(interaction.guild.id, Config);
        const denunciante = interaction.fields.getTextInputValue('denunciante_input');
        const acusado = interaction.fields.getTextInputValue('acusado_input');
        const motivo = interaction.fields.getTextInputValue('motivo_input');
        const provas = interaction.fields.getTextInputValue('provas_input') || 'Tópico';

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

module.exports = {
    handleDenunciaCommand,
    handleDenunciaSubmit,
    handleDenunciaButtons,
    handleDenunciaModals: async (interaction) => {
        const { customId } = interaction;
        if (customId === 'modal_logmessageid_para_correcao_aceite') return await handleModalLogMessageIdCorrecaoAceite(interaction);
        if (customId.startsWith('salvar_correcao_aceite_')) return await handleSalvarCorrecaoAceite(interaction);
    }
};