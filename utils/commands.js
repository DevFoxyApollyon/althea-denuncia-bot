// utils/commands.js
module.exports = {
    'rank': require('../commands/rank').handleRankCommand,
    'denuncia': require('../commands/denuncia').handleDenunciaCommand,
    'painel': require('../commands/painel.js').handlePainelCommand,
    'correcao': require('../commands/correcao').handleCorrecaoCommand,
    'status': require('../commands/status').handleStatusCommand,
    'semana': require('../commands/semana').handleSemanaCommand
};