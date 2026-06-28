// denuncia.js
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
const Usuario = require('../models/Usuario');
const { getCachedConfig } = require('../utils/performance');
const { handleExportButton } = require('../Handlers/exportDenuncia'); 
const { handleClaimButton } = require('../Handlers/handlerStatusButton'); 
const { notificarAcusadoPv } = require('../utils/userSyncAndNotify');
const { extractYouTubeVideoId, fetchYouTubeTitle, findYouTubeLinks } = require('../utils/youtubeUtils');
const dateUtils = require('../utils/dateUtils');
const { extrairContaDoNickname } = require('../utils/nickUtils');

const { 
    handleInputIdLogAceite, 
    handleModalLogMessageIdCorrecaoAceite,
    handleSalvarCorrecaoAceite 
} = require('./correcao'); 

require('dotenv').config();

const BUTTON_REFRESH_INTERVAL = 1800000;
const SUPORTE_BOT_ID = process.env.SUPORTE_BOT_ID;
const COOLDOWN_MS = 3 * 60 * 1000;
const PROVAS_TIMEOUT_MS = 5 * 60 * 1000;

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const BROKEN_LINK_REGEX = /\b(?!https?:\/\/)[a-zA-Z]{1,5}:\/\/[^\s]+/gi;

const PALAVRAS_BLOQUEADAS = [
    'mtfe7',
    'virada de saldo',
    'equipe mtfe',
    'entra no grupo',
    'vem aprender',
    'trampo do',
    'trampo ',
    'saldo equipe',
    't.me/',
    'telegram.me/',
];

// PalavrÃµes e chingamentos bloqueados no Motivo e no Acusado
const PALAVROES = [
    'fdp', 'filho da puta', 'filha da puta',
    'viado', 'viadÃ£o', 'viadinho',
    'cuzao', 'cuzÃ£o', 'cu',
    'porra', 'puta merda', 'puta que pariu',
    'vai se foder', 'vai tomar no cu', 'vai tomar no',
    'foder', 'fodase', 'foda-se', 'foda se',
    'otario', 'otÃ¡rio', 'otaria', 'otÃ¡ria',
    'idiota', 'imbecil', 'retardado', 'retardada',
    'burro', 'burra', 'animal',
    'lixo humano', 'escoria', 'escÃ³ria',
    'vagabundo', 'vagabunda',
    'prostituta', 'puta', 'piranha',
    'corno', 'corna',
    'babaca', 'baba ovo', 'babaovo',
    'arrombado', 'arrombada',
    'merda',
    'inutil', 'inÃºtil',
    'desgraÃ§ado', 'desgraÃ§ada', 'desgraÃ§ado', 'desgraca',
    'maldito', 'maldita',
    'lazaro', 'lazarento', 'lazarenta',
    'peste',
    'sua mae', 'sua mÃ£e', 'tua mae', 'tua mÃ£e',
    'cala boca', 'cala a boca',
    'bosta',
    'cagao', 'cagÃ£o',
    'covarde',
    'lixo',
];

// Lista unificada â€” usada tanto no Acusado quanto no Motivo (tudo em minÃºsculo)
const CONTEUDO_INVALIDO = [
    // Risadas / textos sem sentido
    'kk', 'kkk', 'kkkk', 'kkkkk', 'kkkkkk',
    'haha', 'huhu', 'rsrs', 'hehe', 'ahahah', 'hauhau', 'kkkkkkk',
    // Cargos e funÃ§Ãµes (ninguÃ©m denuncia "ADM", denuncia um ID)
    'adm', 'admin', 'staff', 'suporte', 'moderador', 'mod', 'dono',
    'lider', 'lÃ­der', 'sub lider', 'sublider', 'sub lÃ­der', 'sublÃ­der',
    // Palavras genÃ©ricas sem sentido como motivo/acusado
    'princesa', 'lixo',
    // Textos de xingamento direto no campo (jÃ¡ cobertos por PALAVROES, mas redundÃ¢ncia Ã© seguranÃ§a)
    'vai tomar no cu', 'fdp',
];

const denunciaCooldowns = new Map();

const { atualizarStatusNaMensagem } = require('../utils/atualizarStatus');

function createStatusButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reivindicar').setLabel('Reivindicar').setEmoji('ðŸ“').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('analiser').setLabel('Analisar').setEmoji('ðŸ”Ž').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('aceitar').setLabel('Aceitar').setEmoji('âœ…').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('recusar').setLabel('Recusar').setEmoji('âŒ').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('finalizar_denuncia').setLabel('Finalizar').setEmoji('ðŸ“¦').setStyle(ButtonStyle.Secondary)
    );
}

function createDenunciaButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('denuncia_pc').setLabel('DenÃºncia PC').setEmoji('ðŸ’»').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('denuncia_mobile').setLabel('DenÃºncia Mobile').setEmoji('ðŸ“±').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('minhas_denuncias').setLabel('Minhas DenÃºncias').setEmoji('ðŸ“‹').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('abrir_input_id_log_aceite').setLabel('CorreÃ§Ã£o').setEmoji('ðŸ› ï¸').setStyle(ButtonStyle.Danger)
    );
}

function validarPalavrasProibidas(texto) {
    const lower = texto.toLowerCase();
    const encontrada = PALAVRAS_BLOQUEADAS.find(p => lower.includes(p));
    if (encontrada) return 'âŒ Sua denÃºncia nÃ£o pÃ´de ser enviada. Verifique os campos e tente novamente.';
    return null;
}

// Valida palavrÃµes/chingamentos â€” aplicado no Motivo e no Acusado
function validarPalavroes(texto, nomeCampo) {
    const lower = texto.toLowerCase();
    const encontrado = PALAVROES.find(p => lower.includes(p));
    if (encontrado) return `âŒ O campo **${nomeCampo}** contÃ©m uma palavra ou expressÃ£o ofensiva. Utilize linguagem adequada ao preencher a denÃºncia.`;
    return null;
}

function validarMotivo(motivo) {
    BROKEN_LINK_REGEX.lastIndex = 0;
    if (BROKEN_LINK_REGEX.test(motivo)) return 'âŒ O campo **Motivo** contÃ©m um link invÃ¡lido. NÃ£o Ã© permitido incluir links no motivo.';
    URL_REGEX.lastIndex = 0;
    if (URL_REGEX.test(motivo)) return 'âŒ O campo **Motivo** nÃ£o pode conter links. Descreva o motivo em texto.';
    return null;
}

function validarMotivoConteudo(motivo) {
    const lower = motivo.trim().toLowerCase();
    if (motivo.trim().length < 2) return 'âŒ O campo **Motivo** Ã© muito curto. Digite pelo menos 2 caracteres.';
    const invalido = CONTEUDO_INVALIDO.find(p => lower.includes(p.toLowerCase()));
    if (invalido) return 'âŒ O campo **Motivo** contÃ©m um texto invÃ¡lido. Descreva claramente a infraÃ§Ã£o cometida, sem textos desnecessÃ¡rios.';
    return null;
}

function validarAcusadoConteudo(acusado) {
    if (acusado.trim().length < 1) return 'âŒ O campo **Acusado** estÃ¡ vazio.';
    const lower = acusado.trim().toLowerCase();
    const partes = lower.split('+').map(s => s.trim());
    const invalido = CONTEUDO_INVALIDO.find(p => {
        const pl = p.toLowerCase();
        return partes.includes(pl) || lower.includes(pl);
    });
    if (invalido) return 'âŒ O campo **Acusado** contÃ©m um valor invÃ¡lido. Insira apenas IDs numÃ©ricos reais do jogo.';
    return null;
}

function validarProvasLinks(provas) {
    BROKEN_LINK_REGEX.lastIndex = 0;
    if (BROKEN_LINK_REGEX.test(provas)) {
        return 'âŒ O campo **Provas** contÃ©m um link invÃ¡lido (ex: `htts://...`, `ttps://...`). Certifique-se de copiar o link completo comeÃ§ando com `https://`.';
    }

    URL_REGEX.lastIndex = 0;
    const links = provas.match(URL_REGEX);
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
        const bloqueado = links.find(link => !allowedDomains.some(domain => link.includes(domain)));
        if (bloqueado) return 'âŒ O campo **Provas** contÃ©m um link nÃ£o permitido. Apenas links do YouTube ou domÃ­nios oficiais do Discord sÃ£o aceitos.';
    }

    return null;
}

