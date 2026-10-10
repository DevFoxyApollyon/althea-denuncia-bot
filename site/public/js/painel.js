// Painel inicial: saudação, números, tabela de casos e coluna de apoio.
import { finalizarDenuncia } from './acoes.js';
import { abrirArea, abrirVista, carregarLista, casosDaVista, casosVisiveis } from './dados.js';
import { desenhar } from './desenho.js';
import { EM_ANDAMENTO, FILTROS, ROTULOS_STATUS, VISTAS, estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { lerVistos, temNovidade } from './novidades.js';
import { ir } from './rotas.js';
import {
  areaDaEquipe,
  avatar,
  el,
  formatarData,
  fotoDoUsuario,
  icone,
  nomeDoSite,
  nomeDoUsuario,
  numeroDoCaso,
  papeisAtuais,
  podeAbrir,
  selo,
  seloSla,
  servidorAtual,
  slaDe,
  tempoRelativo
} from './util.js';

export function cartaoNumero({ rotulo, valor, nomeIcone, tom, filtro }) {
  const conteudo = [
    el('span', { class: `numero-icone ${tom}` }, icone(nomeIcone)),
    el('span', { class: 'numero-texto' }, el('strong', null, String(valor)), el('span', null, rotulo))
  ];
  if (!filtro) return el('div', { class: 'numero' }, conteudo);
  return el('button', {
    class: 'numero',
    type: 'button',
    'aria-pressed': String(filtro !== 'todos' && estado.filtro === filtro),
    onclick: () => {
      estado.filtro = estado.filtro === filtro ? 'todos' : filtro;
      desenhar();
    }
  }, conteudo);
}

export function numerosDoPainel() {
  if (areaDaEquipe()) {
    const fila = estado.listas.fila;
    const meus = casosDaVista('atendimentos').filter(denuncia => denuncia.aberta);
    return [
      cartaoNumero({ rotulo: 'Na fila', valor: fila.length, nomeIcone: 'caixa', tom: 'analise' }),
      cartaoNumero({ rotulo: 'Alta prioridade', valor: fila.filter(denuncia => denuncia.prioridade === 'alta').length, nomeIcone: 'alerta', tom: 'recusada' }),
      cartaoNumero({ rotulo: 'Fora do prazo', valor: fila.filter(denuncia => slaDe(denuncia)?.classe === 'estourado').length, nomeIcone: 'relogio', tom: 'recusada' }),
      cartaoNumero({ rotulo: 'Meus atendimentos abertos', valor: meus.length, nomeIcone: 'escudo', tom: 'reivindicacao' }),
      estado.visaoAdmin && cartaoNumero({ rotulo: 'Casos no total', valor: estado.totalAdmin, nomeIcone: 'grade', tom: 'aceita' })
    ];
  }

  const casos = casosDaVista('minhas');
  const contar = (lista) => casos.filter(denuncia => lista.includes(denuncia.status)).length;
  return [
    cartaoNumero({ rotulo: 'Total de denúncias', valor: casos.length, nomeIcone: 'documento', tom: 'reivindicacao', filtro: 'todos' }),
    cartaoNumero({ rotulo: 'Em andamento', valor: contar(EM_ANDAMENTO), nomeIcone: 'relogio', tom: 'analise', filtro: 'andamento' }),
    cartaoNumero({ rotulo: 'Aceitas', valor: contar(['aceita']), nomeIcone: 'visto', tom: 'aceita', filtro: 'aceita' }),
    cartaoNumero({ rotulo: 'Recusadas', valor: contar(['recusada']), nomeIcone: 'fechar', tom: 'recusada', filtro: 'recusada' })
  ];
}

export function tabelaDeCasos() {
  const vista = VISTAS[estado.vista];
  const carregando = estado.carregando[vista.escopo];
  const casos = casosDaVista();
  const visiveis = casosVisiveis();
  const responsavel = papeisAtuais().responsavel;
  const vistos = lerVistos();
  const staff = areaDaEquipe();
  const opcao = (valor, rotulo, atual) => el('option', { value: valor, selected: valor === atual }, rotulo);
  const porCategoria = new Map();
  for (const denuncia of casos) porCategoria.set(denuncia.categoria, (porCategoria.get(denuncia.categoria) || 0) + 1);
  const categoriasPresentes = [...porCategoria.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const filtrosPresentes = Object.keys(FILTROS).filter(chave =>
    chave === 'todos' || casos.some(denuncia => FILTROS[chave].status.includes(denuncia.status)));

  let corpo;
  if (carregando && !casos.length) {
    corpo = el('div', { class: 'tabela', 'aria-busy': 'true', 'aria-label': 'Carregando denúncias' },
      [0, 1, 2, 3].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))));
  } else if (!casos.length) {
    corpo = el('div', { class: 'vazio' },
      el('h3', null, estado.vista === 'fila' ? 'Fila em dia'
        : estado.vista === 'atendimentos' ? 'Nenhum caso com você'
          : estado.vista === 'admin' ? 'Nenhum caso encontrado' : 'Nenhuma denúncia ainda'),
      el('p', null, estado.vista === 'fila' ? 'Não há denúncias pendentes neste servidor.'
        : estado.vista === 'atendimentos' ? 'Reivindique um caso na fila para ele aparecer aqui.'
          : estado.vista === 'admin' ? 'Não há denúncias nos servidores em que você tem o cargo responsável.'
            : 'As denúncias que você abrir, ou em que for citado, aparecem aqui.'),
      estado.vista === 'minhas' && podeAbrir() && el('button', { class: 'primario', type: 'button', onclick: () => ir('#/nova') },
        icone('mais'), 'Fazer denúncia'));
  } else if (!visiveis.length) {
    corpo = el('div', { class: 'vazio' },
      el('h3', null, 'Nada com esse filtro'),
      el('p', null, 'Mude a busca ou o status para ver outros casos.'));
  } else {
    corpo = el('div', { class: 'tabela', role: 'list' }, visiveis.map(denuncia =>
      el('div', { class: `linha${denuncia.prioridade === 'alta' && denuncia.aberta ? ' alta' : ''}`, role: 'listitem' },
        el('button', { class: 'linha-abrir', type: 'button', onclick: () => ir(`#/d/${denuncia.id}`) },
          el('span', { class: 'celula caso-ref' },
            el('strong', null, numeroDoCaso(denuncia.id),
              !staff && temNovidade(denuncia, vistos) && el('span', { class: 'novidade', title: 'Tem novidade' }, 'novo')),
            el('span', null, formatarData(denuncia.dataCriacao))),
          el('span', { class: 'celula caso-motivo' },
            el('span', { class: 'plataforma' }, icone(denuncia.platform === 'Mobile' ? 'celular' : 'monitor')),
            el('span', { class: 'celula-texto' },
              el('strong', null, denuncia.motivo,
                denuncia.prioridade === 'alta' && el('span', { class: 'prioridade' }, 'Alta prioridade')),
              el('span', { class: 'linha-detalhes' }, el('span', { class: `categoria-chip${denuncia.categoria === 'Outros' ? ' outros' : ''}` }, denuncia.categoria),
              [estado.vista === 'admin' && denuncia.guildNome, denuncia.platform].filter(Boolean).join(', ')))),
          el('span', { class: 'celula caso-acusado' },
            icone('usuario'),
            el('span', { class: 'celula-texto' },
              el('strong', null, `Acusado ${denuncia.acusado}`),
              el('span', null, denuncia.relacao === 'acusado' ? 'Você é o acusado' : `Denunciante ${denuncia.denunciante}`))),
          el('span', { class: 'celula caso-status' }, selo(denuncia.status), staff && seloSla(denuncia)),
          icone('avancar')),
        estado.vista === 'fila' && responsavel && denuncia.aberta && el('button', {
          class: 'linha-finalizar perigo',
          type: 'button',
          onclick: (evento) => finalizarDenuncia(evento.currentTarget, denuncia)
        }, 'Finalizar'))));
  }

  return el('section', { class: 'cartao cartao-tabela' },
    el('header', { class: 'cartao-cabecalho' },
      el('div', null,
        el('h2', null, vista.titulo),
        el('p', { class: 'sub' }, vista.descricao)),
      estado.vista === 'minhas' && podeAbrir() && el('button', { class: 'primario', type: 'button', onclick: () => ir('#/nova') },
        icone('mais'), 'Nova denúncia')),
    casos.length > 1 && el('div', { class: 'tabela-ferramentas' },
      el('label', null, el('span', null, 'Plataforma'),
        el('select', {
          id: 'filtro-plataforma',
          onchange: (evento) => {
            estado.plataforma = evento.target.value;
            desenhar();
          }
        }, opcao('todas', 'Todas', estado.plataforma), opcao('PC', 'PC', estado.plataforma), opcao('Mobile', 'Mobile', estado.plataforma))),
      categoriasPresentes.length > 1 && el('label', null, el('span', null, 'Categoria'),
        el('select', {
          id: 'filtro-categoria',
          onchange: (evento) => {
            estado.categoria = evento.target.value;
            desenhar();
          }
        }, opcao('todas', 'Todas', estado.categoria), categoriasPresentes.map(nome => opcao(nome, `${nome} (${porCategoria.get(nome)})`, estado.categoria)))),
      el('label', null, el('span', null, 'Ordem'),
        el('select', {
          id: 'filtro-ordem',
          onchange: (evento) => {
            estado.ordem = evento.target.value;
            desenhar();
          }
        }, opcao('padrao', estado.vista === 'fila' ? 'Prioridade, depois mais antigas' : 'Mais novas primeiro', estado.ordem),
        opcao(estado.vista === 'fila' ? 'novas' : 'antigas', estado.vista === 'fila' ? 'Mais novas primeiro' : 'Mais antigas primeiro', estado.ordem))),
      estado.soNovidades && el('button', {
        class: 'filtro',
        type: 'button',
        'aria-pressed': 'true',
        onclick: () => {
          estado.soNovidades = false;
          desenhar();
        }
      }, 'Só com novidade', icone('fechar'))),
    filtrosPresentes.length > 2 && el('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar por status' },
      filtrosPresentes.map(chave => el('button', {
        class: 'filtro',
        type: 'button',
        'aria-pressed': String(estado.filtro === chave),
        onclick: () => {
          estado.filtro = chave;
          desenhar();
        }
      }, FILTROS[chave].rotulo))),
    corpo,
    visiveis.length > 0 && el('p', { class: 'tabela-rodape' },
      `Mostrando ${visiveis.length} de ${estado.vista === 'admin' ? estado.totalAdmin : casos.length}`),
    estado.vista === 'admin' && estado.totalPaginasAdmin > 1 && el('nav', { class: 'paginacao', 'aria-label': 'Páginas' },
      el('button', {
        type: 'button',
        disabled: estado.paginaAdmin <= 1,
        onclick: () => {
          estado.paginaAdmin -= 1;
          carregarLista('admin');
        }
      }, 'Anterior'),
      el('span', null, `${estado.paginaAdmin} de ${estado.totalPaginasAdmin}`),
      el('button', {
        type: 'button',
        disabled: estado.paginaAdmin >= estado.totalPaginasAdmin,
        onclick: () => {
          estado.paginaAdmin += 1;
          carregarLista('admin');
        }
      }, 'Próxima'))
  );
}

