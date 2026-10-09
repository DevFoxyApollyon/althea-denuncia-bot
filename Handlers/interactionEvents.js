const { MessageFlags } = require('discord.js');
const interactionHandler = require('./interactionHandler');
const { advancedMonitor } = require('../utils/advancedMonitoring');
const { bloquearReivindicacaoSeHouverPendentes } = require('../utils/avisoPendentesAnteriores');

function registerInteractionEvents(client, log) {
    client.on('interactionCreate', async interaction => {
        try {
            const startTime = Date.now();

            if (interaction.isButton() && interaction.customId === 'reivindicar') {
                if (await bloquearReivindicacaoSeHouverPendentes(interaction)) return;
            }

            await interactionHandler(interaction);

            if (advancedMonitor?.recordInteraction) {
                const duration = Date.now() - startTime;
                const type = interaction.isButton() ? 'BUTTON' : interaction.isModalSubmit() ? 'MODAL' : 'SELECT';
                advancedMonitor.recordInteraction(type, duration, true);
            }
        } catch (error) {
            if (error.code === 50278) return;
            if (error.code === 10062) return;

            log.error(`Erro na interação (${interaction?.customId ?? 'desconhecido'}): ${error.message}`);

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Erro interno.', flags: [MessageFlags.Ephemeral] });
                }
            } catch (_) {}
        }
    });
}

module.exports = { registerInteractionEvents };
