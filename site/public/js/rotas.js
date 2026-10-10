// Rotas do site (parte depois do # no endereço).
import { aoMudarRota } from './dados.js';

export function rotaAtual() {
  const [, tipo, id] = location.hash.split('/');
  if (tipo === 'd' && id) return { tipo: 'detalhe', id };
  if (tipo === 'nova') return { tipo: 'nova' };
  if (tipo === 'ranking') return { tipo: 'ranking' };
  if (tipo === 'numeros') return { tipo: 'numeros' };
  if (tipo === 'sugestoes') return { tipo: 'sugestoes' };
  if (tipo === 'geral') return { tipo: 'geral' };
  if (tipo === 'identificar') return { tipo: 'identificar' };
  if (tipo === 'config') return { tipo: 'config' };
  if (tipo === 'chat') return { tipo: 'chat' };
  if (tipo === 'home') return { tipo: 'home' };
  if (tipo === 'jogador') return { tipo: 'jogador', id: id ? decodeURIComponent(id) : '' };
  if (tipo === 'auditoria') return { tipo: 'auditoria' };
  return { tipo: 'inicio' };
}

export function ir(hash) {
  if (location.hash === hash) aoMudarRota();
  else location.hash = hash;
}