async function validarVideosHL(provas) {
    const links = findYouTubeLinks(provas);
    if (!links || links.length === 0) return null;

    for (const link of links) {
        const videoId = extractYouTubeVideoId(link);
        if (!videoId) continue;
        try {
            const title = await fetchYouTubeTitle(videoId);
            if (title && title.toLowerCase().includes('hl')) {
                return 'âŒ Um dos vÃ­deos enviados no campo **Provas** nÃ£o Ã© permitido. Verifique os links e tente novamente.';
            }
        } catch {}
    }

    return null;
}

async function handleDenunciaCommand(message) {
    try {
        const config = await getCachedConfig(message.guild.id, Config);
        const hasPerm = message.member.roles.cache.has(config.roles.responsavel_admin);
        
        if (!hasPerm && message.author.id !== SUPORTE_BOT_ID) return message.reply('âŒ Sem permissÃ£o.');

        const embedDesc = [
            '### FaÃ§a sua DenÃºncia',
            'Para realizar a sua denÃºncia, vocÃª deverÃ¡ apertar no botÃ£o abaixo de acordo com o seu dispositivo, lembrando que:',
            'â€¢ Ã‰ obrigatÃ³rio estar com o Discord autenticado com o jogo',
            'â€¢ ApÃ³s o envio da DenÃºncia, vocÃª **NÃƒO** poderÃ¡ apagar',
            'â€¢ Caso seja constatado que foi apagada alguma prova, vocÃª poderÃ¡ tomar puniÃ§Ã£o',
            'â€¢ O mal uso das denÃºncias resultarÃ¡ em puniÃ§Ã£o',
            '',
            '### Regras do TÃ³pico:',
            'â€¢ O tÃ³pico Ã© exclusivo para denÃºncia e contra-prova',
            'â€¢ Conversas paralelas resultarÃ£o em puniÃ§Ã£o',
            'â€¢ Apagar mensagens ou provas resultarÃ¡ em puniÃ§Ã£o',
            'â€¢ Todas as mensagens apagadas serÃ£o registradas',
            'â€¢ âš ï¸ **Cuidado com as palavras utilizadas** â€” linguagem ofensiva, chingamentos ou xingamentos dentro do tÃ³pico resultarÃ£o em puniÃ§Ã£o imediata',
            'â€¢ ðŸš« **Enviar imagens ofensivas ou mensagens por brincadeira resultarÃ¡ em banimento permanente do servidor**',
            '',
            '### Sobre as Provas em VÃ­deo:',
            'â€¢ Ã‰ recomendado enviar vÃ­deos pelo YouTube',
            'â€¢ O vÃ­deo deve mostrar claramente a infraÃ§Ã£o',
            'â€¢ VocÃª pode deixar o vÃ­deo como "nÃ£o listado"',
            'â€¢ Links de outros sites podem nÃ£o funcionar',
            'â€¢ VÃ­deos com "hl" no tÃ­tulo (Highlights) nÃ£o sÃ£o aceitos como prova',
            '',
            '### Como enviar provas:',
            '**OpÃ§Ã£o 1 - No formulÃ¡rio:**',
            '1. FaÃ§a upload do vÃ­deo no YouTube',
            '2. Copie o link do vÃ­deo',
            '3. Cole o link no campo "Provas" da denÃºncia',
            '**OpÃ§Ã£o 2 - No tÃ³pico:**',
            '1. Envie sua denÃºncia normalmente',
            '2. Aguarde o tÃ³pico ser criado',
            '3. Envie suas imagens diretamente no tÃ³pico',
            '',
            '### Tutorial:',
            'Confira nosso tutorial detalhado aqui: https://www.instagram.com/p/DPcEkcHlHDe/',
            '',
            `ðŸ•’ **HorÃ¡rio de BrasÃ­lia:** \`${dateUtils.getBrasiliaTime()}\``
        ].join('\n');

        const denunciaEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('ðŸ›¡ï¸ Sistema de DenÃºncias')
            .setDescription(embedDesc)
            .setFooter({ text: 'Brasil RolePlay' });

        const sentMessage = await message.channel.send({
            embeds: [denunciaEmbed],
            components: [createDenunciaButtons()]
        });

        const startRefresh = (msg, embeds) => {
            const timer = setTimeout(async () => {
                try {
                    await msg.edit({ embeds, components: [createDenunciaButtons()] });
                    startRefresh(msg, embeds);
                } catch {}
            }, BUTTON_REFRESH_INTERVAL);
            timer.unref?.();
        };
        startRefresh(sentMessage, [denunciaEmbed]);

    } catch (error) { console.error(error); }
}

