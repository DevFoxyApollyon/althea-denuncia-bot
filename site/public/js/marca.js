// Logo e nome do servidor.
import { el, nomeDoSite } from './util.js';

export function marca({ grande = false } = {}) {
  return el('a', { class: `marca${grande ? ' grande' : ''}`, href: '#/home', title: `${nomeDoSite()}: escolher o servidor` },
    el('img', { class: 'marca-logo', src: '/logo.png', alt: '' }),
    el('span', { class: 'marca-texto' },
      el('strong', null, nomeDoSite()),
      el('span', null, 'Portal de denúncias')));
}
