// Casos com atividade que a pessoa ainda não viu.
import { casosDaVista } from './dados.js';
import { CHAVE_VISTOS } from './estado.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';

export function lerVistos() {
  try { return JSON.parse(lerPreferencia(CHAVE_VISTOS) || '{}') || {}; } catch { return {}; }
}

export function marcarVisto(id) {
  const vistos = lerVistos();
  vistos[id] = Date.now();
  // Guarda só os 300 casos mais recentes.
  const recentes = Object.entries(vistos).sort((a, b) => b[1] - a[1]).slice(0, 300);
  salvarPreferencia(CHAVE_VISTOS, JSON.stringify(Object.fromEntries(recentes)));
}

// Tem novidade quando houve atividade depois da última vez que a pessoa abriu
// o caso (ou, se nunca abriu, depois da criação).
export function temNovidade(denuncia, vistos = lerVistos()) {
  if (!denuncia.ultimaAtividade) return false;
  const referencia = vistos[denuncia.id] || new Date(denuncia.dataCriacao).getTime() + 60 * 1000;
  return new Date(denuncia.ultimaAtividade).getTime() > referencia;
}

export const novidadesDoJogador = () => {
  const vistos = lerVistos();
  return casosDaVista('minhas').filter(denuncia => temNovidade(denuncia, vistos));
};
