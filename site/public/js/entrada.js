// Tela de login.
import { estado } from './estado.js';
import { marca } from './marca.js';
import { el, icone } from './util.js';

export function telaEntrada() {
  const erro = new URLSearchParams(location.search).get('erro');
  const falhou = erro === 'login';
  const bloqueado = erro === 'bloqueado';

  return el('main', { class: 'entrada' },
    el('section', { class: 'entrada-apresentacao' },
      marca({ grande: true }),
      el('h1', null, 'Suas denúncias, do envio à decisão.'),
      el('p', { class: 'entrada-texto' }, 'Abra um caso, envie as provas e acompanhe cada etapa da análise sem precisar abrir o Discord.')
    ),
    el('section', { class: 'entrada-acesso' },
      el('div', { class: 'entrada-cartao' },
        el('img', { class: 'entrada-logo', src: '/logo.png', alt: `Logo de ${estado.site.nome}` }),
        el('h2', null, 'Entrar'),
        el('p', null, 'Use a mesma conta do Discord que você usa no servidor.'),
        falhou && el('div', { class: 'aviso erro', role: 'alert' }, 'O login não foi concluído. Tente de novo.'),
        bloqueado && el('div', { class: 'aviso erro', role: 'alert' }, 'Esta conta está bloqueada no bot e não pode entrar no site.'),
        el('a', { class: 'botao primario largo', href: '/auth/entrar' }, 'Entrar com Discord'),
        el('p', { class: 'dica' }, icone('cadeado'), 'O site só lê seu nome e avatar. Sua senha nunca passa por aqui. Ao entrar, você concorda com os termos de serviço.'),
        el('p', { class: 'politicas' }, el('a', { href: '/termos.html' }, 'Termos'), el('a', { href: '/privacidade.html' }, 'Privacidade'), el('a', { href: '/cookies.html' }, 'Cookies'))
      )
    )
  );
}
