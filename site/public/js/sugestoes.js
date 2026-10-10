// Sugestões dos jogadores.
import { enviarSugestao, responderSugestao } from './acoes.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { avatar, el, formatarData, icone, nomeColorido, papeisAtuais } from './util.js';

export const ROTULOS_SUGESTAO = { nova: 'Nova', analise: 'Em análise', aceita: 'Aceita', recusada: 'Recusada' };
export const SELO_DA_SUGESTAO = { nova: 'pendente', analise: 'analise', aceita: 'aceita', recusada: 'recusada' };

export function telaSugestoes() {
  // Só o painel do responsável lista e responde as sugestões de todos.
  const staff = estado.area === 'admin' && papeisAtuais().responsavel;
  const dados = estado.sugestoes;
  const pessoas = dados?.pessoas || {};

  const cartao = (item) => {
    const autor = pessoas[item.autorId];
    const formulario = staff && el('form', { class: 'sugestao-resposta', onsubmit: (evento) => evento.preventDefault() },
      el('select', { name: 'status', 'aria-label': 'Status da sugestão' },
        Object.entries(ROTULOS_SUGESTAO).map(([valor, rotulo]) => el('option', { value: valor, selected: valor === item.status }, rotulo))),
      el('input', { type: 'text', name: 'resposta', 'aria-label': 'Resposta', placeholder: 'Resposta para o jogador (opcional)', maxlength: '1000', value: item.resposta }),
      el('button', { type: 'submit', onclick: (evento) => responderSugestao(evento.currentTarget, item.id, formulario) }, 'Salvar'));

    return el('li', { class: 'sugestao' },
      el('header', null,
        staff && avatar({ id: item.autorId, nome: autor?.nome || 'Jogador', url: autor?.avatar }),
        el('div', null,
          staff && nomeColorido(autor?.nome || 'Jogador', autor?.cor),
          el('time', { datetime: item.criadaEm }, formatarData(item.criadaEm))),
        el('span', { class: `selo ${SELO_DA_SUGESTAO[item.status]}` }, ROTULOS_SUGESTAO[item.status])),
      el('p', { class: 'texto-livre' }, item.texto),
      !staff && item.resposta && el('div', { class: 'sugestao-retorno' },
        el('strong', null, `Resposta de ${pessoas[item.respondidaPor]?.nome || 'staff'}`),
        el('p', { class: 'texto-livre' }, item.resposta)),
      formulario);
  };

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      !staff && el('section', { class: 'cartao sugestao-nova' },
        el('h2', null, 'Enviar sugestão'),
        el('p', { class: 'sub' }, 'Tem uma ideia para melhorar o servidor? Conte para a administração. Para denunciar um jogador, use "Fazer denúncia".'),
        el('textarea', {
          id: 'sugestao',
          'aria-label': 'Sua sugestão',
          placeholder: 'Descreva a ideia e por que ela ajudaria o servidor',
          maxlength: '1000',
          value: estado.textoSugestao,
          oninput: (evento) => { estado.textoSugestao = evento.target.value; }
        }),
        el('div', { class: 'acoes' },
          el('button', { class: 'primario', type: 'button', onclick: (evento) => enviarSugestao(evento.currentTarget) }, icone('enviar'), 'Enviar sugestão')),
        el('p', { class: 'dica' }, 'Até 3 sugestões por dia. A resposta da administração aparece nesta página.')),
      blocoAviso(),
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, staff ? 'Sugestões dos jogadores' : 'Minhas sugestões'),
            el('p', { class: 'sub' }, staff ? 'Marque o andamento e responda. O jogador vê a resposta no site.' : 'Acompanhe o que a administração respondeu.'))),
        !dados
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : !dados.sugestoes.length
            ? el('div', { class: 'vazio' }, el('h3', null, staff ? 'Nenhuma sugestão recebida' : 'Você ainda não enviou sugestões'),
              el('p', null, staff ? 'Quando um jogador enviar, ela aparece aqui.' : 'Use o campo acima para enviar a primeira.'))
            : el('ul', { class: 'sugestoes-lista' }, dados.sugestoes.map(cartao)))));
}
