const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder
} = require('discord.js');

const { randomUUID } = require('crypto');
const DenunciaModel = require('../models/Denuncia');
const StaffProfile = require('../models/StaffProfile');

// =========================
// UTILITARIOS
// =========================
function gerarCodigoFeedback() {
    return randomUUID().split('-')[0].toUpperCase();
}

function gerarEmojiNota(nota) {
    if (nota >= 9) return '\uD83C\uDF1F';  
    if (nota >= 7) return '\u2705';        
    if (nota >= 5) return '\u26A0\uFE0F';  
    return '\u274C';                        
}

function gerarCorNota(nota) {
    if (nota >= 8) return '#00b894';
    if (nota >= 5) return '#fdcb6e';
    return '#d63031';
}

function gerarLabelNota(nota) {
    if (nota >= 9) return 'Excelente';
    if (nota >= 7) return 'Bom';
    if (nota >= 5) return 'Regular';
    if (nota >= 3) return 'Ruim';
    return 'Pessimo';
}

function gerarEstrelasNota(nota) {
    const n = Math.round(nota);
    const cheias = '\u2B50'.repeat(n);
    const vazias  = '\u25E6'.repeat(10 - n);
    return cheias + vazias;
}

// =========================
// MENU DE FEEDBACK
// =========================
function criarMenuFeedback(denunciaId) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`feedback:select:${denunciaId}`)
            .setPlaceholder('\u2B50 Avalie o atendimento recebido (1 a 10)')
            .addOptions(
                Array.from({ length: 10 }, (_, i) => {
                    const n = i + 1;
                    const emoji =
                        n >= 9 ? '\uD83C\uDF1F' :
                        n >= 7 ? '\u2705' :
                        n >= 5 ? '\u26A0\uFE0F' : '\u274C';
                    return {
                        label: `${n} \u2014 ${gerarLabelNota(n)}`,
                        value: `${n}`,
                        description: `Nota ${n} de 10 ${emoji}`
                    };
                })
            )
    );
}

// =========================
// ENVIAR EMBED NOS CANAIS
// =========================
async function enviarFeedbackCanais(client, config, data) {
    if (!config?.channels) {
        console.warn('[Feedback] Config invalida ao enviar para canais.');
        return;
    }

    const embed = criarEmbedFeedback(data);

    if (config.channels.log) {
        const logChannel = client.channels.cache.get(config.channels.log);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        } else {
            console.warn(`[Feedback] Canal de log nao encontrado: ${config.channels.log}`);
        }
    }
}

// =========================
// ENVIAR DM PARA O STAFF
// =========================
async function enviarFeedbackStaff(client, staffId, data) {
    if (!staffId) return;

    const staff = await client.users.fetch(staffId).catch(() => null);

    if (!staff) {
        console.warn(`[Feedback] Staff nao encontrado para DM: ${staffId}`);
        return;
    }

    const embed = criarEmbedFeedback(data, true);

    await staff.send({
        content: '\uD83D\uDCEC **Voce recebeu uma avaliacao pela denuncia que atendeu!**',
        embeds: [embed]
    }).catch((err) => {
        console.warn(`[Feedback] DM bloqueada para staff ${staffId}: ${err.message}`);
    });
}

