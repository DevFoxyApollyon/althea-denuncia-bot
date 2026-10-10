// Página inicial neutra: abre ao clicar na logo. Não pertence a nenhuma área
// (jogador, staff ou admin). É onde a pessoa escolhe em qual servidor entrar.
import { abrirArea, entrarNoServidor } from './dados.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { novidadesDoJogador } from './novidades.js';
import { ir } from './rotas.js';
import { el, icone, iniciais, nomeDoSite, nomeDoUsuario, papeisAtuais, podeAbrir } from './util.js';

const papelEm = (papeis) => (papeis.responsavel ? 'Responsável' : papeis.staff ? 'Staff' : 'Jogador');

function cartaoDoServidor(servidor) {
  const atual = servidor.id === estado.guildId;
  return el('button', {
    class: `servidor-cartao${atual ? ' atual' : ''}`,
    type: 'button',
    'aria-current': atual ? 'true' : null,
    onclick: () => entrarNoServidor(servidor.id)
  },
  servidor.icone
    ? el('img', { class: 'servidor-icone', src: servidor.icone, alt: '' })
    : el('span', { class: 'servidor-icone' }, iniciais(servidor.nome.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || 'S')),
  el('span', { class: 'servidor-texto' },
    el('strong', null, servidor.nome),
    el('span', null,
      el('span', { class: `servidor-papel ${servidor.papeis.responsavel ? 'responsavel' : servidor.papeis.staff ? 'staff' : ''}` }, papelEm(servidor.papeis)),
      servidor.manutencao && el('span', { class: 'servidor-papel manutencao' }, 'Em manutenção'),
      atual && el('span', { class: 'servidor-papel' }, 'Você está aqui'))),
  icone('avancar'));
}

export function telaHome() {
  const papeis = papeisAtuais();
  const novidades = novidadesDoJogador().length;
  const atalho = ({ titulo, texto, nomeIcone, tom, aoClicar }) => el('button', { class: `acao-rapida ${tom}`, type: 'button', onclick: aoClicar },
    el('span', { class: 'acao-icone' }, icone(nomeIcone)),
    el('span', { class: 'acao-texto' }, el('strong', null, titulo), el('span', null, texto)));

  return el('main', { class: 'principal' },
    el('div', { class: 'home' },
      el('header', { class: 'pagina-titulo' },
        el('h1', null, `Olá, ${nomeDoUsuario().split(/\s+/)[0]}`)),
      blocoAviso(),

      el('section', { class: 'cartao' },
        el('h2', null, estado.servidores.length > 1 ? 'Escolha o servidor' : 'Seu servidor'),
        el('div', { class: 'servidores' }, estado.servidores.map(cartaoDoServidor))),

      el('section', { class: 'cartao' },
        el('h2', null, `Atalhos em ${nomeDoSite()}`),
        el('div', { class: 'home-atalhos' },
          atalho({
            titulo: 'Minhas denúncias',
            texto: novidades ? `${novidades} com novidade` : 'As que você abriu ou em que foi citado',
            nomeIcone: 'casa', tom: 'neutro', aoClicar: () => abrirArea('jogador')
          }),
          podeAbrir() && atalho({ titulo: 'Fazer uma denúncia', texto: 'Relate uma irregularidade no servidor', nomeIcone: 'alerta', tom: 'recusada', aoClicar: () => ir('#/nova') }),
          atalho({ titulo: 'Chat do servidor', texto: 'Converse com os outros membros', nomeIcone: 'balao', tom: 'neutro', aoClicar: () => ir('#/chat') }),
          atalho({ titulo: 'Denúncias abertas', texto: 'Veja se você foi citado em alguma', nomeIcone: 'busca', tom: 'neutro', aoClicar: () => ir('#/identificar') }),
          papeis.staff && atalho({ titulo: 'Painel da staff', texto: 'Fila e casos em atendimento', nomeIcone: 'escudo', tom: 'reivindicacao', aoClicar: () => abrirArea('staff') }),
          papeis.responsavel && atalho({ titulo: 'Painel do responsável', texto: 'Visão geral, números e configurações', nomeIcone: 'grade', tom: 'analise', aoClicar: () => abrirArea('admin') })))));
}
