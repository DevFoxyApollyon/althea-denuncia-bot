const { EventEmitter } = require('events');

// Avisa o site quando algo muda num tópico de denúncia (mensagem nova, editada,
// apagada ou mudança de status). A chave é o ID do tópico no Discord.
const eventos = new EventEmitter();
eventos.setMaxListeners(0);

function avisarMudanca(threadId) {
  if (threadId) eventos.emit(`topico:${threadId}`);
}

function ouvirMudancas(threadId, aoMudar) {
  const canal = `topico:${threadId}`;
  eventos.on(canal, aoMudar);
  return () => eventos.off(canal, aoMudar);
}

// Mudança de status de uma denúncia (usada pelas notificações do navegador).
function avisarStatus(denuncia) {
  if (denuncia?.threadId) eventos.emit('status', denuncia);
}

function ouvirStatus(aoMudar) {
  eventos.on('status', aoMudar);
  return () => eventos.off('status', aoMudar);
}

module.exports = { avisarMudanca, ouvirMudancas, avisarStatus, ouvirStatus };
