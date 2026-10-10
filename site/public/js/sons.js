// Sons curtos da interface, gerados na hora (sem arquivos de áudio). Podem ser
// desligados no chat; a escolha fica guardada no navegador.
import { lerPreferencia, salvarPreferencia } from './tema.js';

const CHAVE_SOM = 'althea-som';
let contexto = null;

// Cada som é uma sequência de notas: [frequência em Hz, duração em s, volume].
const SONS = {
  clique: [[520, 0.035, 0.05]],
  enviar: [[620, 0.06, 0.07], [880, 0.08, 0.07]],
  receber: [[740, 0.07, 0.06], [560, 0.09, 0.05]],
  mencao: [[660, 0.08, 0.08], [880, 0.08, 0.08], [1100, 0.12, 0.08]],
  reagir: [[900, 0.04, 0.06]],
  apagar: [[320, 0.07, 0.06], [220, 0.1, 0.05]],
  erro: [[200, 0.14, 0.07]]
};

export const somLigado = () => lerPreferencia(CHAVE_SOM) !== '0';

export function alternarSom() {
  salvarPreferencia(CHAVE_SOM, somLigado() ? '0' : '1');
  tocar('clique');
}

export function tocar(nome) {
  if (!somLigado() || !SONS[nome]) return;
  try {
    contexto ||= new (window.AudioContext || window.webkitAudioContext)();
    // O navegador só libera o áudio depois de um clique da pessoa na página.
    if (contexto.state === 'suspended') contexto.resume();

    let inicio = contexto.currentTime;
    for (const [frequencia, duracao, volume] of SONS[nome]) {
      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.value = frequencia;
      // Entrada e saída suaves, para não dar estalo.
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(volume, inicio + 0.008);
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
      oscilador.connect(ganho).connect(contexto.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + duracao + 0.02);
      inicio += duracao * 0.85;
    }
  } catch { /* sem áudio neste navegador */ }
}