// =========================
// MONTAR EMBED — DESIGN PROFISSIONAL
// =========================
function criarEmbedFeedback(data, isDM = false) {
    const nota     = Number(data.nota);
    const emoji    = gerarEmojiNota(nota);
    const estrelas = gerarEstrelasNota(nota);
    const label    = gerarLabelNota(nota);
    const cor      = gerarCorNota(nota);

    const descricao = isDM
        ? '> \uD83D\uDCCB Uma den\u00FAncia que voc\u00EA atendeu foi avaliada pelo denunciante.'
        : '> \uD83D\uDCCB Registro de avalia\u00E7\u00E3o p\u00F3s-atendimento.';

    return new EmbedBuilder()
        .setColor(cor)
        .setTitle(`${emoji}  Avalia\u00E7\u00E3o de Atendimento`)
        .setDescription(`${descricao}\n\u200B`)
        .addFields(
            {
                name: '\uD83D\uDD11  C\u00F3digo',
                value: `\`\`\`${data.codigo}\`\`\``,
                inline: true
            },
            {
                name: '\uD83D\uDC64  Denunciante',
                value: `<@${data.denuncianteId}>`,
                inline: true
            },
            {
                name: '\uD83D\uDEE1\uFE0F  Staff',
                value: data.staffId ? `<@${data.staffId}>` : '`N\u00E3o registrado`',
                inline: true
            },
            {
                name: '\u200B',
                value: `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015`,
                inline: false
            },
            {
                name: `\u2B50  Nota \u2014 ${nota}/10 \u2014 ${label}`,
                value: `${estrelas}`,
                inline: false
            },
            {
                name: '\uD83D\uDCAC  Coment\u00E1rio',
                value: data.comentario
                    ? `\`\`\`${data.comentario}\`\`\``
                    : '*Nenhum coment\u00E1rio fornecido.*',
                inline: false
            },
            {
                name: '\u200B',
                value: `\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015`,
                inline: false
            },
            {
                name: '\uD83D\uDD17  Den\u00FAncia',
                value: `[\uD83D\uDCCC Clique aqui para acessar a thread](${data.threadUrl})`,
                inline: false
            }
        )
        .setFooter({
            text: `Sistema de Feedback \u2022 ${new Date().toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })}`
        })
        .setTimestamp();
}

async function handleFeedbackMenu(interaction) {
    const denunciaId = interaction.customId.split(':')[2];
    const nota = interaction.values[0];

    const modal = new ModalBuilder()
        .setCustomId(`feedback:modal:${denunciaId}:${nota}`)
        .setTitle('\uD83D\uDCDD Avalia\u00E7\u00E3o do Atendimento')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('comentario')
                    .setLabel('Deixe um coment\u00E1rio (opcional)')
                    .setPlaceholder('Ex: Atendimento r\u00E1pido e eficiente...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(300)
            )
        );

    await interaction.showModal(modal);
}

// =========================
// MODAL SUBMIT
// =========================
// Grava a avaliação e avisa a staff. Devolve null se a denúncia já tinha sido
// avaliada (a marcação é atômica: duas avaliações simultâneas não passam).
async function registrarFeedback(client, denuncia, { nota, comentario }, config) {
    const n = Number(nota);
    const staffId = denuncia.staffId || denuncia.claimedBy || null;

    const marcada = await DenunciaModel.findOneAndUpdate(
        { _id: denuncia._id, feedbackEnviado: { $ne: true } },
        { $set: {
            feedbackEnviado: true,
            feedbackNota: n,
            feedbackComentario: comentario || '',
            feedbackStaffId: staffId,
            feedbackEm: new Date()
        } },
        { new: true }
    );
    if (!marcada) return null;

    if (staffId) {
        await StaffProfile.registrarFeedback(denuncia.guildId, staffId, n)
            .catch(err => console.error('[Feedback] Falha ao atualizar o perfil do staff:', err));
    }

    const codigo = gerarCodigoFeedback();
    const threadUrl = `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`;
    const feedbackData = { nota: n, comentario, denuncianteId: denuncia.criadoPor, staffId, codigo, threadUrl };

    const [canalResult, dmResult] = await Promise.allSettled([
        enviarFeedbackCanais(client, config || { channels: { log: null } }, feedbackData),
        enviarFeedbackStaff(client, staffId, feedbackData)
    ]);

    if (canalResult.status === 'rejected')
        console.error('[Feedback] Falha ao enviar no canal de log:', canalResult.reason);

    if (dmResult.status === 'rejected')
        console.error('[Feedback] Falha ao enviar DM para o staff:', dmResult.reason);

    await removerFeedbackMenu(client, String(denuncia._id)).catch(() => {});

    return { codigo, nota: n };
}

