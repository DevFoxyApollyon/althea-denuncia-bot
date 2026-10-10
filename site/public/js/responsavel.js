// Painel do responsável: visão geral e auditoria.
import { abrirVista } from './dados.js';
import { ROTULOS_ACAO, estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { graficoPorDia } from './numeros.js';
import { cartaoNumero } from './painel.js';
import { ir } from './rotas.js';
import {
  avatar,
  el,
  formatarData,
  fotoDoUsuario,
  icone,
  nomeColorido,
  nomeDoSite,
  nomeDoUsuario,
  numeroDoCaso,
  seloSla,
  slaDe,
  tempoRelativo
} from './util.js';

export function linhaDeAcao(item, pessoas) {
  const autor = pessoas[item.autorId];
  return el('li', null,
    avatar({ id: item.autorId, nome: autor?.nome || 'Staff', url: autor?.avatar }),
    el('div', { class: 'acao-detalhe' },
      el('span', null, nomeColorido(autor?.nome || 'Staff', autor?.cor), ` ${(ROTULOS_ACAO[item.acao] || item.acao).toLowerCase()}`),
      item.caso
        ? el('button', { class: 'acao-caso', type: 'button', onclick: () => ir(`#/d/${item.caso.id}`) },
          `${numeroDoCaso(item.caso.id)}, acusado ${item.caso.acusado}: ${item.caso.motivo}`)
        : el('small', null, 'Caso já removido do banco')),
    el('time', { datetime: item.data, title: formatarData(item.data) }, tempoRelativo(item.data)));
}

const duracao = (minutos) => (minutos % 1440 === 0 ? `${minutos / 1440} dia(s)` : minutos % 60 === 0 ? `${minutos / 60} hora(s)` : `${minutos} minuto(s)`);

// Uma linha da moderação do chat: quem fez, o quê, com quem e por quê.
function linhaDoChat(item, pessoas) {
  const staff = pessoas[item.staffId];
  const alvo = pessoas[item.alvoId]?.nome || 'um membro';
  const feito = {
    apagar: `apagou uma mensagem de ${alvo}`,
    castigo: `deu castigo de ${duracao(item.minutos || 0)} em ${alvo}`,
    banimento: `baniu ${alvo} do chat`,
    remocao: `removeu a punição de ${alvo}`,
    fixar: `fixou no topo uma mensagem de ${alvo}`,
    desafixar: 'tirou o aviso fixado do chat'
  }[item.acao] || item.acao;

  return el('li', null,
    avatar({ id: item.staffId, nome: staff?.nome || 'Staff', url: staff?.avatar }),
    el('div', { class: 'acao-detalhe' },
      el('span', null, nomeColorido(staff?.nome || 'Staff', staff?.cor), ` ${feito}`),
      (item.motivo || item.trecho) && el('small', null, item.motivo ? `Motivo: ${item.motivo}` : `Mensagem: ${item.trecho}`)),
    el('time', { datetime: item.em, title: formatarData(item.em) }, tempoRelativo(item.em)));
}

export function telaAuditoria() {
  const dados = estado.auditoria;
  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Auditoria'),
            el('p', { class: 'sub' }, 'As 80 ações mais recentes da staff neste servidor.'))),
        blocoAviso(),
        !dados
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1, 2].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : !dados.acoes.length
            ? el('div', { class: 'vazio' }, el('h3', null, 'Nenhuma ação registrada'), el('p', null, 'As ações do mês atual aparecem aqui.'))
            : el('ol', { class: 'acoes-lista' }, dados.acoes.map(item => linhaDeAcao(item, dados.pessoas)))),

      dados && el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Moderação do chat'),
            el('p', { class: 'sub' }, 'Mensagens apagadas, castigos e banimentos aplicados pela staff no chat do servidor, com o motivo. Fica guardado por 90 dias.'))),
        dados.chat?.length
          ? el('ol', { class: 'acoes-lista' }, dados.chat.map(item => linhaDoChat(item, dados.pessoas)))
          : el('div', { class: 'vazio' }, el('h3', null, 'Nada registrado'), el('p', null, 'Quando a staff apagar uma mensagem ou punir alguém no chat, aparece aqui.'))),

      // Denúncias abertas podem ser vistas por qualquer membro; aqui fica quem viu.
      dados && el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Acessos a denúncias abertas'),
            el('p', { class: 'sub' }, 'Quem abriu pelo site uma denúncia de que não é parte (nem denunciante, nem acusado, nem staff). Um registro a cada 30 minutos por pessoa e caso.'))),
        dados.acessosAbertos?.length
          ? el('ol', { class: 'acoes-lista' }, dados.acessosAbertos.map(item => {
            const pessoa = dados.pessoas[item.usuarioId];
            return el('li', null,
              avatar({ id: item.usuarioId, nome: pessoa?.nome || 'Membro', url: pessoa?.avatar }),
              el('div', { class: 'acao-detalhe' },
                el('span', null, nomeColorido(pessoa?.nome || 'Membro', pessoa?.cor), ' abriu'),
                item.caso
                  ? el('button', { class: 'acao-caso', type: 'button', onclick: () => ir(`#/d/${item.caso.id}`) },
                    `${numeroDoCaso(item.caso.id)}, acusado ${item.caso.acusado}: ${item.caso.motivo}`)
                  : el('small', null, 'Caso já removido do banco')),
              el('time', { datetime: item.em, title: formatarData(item.em) }, tempoRelativo(item.em)));
          }))
          : el('div', { class: 'vazio' }, el('h3', null, 'Nenhum acesso registrado'), el('p', null, 'Quando alguém de fora do caso abrir uma denúncia aberta, aparece aqui.')))));
}

