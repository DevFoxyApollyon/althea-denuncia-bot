// Tema claro/escuro e preferências salvas no navegador.
import { desenhar } from './desenho.js';
import { CHAVE_TEMA } from './estado.js';

export function temaAtual() {
  const salvo = document.documentElement.dataset.tema;
  if (salvo) return salvo;
  return 'escuro';
}

export function lerPreferencia(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}

export function salvarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* sem persistência */ }
}

export function alternarTema() {
  const novo = temaAtual() === 'claro' ? 'escuro' : 'claro';
  document.documentElement.dataset.tema = novo;
  salvarPreferencia(CHAVE_TEMA, novo);
  desenhar();
}