async function handleDenunciaSubmit(interaction, platform) {
    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        }
    } catch (e) {
        console.error('Falha ao deferir interaÃ§Ã£o:', e.message);
        return;
    }

    try {
        const userId = interaction.user.id;
        const agora = Date.now();
        const ultimaEnvio = denunciaCooldowns.get(userId);

        if (ultimaEnvio && agora - ultimaEnvio < COOLDOWN_MS) {
            const restante = Math.ceil((COOLDOWN_MS - (agora - ultimaEnvio)) / 1000);
            const minutos = Math.floor(restante / 60);
            const segundos = restante % 60;
            const tempoFormatado = minutos > 0 ? `${minutos}m ${segundos}s` : `${segundos}s`;
            return await interaction.editReply({
                content: `â³ VocÃª precisa aguardar **${tempoFormatado}** antes de enviar outra denÃºncia.`,
            });
        }

        const guildId  = interaction.guild.id;
        const username = interaction.user.username;
        const nickname = interaction.member?.nickname || null;

        let contaSalva = null;
        try {
            const existing = await Usuario.findOne({ guildId, userId });
            contaSalva = existing?.conta || null;

            if (!contaSalva) {
                const contaNick = extrairContaDoNickname(nickname);
                const denuncianteInput = interaction.fields.getTextInputValue('denunciante_input').trim();
                contaSalva = contaNick || denuncianteInput || null;
            }

            const updateFields = { username, nickname, updatedAt: new Date() };
            if (contaSalva) updateFields.conta = contaSalva;

            await Usuario.findOneAndUpdate(
                { guildId, userId },
                { $set: updateFields },
                { upsert: true, new: true }
            );
        } catch (e) {
            console.warn('NÃ£o foi possÃ­vel registrar/atualizar nick do denunciante:', e.message);
        }

        const config = await getCachedConfig(interaction.guild.id, Config);

        const inputDigitado = interaction.fields.fields.has('denunciante_input')
            ? interaction.fields.getTextInputValue('denunciante_input').trim()
            : null;

        const denunciante = inputDigitado || contaSalva;

        if (!denunciante) {
            return await interaction.editReply({ content: 'âŒ NÃ£o foi possÃ­vel identificar o denunciante. Tente novamente.' });
        }

        if (!/^\d+$/.test(denunciante)) {
            return await interaction.editReply({ content: 'âŒ O campo **Denunciante** deve conter apenas nÃºmeros.' });
        }

        if (denunciante.length > 15) {
            return await interaction.editReply({ content: 'âŒ O campo **Denunciante** deve ter no mÃ¡ximo 15 dÃ­gitos.' });
        }

        const acusado = interaction.fields.getTextInputValue('acusado_input');
        const motivo  = interaction.fields.getTextInputValue('motivo_input');
        let provas    = interaction.fields.getTextInputValue('provas_input') || 'TÃ³pico';

        if (!/^[a-zA-Z0-9+ ]+$/.test(acusado)) {
            return await interaction.editReply({ content: 'âŒ O campo **Acusado** sÃ³ pode conter letras, nÃºmeros e o sÃ­mbolo "+" para mÃºltiplos IDs.' });
        }

        // ValidaÃ§Ã£o de conteÃºdo do acusado
        const erroAcusadoConteudo = validarAcusadoConteudo(acusado);
        if (erroAcusadoConteudo) return await interaction.editReply({ content: erroAcusadoConteudo });

        // ValidaÃ§Ã£o de palavrÃµes no acusado
        const erroPalavraoAcusado = validarPalavroes(acusado, 'Acusado');
        if (erroPalavraoAcusado) return await interaction.editReply({ content: erroPalavraoAcusado });

        // ValidaÃ§Ã£o de palavras bloqueadas em todos os campos
        const camposParaVerificar = [denunciante, acusado, motivo, provas];
        for (const campo of camposParaVerificar) {
            const erroSpam = validarPalavrasProibidas(campo);
            if (erroSpam) return await interaction.editReply({ content: erroSpam });
        }

        const erroMotivo = validarMotivo(motivo);
        if (erroMotivo) return await interaction.editReply({ content: erroMotivo });

        const erroMotivoConteudo = validarMotivoConteudo(motivo);
        if (erroMotivoConteudo) return await interaction.editReply({ content: erroMotivoConteudo });

        // ValidaÃ§Ã£o de palavrÃµes no motivo
        const erroPalavraoMotivo = validarPalavroes(motivo, 'Motivo');
        if (erroPalavraoMotivo) return await interaction.editReply({ content: erroPalavraoMotivo });

        if (provas !== 'TÃ³pico') {
            const erroProvas = validarProvasLinks(provas);
            if (erroProvas) return await interaction.editReply({ content: erroProvas });

            const erroHL = await validarVideosHL(provas);
            if (erroHL) return await interaction.editReply({ content: erroHL });
        }

        const acusadoIds = acusado.split('+').map(id => id.trim()).filter(id => id.length > 0);

        const contaDenunciante = denunciante.toLowerCase();
        const eAutodenunciando = acusadoIds.some(id => id.toLowerCase() === contaDenunciante);
        if (eAutodenunciando) {
            return await interaction.editReply({ content: 'âŒ VocÃª nÃ£o pode denunciar a si mesmo.' });
        }

        let acusadoTexto = '';
        try {
            const partes = await Promise.all(acusadoIds.map(async (id) => {
                try {
                    const found = await Usuario.findOne({ guildId: interaction.guild.id, conta: id });
                    return found ? `\`${id}\` (<@${found.userId}>)` : `\`${id}\``;
                } catch {
                    return `\`${id}\``;
                }
            }));
            acusadoTexto = partes.join(' ');
        } catch (e) {
            console.warn('NÃ£o foi possÃ­vel buscar acusados no banco:', e.message);
            acusadoTexto = acusadoIds.map(id => `\`${id}\``).join(' ');
        }

        const channelId = platform === 'PC' ? config.channels.pc : config.channels.mobile;
        const channel   = interaction.client.channels.cache.get(channelId);

        const textoDenuncia = [
            `|| ${interaction.user} ||`,
            `âž± **Denunciante**: \`${denunciante}\``,
            `âž± **Acusado**: ${acusadoTexto}`,
            `âž± **Motivo**: \`${motivo}\``,
            `âž± **Prova(s)**: ${provas}`,
            `âž± **Status**: \`Pendente\``
        ].join('\n');

        const textoDenunciaTopico = [
            `|| ${interaction.user} ||`,
            `âž± **Denunciante**: \`${denunciante}\``,
            `âž± **Acusado**: ${acusadoTexto}`,
            `âž± **Motivo**: \`${motivo}\``,
            `âž± **Prova(s)**: ${provas}`
        ].join('\n');

        const mainMessage = await channel.send({
            content: textoDenuncia,
            allowedMentions: { parse: ['users'] }
        });

        let thread;
        try {
            thread = await mainMessage.startThread({
                name: `DenÃºncia: ${denunciante}`,
                autoArchiveDuration: 1440
            });
        } catch (e) {
            console.error('Erro ao criar o tÃ³pico da denÃºncia:', e.message);
            await interaction.editReply({
                content: 'âŒ Erro ao criar o tÃ³pico da denÃºncia. Isso pode ocorrer por falta de permissÃ£o, limite de tÃ³picos ou configuraÃ§Ã£o do canal. Por favor, tente novamente ou contate um administrador.'
            });
            return;
        }

        await thread.send({ content: textoDenunciaTopico });
        await thread.send({ components: [createStatusButtons()] });

        try {
            await Usuario.findOneAndUpdate(
                { guildId: interaction.guild.id, userId: interaction.user.id },
                { $set: { ultimoThreadId: thread.id, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (e) {
            console.warn('NÃ£o foi possÃ­vel atualizar o Ãºltimo threadId do usuÃ¡rio:', e.message);
        }

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

        denunciaCooldowns.set(interaction.user.id, Date.now());

        try {
            const TRES_HORAS_MS = 3 * 60 * 60 * 1000;
            const agora = new Date();
            const tresHorasAtras = new Date(agora.getTime() - TRES_HORAS_MS);
            const denunciasRecentes = await Denuncia.find({
                guildId: interaction.guild.id,
                acusado: acusado,
                dataCriacao: { $gte: tresHorasAtras }
            }).sort({ dataCriacao: -1 });

            if (denunciasRecentes.length >= 5) {
                const logChannelId = config.channels.log;
                const responsavelAdminId = config.roles.responsavel_admin;

                if (logChannelId && responsavelAdminId) {
                    const logChannel = interaction.guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        const links = denunciasRecentes.map((d, idx) => `**${idx + 1}.** [${dateUtils.getDiscordTimestamp(d.dataCriacao, 'R')}] https://discord.com/channels/${d.guildId}/${d.channelId}/${d.messageId}`).join('\n');
                        const embed = new EmbedBuilder()
                            .setColor('#d7263d')
                            .setTitle('ðŸš¨ TendÃªncia de denÃºncias em massa')
                            .setDescription(`O acusado **${acusado}** recebeu **${denunciasRecentes.length} denÃºncias** nas Ãºltimas 3 horas.`)
                            .addFields(
                                { name: 'Acusado', value: `${acusado}`, inline: true },
                                { name: 'HorÃ¡rio do alerta', value: dateUtils.getBrasiliaDateTime(), inline: true },
                                { name: 'Links das denÃºncias', value: links.length > 1024 ? links.slice(0, 1020) + '...' : links }
                            )
                            .setFooter({ text: 'Brasil RolePlay - Sistema de DenÃºncias' })
                            .setTimestamp();
                        await logChannel.send({
                            content: `<@&${responsavelAdminId}> **Alerta:** Muitas denÃºncias para o acusado **${acusado}**!`,
                            embeds: [embed]
                        });
                    }
                }
            }
        } catch (err) {
            console.error('Erro ao enviar alerta de tendÃªncia:', err);
        }

        try {
            const denunciaLink = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${mainMessage.id}`;
            const mensagemDetalhada = [
                `âš ï¸ **VocÃª foi denunciado no servidor ${interaction.guild.name}!**`,
                '',
                `**Denunciante:** ${denunciante}`,
                `**Motivo:** ${motivo}`,
                `**Provas:** ${provas}`,
                '',
                `${denunciaLink}`,
                '',
                'Se vocÃª acredita que esta denÃºncia Ã© injusta, responda no tÃ³pico da denÃºncia com as contras provas ou aguarde a anÃ¡lise da equipe.'
            ].join('\n');

            for (const id of acusadoIds) {
                await notificarAcusadoPv(
                    interaction.client,
                    interaction.guild.id,
                    id,
                    mensagemDetalhada
                ).catch(e => console.warn(`NÃ£o foi possÃ­vel notificar acusado ${id} no PV:`, e.message));
            }
        } catch (e) {
            console.warn('NÃ£o foi possÃ­vel notificar acusado(s) no PV:', e.message);
        }

        await garantirAvisoNoTopo(channel, interaction.channelId);

        await interaction.editReply({ 
            content: [
                `âœ… Sua denÃºncia foi criada com sucesso em ${thread} Ã s \`${dateUtils.getBrasiliaTime()}\`.`,
                '',
                'âš ï¸ **AtenÃ§Ã£o â€” leia antes de interagir no tÃ³pico:**',
                'â€¢ Utilize linguagem respeitosa. Chingamentos e palavras ofensivas resultarÃ£o em **puniÃ§Ã£o imediata**.',
                'â€¢ Enviar **imagens ofensivas**, memes ou qualquer conteÃºdo por brincadeira dentro do tÃ³pico resultarÃ¡ em **banimento permanente do servidor**, sem direito a recurso.',
                'â€¢ O tÃ³pico Ã© exclusivo para apresentaÃ§Ã£o de provas e contra-provas. Mensagens fora desse contexto serÃ£o removidas e o responsÃ¡vel punido.',
            ].join('\n')
        });

    } catch (error) {
        console.error(error);
        try {
            await interaction.editReply({ content: 'âŒ Erro ao processar sua denÃºncia.' });
        } catch (e) {
            console.error('NÃ£o foi possÃ­vel editar a resposta de erro:', e.message);
        }
    }
}