export function colunaDeApoio() {
  const staff = areaDaEquipe();
  const papeis = papeisAtuais();
  const recentes = [...casosDaVista()].sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao)).slice(0, 3);

  const acao = ({ titulo, texto, nomeIcone, tom, aoClicar }) => el('button', { class: `acao-rapida ${tom}`, type: 'button', onclick: aoClicar },
    el('span', { class: 'acao-icone' }, icone(nomeIcone)),
    el('span', { class: 'acao-texto' }, el('strong', null, titulo), el('span', null, texto)));

  return el('aside', { class: 'apoio' },
    el('section', { class: 'cartao' },
      el('h2', null, 'Ações rápidas'),
      el('div', { class: 'acoes-rapidas' },
        !staff && podeAbrir() && acao({ titulo: 'Fazer uma denúncia', texto: 'Relate uma irregularidade no servidor', nomeIcone: 'alerta', tom: 'recusada', aoClicar: () => ir('#/nova') }),
        !staff && papeis.staff && acao({ titulo: 'Ir para o painel da staff', texto: 'Fila e casos em atendimento', nomeIcone: 'escudo', tom: 'reivindicacao', aoClicar: () => abrirArea('staff') }),
        staff && estado.vista !== 'fila' && acao({ titulo: 'Ver a fila', texto: 'Denúncias aguardando atendimento', nomeIcone: 'caixa', tom: 'analise', aoClicar: () => abrirVista('fila') }),
        staff && estado.vista !== 'atendimentos' && acao({ titulo: 'Meus atendimentos', texto: 'Casos que você reivindicou', nomeIcone: 'escudo', tom: 'reivindicacao', aoClicar: () => abrirVista('atendimentos') }),
        staff && acao({ titulo: 'Área do jogador', texto: 'Suas próprias denúncias', nomeIcone: 'usuario', tom: 'neutro', aoClicar: () => abrirArea('jogador') }))),

    recentes.length > 0 && el('section', { class: 'cartao' },
      el('h2', null, 'Mais recentes'),
      el('ol', { class: 'atividade' }, recentes.map(denuncia => el('li', { class: denuncia.status },
        el('button', { type: 'button', onclick: () => ir(`#/d/${denuncia.id}`) },
          el('strong', null, `Denúncia ${numeroDoCaso(denuncia.id)}`),
          el('span', { title: formatarData(denuncia.dataCriacao) }, tempoRelativo(denuncia.dataCriacao)),
          el('span', { class: 'atividade-status' }, ROTULOS_STATUS[denuncia.status])))))),

    el('section', { class: 'cartao dica-cartao' },
      el('span', { class: 'numero-icone analise' }, icone('lampada')),
      el('div', null,
        el('h2', null, 'Dica'),
        el('p', null, staff
          ? 'Reivindique antes de analisar: assim o denunciante vê quem está cuidando do caso.'
          : 'Envie o máximo de provas (vídeos, prints e descrições) para agilizar a análise.')))
  );
}

