function pick(modulo, nomes) {
  return Object.fromEntries(nomes.map(nome => [nome, modulo[nome]]));
}

// Fachada: a lógica foi dividida em Handlers/statusDenuncia/ por responsabilidade.
// Quem já importava deste arquivo continua funcionando sem mudanças.
module.exports = {
  ...pick(require('./statusDenuncia/acoesStatus'), ['handleStatusButton', 'handlePunishmentModal', 'denunciasMap', 'handleRecusarPorMensagem', 'handleLogAceitarButton', 'handleLogRecusarButton', 'processarAnaliseAutomatica']),
  ...pick(require('./statusDenuncia/reivindicar'), ['handleClaimButton']),
  ...pick(require('./statusDenuncia/adicionarJogador'), ['handleAddPlayer', 'handleAddPlayerModal']),
};
