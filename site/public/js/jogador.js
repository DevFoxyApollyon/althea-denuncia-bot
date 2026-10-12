// Perfil do jogador (só staff): tudo o que há sobre um ID de conta do jogo.
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { cartaoNumero } from './painel.js';
import { ir, rotaAtual } from './rotas.js';
import { avatar, el, formatarData, icone, nomeColorido, numeroDoCaso, selo } from './util.js';

// A partir de quantas denúncias aceitas o jogador é destacado como reincidente.
const REINCIDENCIA = 2;

const abrirPerfil = (conta) => ir(`#/jogador/${encodeURIComponent(String(conta).trim())}`);

// IDs de uma denúncia ("1039+2471") como atalhos para o perfil de cada um.
export function atalhosDeJogador(texto) {
  const ids = String(texto || '').split('+').map(id => id.trim()).filter(Boolean);
  return el('span', { class: 'atalhos-jogador' }, ids.map(id => /^[\w.-]{1,20}$/.test(id)
    ? el('button', { class: 'atalho-jogador', type: 'button', title: `Ver o perfil do jogador ${id}`, onclick: () => abrirPerfil(id) }, id)
    : el('span', null, id)));
}

function buscaDeJogador(conta) {
  return el('form', {
    class: 'jogador-busca',
    onsubmit: (evento) => {
      evento.preventDefault();
      const valor = new FormData(evento.currentTarget).get('conta').trim();
      if (valor) abrirPerfil(valor);
    }
  },
  el('label', { class: 'busca' },
    icone('busca'),
    el('input', { type: 'search', id: 'conta-jogador', name: 'conta', 'aria-label': 'ID do jogador', placeholder: 'ID do jogador, como 2471', maxlength: '20', value: conta || '' })),
  el('button', { class: 'primario', type: 'submit' }, 'Ver perfil'));
}

function listaDeCasos(casos, vazio) {
  if (!casos.length) return el('p', { class: 'sub' }, vazio);
  return el('ul', { class: 'historico-lista' }, casos.map(caso => el('li', null,
    el('button', { type: 'button', onclick: () => ir(`#/d/${caso.id}`) },
      el('span', null,
        el('strong', null, caso.motivo),
        el('small', null, `${numeroDoCaso(caso.id)}, ${caso.categoria}, ${formatarData(caso.dataCriacao)}`)),
      selo(caso.resultado === 'aceita' && caso.status === 'finalizada' ? 'aceita' : caso.status)))));
}

const porcento = (valor) => (valor === null ? 'sem dados' : `${Math.round(valor * 100)}%`);