async function handleDenunciaButtons(interaction, client) {
    try {
        if (!interaction.isButton()) return;
        const { customId, user } = interaction;

        if (customId === 'minhas_denuncias') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const logs = await Denuncia.find({ criadoPor: user.id }).sort({ dataCriacao: -1 }).limit(10);
            const desc = logs.map((d, i) => `**${i+1}.** \`${d.status}\` - ${d.acusado} (${dateUtils.getDiscordTimestamp(d.dataCriacao, 'R')})`).join('\n');
            return await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('ðŸ“‹ Suas DenÃºncias').setDescription(desc || 'Nenhuma denÃºncia encontrada.')] });
        }

        if (customId === 'reivindicar') return await handleClaimButton(interaction);
        if (customId === 'finalizar_denuncia') return await handleExportButton(interaction);
        if (customId === 'abrir_input_id_log_aceite') return await handleInputIdLogAceite(interaction);

        if (['analiser', 'aceitar', 'recusar'].includes(customId)) {
            const { handleStatusButton } = require('../Handlers/handlerStatusButton');
            return await handleStatusButton(interaction, customId);
        }

        return await interaction.reply({
            content: 'âŒ AÃ§Ã£o nÃ£o reconhecida ou nÃ£o suportada para este botÃ£o.',
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) { console.error(error); }
}