async function handleFeedbackModal(interaction, Denuncia, getCachedConfig) {
    try {
        await interaction.deferReply({ flags: 64 });

        const [, , denunciaId, nota] = interaction.customId.split(':');
        const comentario = interaction.fields.getTextInputValue('comentario');

        const denuncia = await Denuncia.findById(denunciaId);

        if (!denuncia) {
            return interaction.editReply({ content: '\u274C Den\u00FAncia n\u00E3o encontrada.' });
        }

        if (denuncia.feedbackEnviado) {
            return interaction.editReply({ content: '\u274C Voc\u00EA j\u00E1 avaliou esta den\u00FAncia.' });
        }

        if (interaction.user.id !== denuncia.criadoPor) {
            return interaction.editReply({ content: '\u274C Apenas o denunciante pode enviar feedback.' });
        }

        const config = await getCachedConfig(interaction.guild.id);
        const registrado = await registrarFeedback(interaction.client, denuncia, { nota, comentario }, config);
        if (!registrado) {
            return interaction.editReply({ content: '\u274C Voc\u00EA j\u00E1 avaliou esta den\u00FAncia.' });
        }
        const { codigo } = registrado;

        const n      = Number(nota);
        const emoji  = gerarEmojiNota(n);
        const label  = gerarLabelNota(n);

        const embedConfirmacao = new EmbedBuilder()
            .setColor(gerarCorNota(n))
            .setTitle(`${emoji}  Feedback Enviado com Sucesso!`)
            .setDescription('> Obrigado por avaliar o atendimento. Sua opini\u00E3o \u00E9 muito importante!\n\u200B')
            .addFields(
                {
                    name: '\u2B50  Sua Avalia\u00E7\u00E3o',
                    value: `${gerarEstrelasNota(n)}\n\`${n}/10 \u2014 ${label}\``,
                    inline: false
                },
                {
                    name: '\uD83D\uDCAC  Coment\u00E1rio',
                    value: comentario
                        ? `\`\`\`${comentario}\`\`\``
                        : '*Nenhum coment\u00E1rio fornecido.*',
                    inline: false
                },
                {
                    name: '\uD83D\uDD11  C\u00F3digo de Registro',
                    value: `\`${codigo}\``,
                    inline: true
                }
            )
            .setFooter({ text: 'Apenas voc\u00EA pode ver esta mensagem.' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embedConfirmacao] });

    } catch (err) {
        console.error('[Feedback] Erro no modal:', err);

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: '\u274C Erro ao enviar feedback.' });
        } else {
            await interaction.reply({ content: '\u274C Erro ao enviar feedback.', flags: 64 });
        }
    }
}

// =========================
// INSERIR MENU NA THREAD
// =========================
async function inserirFeedbackMenu(client, denuncia) {
    try {
        if (!denuncia.threadId) {
            console.error('[Feedback] threadId nao definido na denuncia.');
            return;
        }

        let thread = client.channels.cache.get(denuncia.threadId);

        if (!thread) {
            thread = await client.channels.fetch(denuncia.threadId).catch(() => null);
        }

        if (!thread?.isThread?.() || !thread.isTextBased?.()) {
            console.error(`[Feedback] Tópico da denúncia não encontrado: ${denuncia.threadId}`);
            return;
        }

        const menu = criarMenuFeedback(denuncia._id);
        const mensagens = await thread.messages.fetch({ limit: 50 }).catch(() => null);
        const menuExistente = mensagens?.find(message =>
            message.author?.id === client.user.id &&
            message.components?.some(row => row.components?.some(component =>
                component.customId === `feedback:select:${denuncia._id}`
            ))
        );

        if (menuExistente) {
            await menuExistente.edit({ components: [menu] });
        } else {
            await thread.send({
                content: '⭐ **Avalie o atendimento da sua denúncia:**',
                components: [menu],
            });
        }

    } catch (err) {
        console.error('[Feedback] Erro ao inserir menu de feedback:', err.message);
    }
}

async function removerFeedbackMenu(client, denunciaId) {
    const denuncia = await DenunciaModel.findById(denunciaId).select('threadId').lean().catch(() => null);
    if (!denuncia) return;

    const thread = await client.channels.fetch(denuncia.threadId).catch(() => null);
    if (!thread?.isTextBased?.()) return;

    const mensagens = await thread.messages.fetch({ limit: 50 }).catch(() => null);
    const menuId = `feedback:select:${denunciaId}`;
    for (const message of mensagens?.values?.() || []) {
        const temMenu = message.components?.some(row => row.components?.some(component => component.customId === menuId));
        if (temMenu) await message.delete().catch(() => {});
    }
}

module.exports = {
    registrarFeedback,
    criarMenuFeedback,
    inserirFeedbackMenu,
    handleFeedbackMenu,
    handleFeedbackModal,
    removerFeedbackMenu
};