export function telaPainel() {
  const staff = areaDaEquipe();
  const primeiroNome = nomeDoUsuario().split(/\s+/)[0];

  return el('main', { class: 'principal' },
    el('div', { class: 'painel-grade' },
      el('div', { class: 'painel-conteudo' },
        el('section', { class: 'boas-vindas' },
          avatar({ id: estado.usuario.id, nome: nomeDoUsuario(), url: fotoDoUsuario(), classe: 'grande' }),
          el('div', { class: 'boas-vindas-texto' },
            el('p', { class: 'boas-vindas-sobre' }, staff ? 'Painel da staff' : `Olá, ${primeiroNome}`),
            el('h1', null, nomeDoSite()),
            el('p', null, staff
              ? 'Reivindique um caso da fila para começar a análise.'
              : 'Abra casos, envie provas e acompanhe cada decisão por aqui.')),
          el('img', { class: 'boas-vindas-logo', src: '/logo.png', alt: '' })),
        blocoAviso(),
        servidorAtual()?.manutencao && el('div', { class: 'aviso manutencao', role: 'status' },
          el('span', null, 'O sistema de denúncias está em manutenção. Novas denúncias estão pausadas; as abertas continuam preservadas.')),
        el('div', { class: 'numeros' }, numerosDoPainel()),
        tabelaDeCasos()),
      colunaDeApoio())
  );
}
