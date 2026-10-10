const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { handleRankSlash } = require('./rank');
const { handlePainelSlash } = require('./painel');
const { handleStatusSlash } = require('./status');
const { handleDenunciaSlash } = require('./denuncia');

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
    }
];

const executores = new Map(comandos.map(comando => [comando.data.name, comando.executar]));

// Registra os comandos em cada servidor (aparecem na hora, sem a espera dos
// comandos globais). Só cria/edita os comandos deste arquivo: outros comandos
// registrados pelo mesmo bot no servidor não são tocados.
async function registrarComandosNoServidor(guild) {
    const existentes = await guild.commands.fetch();

    for (const { data } of comandos) {
        const definicao = data.toJSON();
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
