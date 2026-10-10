// Tela de login.
import { estado } from './estado.js';
import { marca } from './marca.js';
import { el, icone } from './util.js';

export function telaEntrada() {
  const falhou = new URLSearchParams(location.search).get('erro') === 'login';
  const passo = (titulo, texto) => el('li', null, el('strong', null, titulo), el('span', null, texto));

  return el('main', { class: 'entrada' },
    el('section', { class: 'entrada-apresentacao' },
      marca({ grande: true }),
      el('h1', null, 'Suas denúncias, do envio à decisão.'),
      el('p', { class: 'entrada-texto' }, 'Abra um caso, envie as provas e acompanhe cada etapa da análise sem precisar abrir o Discord.'),
      el('ol', { class: 'entrada-passos' },
        passo('Abra a denúncia', 'Informe o acusado e o motivo. O tópico é criado no Discord automaticamente.'),
        passo('Envie as provas', 'Imagens, vídeos e links vão direto para o tópico do caso.'),
        passo('Acompanhe a decisão', 'Veja quem assumiu o caso, em que etapa ele está e o resultado.'))
    ),
    el('section', { class: 'entrada-acesso' },
      el('div', { class: 'entrada-cartao' },
        el('img', { class: 'entrada-logo', src: '/logo.png', alt: `Logo de ${estado.site.nome}` }),
        el('h2', null, 'Entrar'),
        el('p', null, 'Use a mesma conta do Discord que você usa no servidor.'),
        falhou && el('div', { class: 'aviso erro', role: 'alert' }, 'O login não foi concluído. Tente de novo.'),
        el('a', { class: 'botao primario largo', href: '/auth/entrar' }, 'Entrar com Discord'),
        el('p', { class: 'dica' }, icone('cadeado'), 'O site só lê seu nome e avatar. Sua senha nunca passa por aqui.')
      )
    )
  );
}