async function handleDenunciaPC(interaction) {
    const config = await getCachedConfig(interaction.guild.id, Config);
    const roleRequired = config.roles.pc;
    if (!roleRequired || !interaction.member.roles.cache.has(roleRequired)) {
        return interaction.reply({ content: `âŒ VocÃª nÃ£o tem permissÃ£o para usar o botÃ£o de denÃºncia PC. Ã‰ necessÃ¡rio o cargo <@&${roleRequired}>.`, flags: [MessageFlags.Ephemeral] });
    }
    await openDenunciaModal(interaction, 'PC');
}

async function handleDenunciaMobile(interaction) {
    const config = await getCachedConfig(interaction.guild.id, Config);
    const roleRequired = config.roles.permitido;
    if (!roleRequired || !interaction.member.roles.cache.has(roleRequired)) {
        return interaction.reply({ content: `âŒ VocÃª nÃ£o tem permissÃ£o para usar o botÃ£o de denÃºncia Mobile. Ã‰ necessÃ¡rio o cargo <@&${roleRequired}>.`, flags: [MessageFlags.Ephemeral] });
    }
    await openDenunciaModal(interaction, 'Mobile');
}

async function buscarContaComTimeout(guildId, userId, timeoutMs = 1500) {
    try {
        const resultado = await Promise.race([
            Usuario.findOne({ guildId, userId }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), timeoutMs)
            )
        ]);
        return resultado?.conta || null;
    } catch {
        return null;
    }
}

