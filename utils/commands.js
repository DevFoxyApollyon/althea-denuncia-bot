const fs = require('fs');
const path = require('path');

const commands = {};

// Carrega todos os comandos da pasta commands/
const commandsDir = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsDir, file));
    
    // Para cada arquivo, registra a função principal
    if (file === 'denuncia.js') {
        commands.denuncia = command.handleDenunciaCommand;
    } else if (file === 'rank.js') {
        commands.rank = command.handleRankCommand;
    } else if (file === 'painel.js') {
        commands.painel = command.handlePainelCommand;
    } else if (file === 'status.js') {
        commands.status = command.handleStatusCommand;
    } else if (file === 'semana.js') {
        commands.semana = command.handleSemanaCommand;
    } else if (file === 'correcao.js') {
        commands.correcao = command.handleCorrecaoCommand;
    }
}

module.exports = commands;
