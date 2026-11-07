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

// Algo mudou nas denúncias de um servidor (nova, reivindicada, decidida...):
// as listas abertas no site se atualizam na hora.
function avisarServidor(guildId) {
  if (guildId) eventos.emit(`servidor:${guildId}`);
}

function ouvirServidor(guildId, aoMudar) {
  const canal = `servidor:${guildId}`;
  eventos.on(canal, aoMudar);
  return () => eventos.off(canal, aoMudar);
}

// Os cargos ou o apelido de alguém mudaram no Discord (ou a pessoa saiu do
// servidor): o site dela confere de novo o que ela pode fazer.
function avisarAcesso(userId) {
  if (userId) eventos.emit(`acesso:${userId}`);
}

function ouvirAcesso(userId, aoMudar) {
  const canal = `acesso:${userId}`;
  eventos.on(canal, aoMudar);
  return () => eventos.off(canal, aoMudar);
}

function ouvirStatus(aoMudar) {
  eventos.on('status', aoMudar);
  return () => eventos.off('status', aoMudar);
}

module.exports = { avisarMudanca, ouvirMudancas, avisarStatus, ouvirStatus, avisarServidor, ouvirServidor, avisarAcesso, ouvirAcesso };