async function openDenunciaModal(interaction, platform) {
    try {
        const contaSalva = await buscarContaComTimeout(
            interaction.guild.id,
            interaction.user.id
        );

        const modal = new ModalBuilder()
            .setCustomId(platform === 'PC' ? 'denuncia_pc_modal' : 'denuncia_mobile_modal')
            .setTitle(`FormulÃ¡rio de DenÃºncia - ${platform}`);

        const limits = platform === 'PC'
            ? { acusado: 70, provas: 500 }
            : { acusado: 120, provas: 1000 };

        const denuncianteInput = new TextInputBuilder()
            .setCustomId('denunciante_input')
            .setLabel('Denunciante (somente nÃºmeros)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Ex: 123456')
            .setMaxLength(15);

        if (contaSalva && /^\d+$/.test(contaSalva) && contaSalva.length <= 15) {
            denuncianteInput.setValue(contaSalva);
        }

        const acusadoInput = new TextInputBuilder()
            .setCustomId('acusado_input')
            .setLabel('ID do Acusado (use + para mÃºltiplos)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(limits.acusado);

        const motivoInput = new TextInputBuilder()
            .setCustomId('motivo_input')
            .setLabel('Motivo da DenÃºncia')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(100);

        const provasInput = new TextInputBuilder()
            .setCustomId('provas_input')
            .setLabel('Provas')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(limits.provas);

        modal.addComponents(
            new ActionRowBuilder().addComponents(denuncianteInput),
            new ActionRowBuilder().addComponents(acusadoInput),
            new ActionRowBuilder().addComponents(motivoInput),
            new ActionRowBuilder().addComponents(provasInput)
        );

        await interaction.showModal(modal);

    } catch (error) {
        console.error(`Erro ao abrir modal ${platform}:`, error.message);
    }
}

async function handleModalSubmit(interaction, platform) {
    try {
        await handleDenunciaSubmit(interaction, platform);
    } catch (error) {
        console.error('Erro ao processar submissÃ£o:', error.message);
        const msg = { content: 'âŒ Erro ao processar sua denÃºncia.', flags: 64 };
        if (!interaction.replied && !interaction.deferred) await interaction.reply(msg);
        else await interaction.editReply(msg);
    }
}

async function handleMyDenunciasButton(interaction) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('consulta_denuncias_modal')
            .setTitle('ðŸ” Consultar DenÃºncias por ID');

        const idInput = new TextInputBuilder()
            .setCustomId('id_consulta_input')
            .setLabel('ID do Jogador/Denunciante (Separe com , ou +)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 1921 ou ID Discord')
            .setRequired(true)
            .setMaxLength(20);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput));
        await interaction.showModal(modal);
    } catch (error) {
        console.error('Erro ao abrir modal de consulta:', error);
    }
}