export function telaVisaoGeral() {
  const geral = estado.geral;
  if (!geral) {
    return el('main', { class: 'principal' }, el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando a visão geral' },
      el('span'), el('span'), el('span'), el('span')));
  }

  const { numeros, ranking, sugestoes, auditoria } = geral;
  const fila = estado.listas.fila;
  const urgentes = fila.filter(denuncia => denuncia.prioridade === 'alta' || slaDe(denuncia)?.classe === 'estourado').slice(0, 6);
  const novas = (sugestoes?.sugestoes || []).filter(item => item.status === 'nova');
  const porcento = (valor) => valor === null || valor === undefined ? 'sem dado' : `${Math.round(valor * 100)}%`;
  const bloco = (titulo, acao, conteudo) => el('section', { class: 'cartao' },
    el('header', { class: 'bloco-cabecalho' }, el('h2', null, titulo), acao), conteudo);
  const verTudo = (rotulo, aoClicar) => el('button', { class: 'ver-tudo', type: 'button', onclick: aoClicar }, rotulo, icone('avancar'));

  return el('main', { class: 'principal' },
    el('div', { class: 'geral' },
      el('section', { class: 'boas-vindas' },
        avatar({ id: estado.usuario.id, nome: nomeDoUsuario(), url: fotoDoUsuario(), classe: 'grande' }),
        el('div', { class: 'boas-vindas-texto' },
          el('p', { class: 'boas-vindas-sobre' }, 'Painel do responsável'),
          el('h1', null, nomeDoSite()),
          el('p', null, 'Tudo o que acontece nas denúncias do servidor: volume, prazos, equipe e sugestões.')),
        el('img', { class: 'boas-vindas-logo', src: '/logo.png', alt: '' })),
      blocoAviso(),

      el('div', { class: 'numeros' },
        cartaoNumero({ rotulo: 'Denúncias em 30 dias', valor: numeros?.total ?? 'sem dado', nomeIcone: 'documento', tom: 'reivindicacao' }),
        cartaoNumero({ rotulo: 'Na fila agora', valor: fila.length, nomeIcone: 'caixa', tom: 'analise' }),
        cartaoNumero({ rotulo: 'Fora do prazo', valor: fila.filter(denuncia => slaDe(denuncia)?.classe === 'estourado').length, nomeIcone: 'relogio', tom: 'recusada' }),
        cartaoNumero({ rotulo: 'SLA cumprido', valor: porcento(numeros?.slaCumprido), nomeIcone: 'alerta', tom: 'aceita' }),
        cartaoNumero({ rotulo: 'Taxa de denúncias aceitas', valor: porcento(numeros?.taxaDeAceite), nomeIcone: 'visto', tom: 'aceita' }),
        cartaoNumero({ rotulo: 'Nota média', valor: numeros?.notaMedia ? `${numeros.notaMedia.toFixed(1)}/10` : '—', nomeIcone: 'estrela', tom: 'analise' })),

      el('div', { class: 'geral-grade' },
        bloco('Precisa de atenção', verTudo('Abrir a fila', () => abrirVista('fila')),
          urgentes.length
            ? el('ul', { class: 'atencao' }, urgentes.map(denuncia => el('li', null,
              el('button', { type: 'button', onclick: () => ir(`#/d/${denuncia.id}`) },
                el('span', null, el('strong', null, denuncia.motivo), el('small', null, `${numeroDoCaso(denuncia.id)}, acusado ${denuncia.acusado}`)),
                seloSla(denuncia) || el('span', { class: 'prioridade' }, 'Alta')))))
            : el('p', { class: 'sub' }, 'Nenhum caso de alta prioridade ou fora do prazo na fila.')),

        bloco('Denúncias por dia', verTudo('Ver números', () => ir('#/numeros')),
          numeros?.total ? graficoPorDia(numeros.porDia) : el('p', { class: 'sub' }, 'Nenhuma denúncia nos últimos 30 dias.')),

        bloco('Equipe no mês', verTudo('Ver ranking', () => ir('#/ranking')),
          ranking?.staff?.length
            ? el('ol', { class: 'equipe' }, [...ranking.staff].sort((a, b) => b.reivindicacoes - a.reivindicacoes).slice(0, 5).map((pessoa, indice) => el('li', null,
              el('span', { class: 'ranking-posicao' }, String(indice + 1)),
              avatar({ id: pessoa.id, nome: pessoa.nome, url: pessoa.avatar }),
              el('span', { class: 'ranking-nome' }, nomeColorido(pessoa.nome, pessoa.cor),
                el('small', null, pessoa.qualidade ? `Nota ${pessoa.qualidade.media.toFixed(1)}/10` : 'Sem avaliações')),
              el('strong', null, String(pessoa.reivindicacoes)))))
            : el('p', { class: 'sub' }, 'Nenhuma ação registrada neste mês.')),

        bloco('Últimas ações', verTudo('Ver auditoria', () => ir('#/auditoria')),
          auditoria?.acoes?.length
            ? el('ol', { class: 'acoes-lista compacta' }, auditoria.acoes.slice(0, 6).map(item => linhaDeAcao(item, auditoria.pessoas)))
            : el('p', { class: 'sub' }, 'Nenhuma ação registrada.')),

        bloco(`Sugestões novas (${novas.length})`, verTudo('Ver sugestões', () => ir('#/sugestoes')),
          novas.length
            ? el('ul', { class: 'notas' }, novas.slice(0, 3).map(item => el('li', null,
              el('div', { class: 'texto-livre' }, item.texto),
              el('small', null, `${sugestoes.pessoas[item.autorId]?.nome || 'Jogador'}, ${formatarData(item.criadaEm)}`))))
            : el('p', { class: 'sub' }, 'Nenhuma sugestão aguardando resposta.')),

        numeros?.porCategoria?.length > 0 && bloco('Categorias mais comuns', null,
          el('ul', { class: 'categorias-barras' }, numeros.porCategoria.slice(0, 6).map(item => {
            const barra = el('span', { class: 'categoria-barra' });
            barra.style.width = `${Math.max(2, (item.total / numeros.porCategoria[0].total) * 100)}%`;
            return el('li', null, el('span', { class: 'categoria-nome' }, item.nome), el('span', { class: 'categoria-trilho' }, barra), el('strong', null, String(item.total)));
          }))))));
}