export function telaJogador() {
  const conta = rotaAtual().id;
  const perfil = estado.jogador;
  const topo = el('header', { class: 'config-topo' },
    el('div', null,
      el('h1', null, conta ? `Jogador ${conta}` : 'Perfil do jogador'),
      el('p', { class: 'sub' }, 'Denúncias recebidas e feitas, punições e reincidência. O histórico cobre os últimos 45 dias, que é o tempo que as denúncias ficam guardadas.')),
    buscaDeJogador(conta));

  if (!conta) {
    return el('main', { class: 'principal' }, el('div', { class: 'jogador' }, topo, blocoAviso(),
      el('div', { class: 'vazio alto' },
        el('h3', null, 'Busque um jogador pelo ID'),
        el('p', null, 'Dentro de um caso, clique no ID do acusado ou do denunciante para abrir o perfil direto.'))));
  }

  if (!perfil) {
    return el('main', { class: 'principal' }, el('div', { class: 'jogador' }, topo, blocoAviso() || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando o perfil' },
      el('span'), el('span'), el('span'), el('span'))));
  }

  const { recebidas, feitas, punicoes, contasDiscord, chat } = perfil;
  const tempo = (minutos) => (minutos % 1440 === 0 ? `${minutos / 1440} dia(s)` : minutos % 60 === 0 ? `${minutos / 60} hora(s)` : `${minutos} minuto(s)`);
  const reincidente = recebidas.aceitas >= REINCIDENCIA;

  return el('main', { class: 'principal' },
    el('div', { class: 'jogador' },
      topo,
      blocoAviso(),

      reincidente && el('div', { class: 'aviso reincidente', role: 'status' },
        el('span', null, icone('alerta'), `Reincidente: ${recebidas.aceitas} denúncias aceitas contra este jogador nos últimos 45 dias.`)),

      contasDiscord.length > 0 && el('section', { class: 'cartao jogador-contas' },
        el('h2', null, contasDiscord.length === 1 ? 'Conta do Discord' : 'Contas do Discord com este ID'),
        el('ul', null, contasDiscord.map(pessoa => el('li', null,
          avatar({ id: pessoa.id, nome: pessoa.nome, url: pessoa.avatar, classe: 'media' }),
          nomeColorido(pessoa.nome, pessoa.cor))))),

      el('div', { class: 'numeros' },
        cartaoNumero({ rotulo: 'Denúncias recebidas', valor: recebidas.total, nomeIcone: 'alerta', tom: 'recusada' }),
        cartaoNumero({ rotulo: 'Aceitas contra ele', valor: recebidas.aceitas, nomeIcone: 'visto', tom: reincidente ? 'recusada' : 'analise' }),
        cartaoNumero({ rotulo: 'Denúncias feitas', valor: feitas.total, nomeIcone: 'documento', tom: 'reivindicacao' }),
        cartaoNumero({ rotulo: 'Taxa de denúncias aceitas', valor: porcento(feitas.taxaDeAceitas), nomeIcone: 'grafico', tom: 'aceita' })),

      el('div', { class: 'jogador-grade' },
        el('section', { class: 'cartao' },
          el('h2', null, 'Punições'),
          punicoes.length
            ? el('ol', { class: 'punicoes' }, punicoes.map(item => el('li', null,
              el('button', { type: 'button', onclick: () => ir(`#/d/${item.id}`) },
                el('strong', null, item.punicao || item.motivo),
                el('small', null, [item.categoria, item.dataPunicao || formatarData(item.dataCriacao), numeroDoCaso(item.id)].join(', '))))))
            : el('p', { class: 'sub' }, 'Nenhuma denúncia aceita contra este jogador.')),

        el('section', { class: 'cartao' },
          el('h2', null, 'Punições no chat'),
          chat?.itens.length
            ? [
              el('p', { class: 'historico-resumo' },
                el('strong', null, String(chat.castigos)), chat.castigos === 1 ? ' castigo e ' : ' castigos e ',
                el('strong', null, String(chat.banimentos)), chat.banimentos === 1 ? ' banimento nos últimos 90 dias.' : ' banimentos nos últimos 90 dias.'),
              el('ol', { class: 'punicoes chat' }, chat.itens.map(item => el('li', { class: item.acao },
                el('strong', null, item.acao === 'castigo' ? `Castigo de ${tempo(item.minutos || 0)}` : 'Banimento do chat'),
                el('small', null, `${item.motivo || 'Sem motivo registrado'}. Por ${item.por}, ${formatarData(item.em)}`))))
            ]
            : el('p', { class: 'sub' }, contasDiscord.length
              ? 'Nenhum castigo ou banimento no chat nos últimos 90 dias.'
              : 'Sem conta do Discord ligada a este ID, não dá para saber as punições no chat.')),

        el('section', { class: 'cartao' },
          el('h2', null, 'Do que é acusado'),
          recebidas.porCategoria.length
            ? el('ul', { class: 'jogador-categorias' }, recebidas.porCategoria.map(item => el('li', null,
              el('span', { class: `categoria-chip${item.nome === 'Outros' ? ' outros' : ''}` }, item.nome),
              el('strong', null, String(item.total)))))
            : el('p', { class: 'sub' }, 'Nenhuma denúncia recebida.'),
          el('p', { class: 'historico-resumo' },
            el('strong', null, String(recebidas.andamento)), ' em análise, ',
            el('strong', null, String(recebidas.recusadas)), recebidas.recusadas === 1 ? ' recusada.' : ' recusadas.')),

        el('section', { class: 'cartao' },
          el('h2', null, `Denúncias recebidas (${recebidas.total})`),
          listaDeCasos(recebidas.casos, 'Nenhuma denúncia contra este ID.')),

        el('section', { class: 'cartao' },
          el('h2', null, `Denúncias feitas (${feitas.total})`),
          feitas.total > 0 && el('p', { class: 'historico-resumo' },
            el('strong', null, String(feitas.aceitas)), feitas.aceitas === 1 ? ' aceita, ' : ' aceitas, ',
            el('strong', null, String(feitas.recusadas)), feitas.recusadas === 1 ? ' recusada e ' : ' recusadas e ',
            el('strong', null, String(feitas.andamento)), ' em análise.'),
          listaDeCasos(feitas.casos, 'Este jogador não abriu denúncias.')))));
}
