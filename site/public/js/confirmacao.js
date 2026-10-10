// Diálogo de confirmação.
import { el } from './util.js';

export function confirmar({ titulo, texto, rotulo, perigo = false }) {
  return new Promise((resolver) => {
    const dialogo = el('dialog', { class: 'dialogo' },
      el('h2', null, titulo),
      el('p', null, texto),
      el('div', { class: 'dialogo-acoes' },
        el('button', { type: 'button', onclick: () => dialogo.close('nao') }, 'Cancelar'),
        el('button', { class: perigo ? 'perigo-cheio' : 'primario', type: 'button', onclick: () => dialogo.close('sim') }, rotulo))
    );
    dialogo.addEventListener('close', () => {
      resolver(dialogo.returnValue === 'sim');
      dialogo.remove();
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}
