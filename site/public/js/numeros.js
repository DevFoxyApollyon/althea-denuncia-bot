// Avaliação do atendimento e números do servidor.
import { carregarNumeros } from './dados.js';
import { desenhar } from './desenho.js';
import { ROTULOS_STATUS, estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { cartaoNumero } from './painel.js';
import { SVG, el, selo } from './util.js';

// Gráfico de barras em SVG: uma barra por dia, com o total no título.
export function graficoPorDia(porDia) {
  const largura = 720;
  const altura = 190;
  const base = altura - 24;
  const maximo = Math.max(1, ...porDia.map(item => item.total));
  const passo = largura / Math.max(1, porDia.length);
  const cada = Math.ceil(porDia.length / 8);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  svg.setAttribute('class', 'grafico');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Denúncias por dia; pico de ${maximo}`);

  porDia.forEach((item, indice) => {
    const h = Math.max(item.total ? 3 : 1, (item.total / maximo) * (base - 14));
    const barra = document.createElementNS(SVG, 'rect');
    barra.setAttribute('x', String(indice * passo + passo * 0.14));
    barra.setAttribute('y', String(base - h));
    barra.setAttribute('width', String(passo * 0.72));
    barra.setAttribute('height', String(h));
    barra.setAttribute('rx', '2');
    barra.setAttribute('class', item.total ? 'barra' : 'barra vazia');
    const [, mes, dia] = item.dia.split('-');
    const titulo = document.createElementNS(SVG, 'title');
    titulo.textContent = `${dia}/${mes}: ${item.total}`;
    barra.append(titulo);
    svg.append(barra);

    if (indice % cada === 0) {
      const rotulo = document.createElementNS(SVG, 'text');
      rotulo.setAttribute('x', String(indice * passo + passo / 2));
      rotulo.setAttribute('y', String(altura - 6));
      rotulo.setAttribute('text-anchor', 'middle');
      rotulo.textContent = `${dia}/${mes}`;
      svg.append(rotulo);
    }
  });
  return svg;
}

export function telaNumeros() {
  const numeros = estado.numeros;
  const duracao = (minutos) => minutos === null || minutos === undefined ? 'sem dado'
    : minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
  const maiorCategoria = Math.max(1, ...(numeros?.porCategoria || []).map(item => item.total));

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Números do servidor'),
            el('p', { class: 'sub' }, 'Volume de denúncias, categorias mais comuns e resultado das análises.')),
          el('div', { class: 'areas periodos', role: 'group', 'aria-label': 'Período' },
            [7, 30, 45].map(dias => el('button', {
              type: 'button',
              'aria-pressed': String(estado.diasNumeros === dias),
              onclick: () => {
                estado.diasNumeros = dias;
                estado.numeros = null;
                desenhar();
                carregarNumeros();
              }
            }, `${dias} dias`)))),
        blocoAviso(),
        !numeros
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1, 2].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : [
            el('div', { class: 'numeros ranking-resumo' },
              cartaoNumero({ rotulo: 'Denúncias no período', valor: numeros.total, nomeIcone: 'documento', tom: 'reivindicacao' }),
              cartaoNumero({ rotulo: 'Taxa de denúncias aceitas', valor: numeros.taxaDeAceite === null ? 'sem dado' : `${Math.round(numeros.taxaDeAceite * 100)}%`, nomeIcone: 'visto', tom: 'aceita' }),
              cartaoNumero({ rotulo: 'Tempo até reivindicar', valor: duracao(numeros.minutosAteReivindicar), nomeIcone: 'relogio', tom: 'analise' }),
              cartaoNumero({ rotulo: `SLA cumprido (${numeros.foraDoPrazo || 0} fora do prazo agora)`, valor: numeros.slaCumprido === null || numeros.slaCumprido === undefined ? 'sem dado' : `${Math.round(numeros.slaCumprido * 100)}%`, nomeIcone: 'alerta', tom: 'reivindicacao' }),
              cartaoNumero({ rotulo: `Nota média (${numeros.avaliacoes || 0})`, valor: numeros.notaMedia ? `${numeros.notaMedia.toFixed(1)}/10` : '—', nomeIcone: 'estrela', tom: 'recusada' })),
            el('div', { class: 'numeros-bloco' },
              el('h3', null, 'Denúncias por dia'),
              numeros.total ? graficoPorDia(numeros.porDia) : el('p', { class: 'sub' }, 'Nenhuma denúncia neste período.')),
            numeros.porCategoria.length > 0 && el('div', { class: 'numeros-bloco' },
              el('h3', null, 'Por categoria'),
              el('ul', { class: 'categorias-barras' }, numeros.porCategoria.map(item => {
                const barra = el('span', { class: 'categoria-barra' });
                barra.style.width = `${Math.max(2, (item.total / maiorCategoria) * 100)}%`;
                return el('li', null, el('span', { class: 'categoria-nome' }, item.nome), el('span', { class: 'categoria-trilho' }, barra), el('strong', null, String(item.total)));
              }))),
            el('div', { class: 'numeros-bloco' },
              el('h3', null, 'Por status'),
              el('div', { class: 'status-lista' }, Object.keys(ROTULOS_STATUS).filter(status => numeros.porStatus[status])
                .map(status => el('span', null, selo(status), el('strong', null, String(numeros.porStatus[status]))))),
              el('p', { class: 'dica' }, 'A taxa de denúncias aceitas considera só os casos aceitos e recusados que ainda não foram finalizados.'))
          ])));
}