async function handleConsultaModalSubmit(interaction) {
    let deferred = false;
    try {
        await interaction.deferReply({ flags: 64 });
        deferred = true;

        const rawIds = interaction.fields.getTextInputValue('id_consulta_input').trim();
        const idsToSearch = rawIds.replace(/\s*[+,|]\s*/g, ' ').split(/\s+/).filter(id => id.length > 0);

        if (idsToSearch.length === 0) {
            return await interaction.editReply({ content: 'âŒ ForneÃ§a pelo menos um ID vÃ¡lido.' });
        }

        const escapedIds = idsToSearch.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        const orQuery = [
            { criadoPor: { $in: idsToSearch } },
            { acusado: { $in: idsToSearch } },
        ];

        escapedIds.forEach(id => {
            orQuery.push({ acusadoId: { $regex: new RegExp(`(^|\\s)${id}(\\s|$)`) } });
        });

        const allDenuncias = await Promise.race([
            Denuncia.find({
                guildId: interaction.guild.id,
                $or: orQuery
            }).sort({ dataCriacao: -1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Consulta expirou (timeout)')), 10000))
        ]);

        if (allDenuncias.length === 0) {
            return await interaction.editReply({
                content: `âœ… Nenhuma denÃºncia (pendente ou finalizada) encontrada para os IDs: \`${idsToSearch.join(', ')}\`.`,
            });
        }

        const responseEmbeds = [];
        const total = allDenuncias.length;
        const DENUNCIAS_PER_EMBED = 5;

        for (let i = 0; i < total && responseEmbeds.length < 5; i += DENUNCIAS_PER_EMBED) {
            const chunk = allDenuncias.slice(i, i + DENUNCIAS_PER_EMBED);
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`ðŸ” Resultados da Consulta â€” Total: ${total}`)
                .setTimestamp();

            chunk.forEach((d) => {
                let statusEmoji = 'ðŸ”';
                let statusNome  = 'PENDENTE / EM ANÃLISE';

                if (d.status === 'aceita')   { statusEmoji = 'âœ…'; statusNome = 'ACEITA'; }
                if (d.status === 'recusada') { statusEmoji = 'âŒ'; statusNome = 'RECUSADA'; }

                const motivoOriginal = (d.status === 'aceita' && d.motivoAceite) ? d.motivoAceite : (d.motivo || 'N/A');
                const motivoFinal    = motivoOriginal.length > 150 ? motivoOriginal.substring(0, 150) + '...' : motivoOriginal;
                const linkOriginal   = `https://discord.com/channels/${d.guildId}/${d.channelId}/${d.messageId}`;

                embed.addFields({
                    name: `${statusEmoji} DenÃºncia #${d._id.toString().substring(0, 8)} [${statusNome}]`,
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
        console.error('Erro no modal de consulta:', error);
        
        if (!deferred) {
            try {
                await interaction.reply({ content: 'âŒ Erro ao consultar o banco de dados.', flags: 64 });
            } catch (replyError) {
                console.error('NÃ£o foi possÃ­vel responder Ã  interaÃ§Ã£o:', replyError.code);
            }
        } else {
            try {
                await interaction.editReply({ content: 'âŒ Erro ao consultar o banco de dados.' });
            } catch (editError) {
                console.error('NÃ£o foi possÃ­vel editar a resposta:', editError.code);
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
    atualizarStatusNaMensagem,
    handleDenunciaModals: async (interaction) => {
        const { customId } = interaction;
        if (customId === 'modal_logmessageid_para_correcao_aceite') return await handleModalLogMessageIdCorrecaoAceite(interaction);
        if (customId.startsWith('salvar_correcao_aceite_')) return await handleSalvarCorrecaoAceite(interaction);
    }
};