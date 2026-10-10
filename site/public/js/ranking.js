// Ranking da staff.
import { carregarRanking } from './dados.js';
import { desenhar } from './desenho.js';
import { PERIODOS, estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { cartaoNumero } from './painel.js';
import { avatar, el, nomeColorido } from './util.js';

export function telaRanking() {
  const lista = estado.ranking?.staff;
  // O total de cada staff é o número de denúncias que ele reivindicou: cada caso
  // conta uma vez, em vez de somar reivindicação, análise e decisão.
  const porCasos = lista && [...lista].sort((a, b) => b.reivindicacoes - a.reivindicacoes);
  const duracao = (minutos) => minutos === null ? 'sem dado'
    : minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Ranking da staff'),
            el('p', { class: 'sub' }, 'Dados do /rank do Discord. O total é o número de denúncias reivindicadas por cada staff no período.')),
          el('div', { class: 'areas periodos', role: 'group', 'aria-label': 'Período' },
            Object.entries(PERIODOS).map(([chave, rotulo]) => el('button', {
              type: 'button',
              'aria-pressed': String(estado.periodoRanking === chave),
              onclick: () => {
                estado.periodoRanking = chave;
                estado.ranking = null;
                desenhar();
                carregarRanking();
              }
            }, rotulo)))),
        blocoAviso(),
        estado.ranking?.totais && el('div', { class: 'numeros ranking-resumo' },
          cartaoNumero({ rotulo: 'Denúncias hoje', valor: estado.ranking.hoje?.total ?? 0, nomeIcone: 'documento', tom: 'reivindicacao' }),
          cartaoNumero({ rotulo: 'Pendentes hoje', valor: estado.ranking.hoje?.pendentes ?? 0, nomeIcone: 'relogio', tom: 'analise' }),
          cartaoNumero({ rotulo: 'Aceitas no período', valor: estado.ranking.totais.aceitas, nomeIcone: 'visto', tom: 'aceita' }),
          cartaoNumero({ rotulo: 'Nota média', valor: estado.ranking.qualidade ? `${estado.ranking.qualidade.media.toFixed(1)}/10` : '—', nomeIcone: 'trofeu', tom: 'recusada' })),
        !lista
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1, 2].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : !lista.length
            ? el('div', { class: 'vazio' }, el('h3', null, 'Sem ações neste período'), el('p', null, 'Quando a staff atender denúncias, o ranking aparece aqui.'))
            : el('ol', { class: 'ranking-lista' }, porCasos.map((pessoa, indice) => el('li', null,
              el('span', { class: 'ranking-posicao' }, String(indice + 1)),
              avatar({ id: pessoa.id, nome: pessoa.nome, url: pessoa.avatar, classe: 'media' }),
              el('span', { class: 'ranking-nome' }, nomeColorido(pessoa.nome, pessoa.cor),
                el('small', null, [
                  pessoa.qualidade ? `Nota ${pessoa.qualidade.media.toFixed(1)}/10 em ${pessoa.qualidade.avaliacoes} ${pessoa.qualidade.avaliacoes === 1 ? 'avaliação' : 'avaliações'}` : 'Sem avaliações',
                  `reivindica em ${duracao(pessoa.minutosAteReivindicar)}`
                ].join(', '))),
              el('dl', { class: 'ranking-numeros' },
                el('div', null, el('dt', null, 'Total'), el('dd', null, String(pessoa.reivindicacoes))),
                el('div', { class: 'aceita' }, el('dt', null, 'Aceitas'), el('dd', null, String(pessoa.aceitas))),
                el('div', { class: 'recusada' }, el('dt', null, 'Recusadas'), el('dd', null, String(pessoa.recusadas))),
                el('div', { class: 'analise' }, el('dt', null, 'Análises'), el('dd', null, String(pessoa.analises))))))))));
}
