const { MessageFlags } = require('discord.js');
const interactionHandler = require('./interactionHandler');
const { advancedMonitor } = require('../utils/advancedMonitoring');
const { bloquearReivindicacaoSeHouverPendentes } = require('../utils/avisoPendentesAnteriores');
const { bloquearReivindicacaoSemTeste } = require('../utils/testesObrigatorios');

function registerInteractionEvents(client, log) {
    client.on('interactionCreate', async interaction => {
        try {
            const startTime = Date.now();

            if (interaction.isButton() && interaction.customId === 'reivindicar') {
                // Teste obrigatório da staff ainda sem aprovação em dia.
                if (await bloquearReivindicacaoSemTeste(interaction)) return;
                if (await bloquearReivindicacaoSeHouverPendentes(interaction)) return;
            }

            await interactionHandler(interaction);

            const duration = Date.now() - startTime;
            if (interaction.isChatInputCommand()) {
                advancedMonitor.recordCommand(interaction.commandName, duration, true, interaction.user.id);
            } else {
                const type = interaction.isButton() ? 'BUTTON' : interaction.isModalSubmit() ? 'MODAL' : 'SELECT';
                advancedMonitor.recordInteraction(type, duration, true);
            }
        } catch (error) {
            if (error.code === 50278) return;
            if (error.code === 10062) return;

            log.error(`Erro na interação (${interaction?.customId ?? interaction?.commandName ?? 'desconhecido'}): ${error.message}`);
            advancedMonitor.recordError(error, 'interaction');

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Erro interno.', flags: [MessageFlags.Ephemeral] });
                }
            } catch (_) {}
        }
    });
}

module.exports = { registerInteractionEvents };
