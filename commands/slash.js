const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { handleRankSlash } = require('./rank');
const { handlePainelSlash } = require('./painel');
const { handleStatusSlash } = require('./status');
const { handleDenunciaSlash } = require('./denuncia');
const ponte = require('./ponte');

const comandos = [
    {
        data: new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Mostra o ranking de atendimento da staff.')
            .addStringOption(option => option
                .setName('periodo')
                .setDescription('Período do ranking (padrão: mensal)')
                .addChoices(
                    { name: 'Mensal', value: 'month' },
                    { name: 'Semanal', value: 'week' },
                    { name: 'Hoje', value: 'day' }
                )),
        executar: handleRankSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('painel')
            .setDescription('Abre o painel de configuração de canais e cargos.'),
        executar: handlePainelSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('status')
            .setDescription('Mostra o diagnóstico do bot (rede, memória, banco).')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        executar: handleStatusSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('denuncia')
            .setDescription('Publica ou atualiza a mensagem do sistema de denúncias no canal configurado.'),
        executar: handleDenunciaSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('ativar')
            .setDescription('Ativa a ponte com o jogo neste servidor (código do dono do bot).')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(option => option.setName('codigo').setDescription('Código de ativação').setRequired(true).setMaxLength(40)),
        executar: ponte.handleAtivarSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('instalacao')
            .setDescription('Gerencia os PCs autorizados na ponte com o jogo.')
            .addSubcommand(sub => sub.setName('nova').setDescription('Cadastra um PC e mostra o token uma vez.')
                .addStringOption(option => option.setName('nome').setDescription('Nome do PC').setRequired(true).setMaxLength(40)))
            .addSubcommand(sub => sub.setName('listar').setDescription('Lista os PCs cadastrados.'))
            .addSubcommand(sub => sub.setName('revogar').setDescription('Revoga o token de um PC.')
                .addStringOption(option => option.setName('id').setDescription('ID da instalação').setRequired(true)))
            .addSubcommand(sub => sub.setName('renovar').setDescription('Gera token novo (troca de PC).')
                .addStringOption(option => option.setName('id').setDescription('ID da instalação').setRequired(true))),
        executar: ponte.handleInstalacaoSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('ponte')
            .setDescription('Ponte com o jogo.')
            .addSubcommand(sub => sub.setName('templates').setDescription('Mostra e edita os comandos de punição do jogo.'))
            .addSubcommand(sub => sub.setName('motivos').setDescription('Edita a tabela de motivos (vale para todos os servidores).'))
            .addSubcommandGroup(grupo => grupo.setName('gamemode').setDescription('Ponte direta com a gamemode (sem PC).')
                .addSubcommand(sub => sub.setName('criar').setDescription('Cria a credencial da gamemode (só o dono do bot).')
                    .addStringOption(option => option.setName('nome').setDescription('Nome do servidor do jogo').setRequired(true).setMaxLength(40))
                    .addStringOption(option => option.setName('ips').setDescription('IPs de saída do servidor do jogo, separados por vírgula (vazio = qualquer)').setMaxLength(400)))
                .addSubcommand(sub => sub.setName('listar').setDescription('Lista as credenciais da gamemode (só o dono do bot).'))
                .addSubcommand(sub => sub.setName('revogar').setDescription('Revoga uma credencial (só o dono do bot).')
                    .addStringOption(option => option.setName('id').setDescription('ID da credencial').setRequired(true).setMaxLength(24)))
                .addSubcommand(sub => sub.setName('renovar').setDescription('Gera segredo novo; o antigo para na hora (só o dono do bot).')
                    .addStringOption(option => option.setName('id').setDescription('ID da credencial').setRequired(true).setMaxLength(24)))
                .addSubcommand(sub => sub.setName('pausar').setDescription('Para de entregar punições à gamemode.'))
                .addSubcommand(sub => sub.setName('retomar').setDescription('Volta a entregar punições à gamemode.'))
                .addSubcommand(sub => sub.setName('executor').setDescription('Quem aplica as punições neste servidor.')
                    .addStringOption(option => option.setName('tipo').setDescription('Quem aplica').setRequired(true).addChoices(
                        { name: 'PC da staff (mod Lua)', value: 'pc' },
                        { name: 'Gamemode', value: 'gamemode' },
                        { name: 'Os dois (quem pegar primeiro)', value: 'ambos' }
                    )))
                .addSubcommand(sub => sub.setName('limites').setDescription('Ban máximo, cadeia, avisos, permanente e modo teste.'))),
        executar: ponte.handlePonteSlash
    },
    {
        data: new SlashCommandBuilder()
            .setName('ponte-codigo')
            .setDescription('Gera código de ativação da ponte (só o dono do bot).')
            .setDefaultMemberPermissions(0)
            .addSubcommand(sub => sub.setName('gerar').setDescription('Gera um código novo.')
                .addIntegerOption(option => option.setName('validade_dias').setDescription('Dias até expirar').setMinValue(1).setMaxValue(365))
                .addIntegerOption(option => option.setName('limite_pcs').setDescription('PCs ativos ao mesmo tempo').setMinValue(1).setMaxValue(50))),
        executar: ponte.handlePonteCodigoSlash
    }
];

const executores = new Map(comandos.map(comando => [comando.data.name, comando.executar]));

// Registra os comandos em cada servidor (aparecem na hora, sem a espera dos
// comandos globais). Só cria/edita os comandos deste arquivo: outros comandos
// registrados pelo mesmo bot no servidor não são tocados.
async function registrarComandosNoServidor(guild) {
    const existentes = await guild.commands.fetch();

    for (const { data } of comandos) {
        // Sem as chaves undefined do toJSON(): com elas (ex.: nsfw) o equals() sempre dava
        // diferente e todo comando era editado a cada inicialização, até o Discord limitar.
        const definicao = JSON.parse(JSON.stringify(data.toJSON()));
        const atual = existentes.find(comando => comando.name === definicao.name);

        if (!atual) await guild.commands.create(definicao);
        else if (!atual.equals(definicao)) await atual.edit(definicao);
    }
}

async function registrarComandosSlash(client, log) {
    let registrados = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            await registrarComandosNoServidor(guild);
            registrados++;
        } catch (error) {
            log.warn(`Não foi possível registrar os comandos de barra em ${guild.name}: ${error.message}`);
        }
    }

    log.info(`Comandos de barra registrados em ${registrados} servidor(es): ${comandos.map(c => '/' + c.data.name).join(', ')}`);
}

async function handleSlashCommand(interaction) {
    const executar = executores.get(interaction.commandName);
    if (!executar) return;

    if (!interaction.inGuild()) {
        return interaction.reply({ content: '❌ Este comando só funciona dentro de um servidor.', flags: [MessageFlags.Ephemeral] });
    }

    await executar(interaction);
}

module.exports = { comandos, registrarComandosSlash, registrarComandosNoServidor, handleSlashCommand };
