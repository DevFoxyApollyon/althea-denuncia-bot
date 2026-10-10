// Tela de um caso: andamento, conversa, envio de provas, resumo e blocos da staff.
import {
  acaoStaff,
  adicionarArquivos,
  enviarAvaliacao,
  enviarProva,
  finalizarDenuncia,
  listaDeArquivos,
  salvarNota
} from './acoes.js';
import { desenhar } from './desenho.js';
import {
  ETAPAS,
  ETAPA_DO_STATUS,
  ROTULOS_ACAO,
  ROTULOS_STATUS,
  VISTAS,
  estado
} from './estado.js';
import { atalhosDeJogador } from './jogador.js';
import { blocoAviso } from './navegacao.js';
import { ir } from './rotas.js';
import {
  ampliarImagem,
  areaDaEquipe,
  avatar,
  el,
  formatarData,
  formatoDia,
  formatoHora,
  hoje,
  icone,
  linksDoYoutube,
  nomeColorido,
  numeroDoCaso,
  rico,
  selo,
  seloSla,
  servidorAtual,
  soEmojis,
  videoDoYoutube
} from './util.js';

function travarPaisagem() {
  if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
}

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) travarPaisagem();
  else screen.orientation?.unlock?.();
});

export function andamento(denuncia) {
  const atual = ETAPA_DO_STATUS[denuncia.status] ?? 0;
  return el('ol', { class: `andamento ${denuncia.status}`, 'aria-label': 'Andamento do caso' },
    ETAPAS.map((nome, indice) => {
      const situacao = indice < atual ? 'feita' : indice === atual ? 'atual' : 'futura';
      const rotulo = indice === 3 && atual === 3 ? ROTULOS_STATUS[denuncia.status] : nome;
      return el('li', { class: situacao, 'aria-current': situacao === 'atual' ? 'step' : null },
        el('span', { class: 'andamento-ponto' }, situacao === 'feita' && icone('visto')),
        el('span', { class: 'andamento-nome' }, rotulo));
    }));
}

export function anexo(item) {
  if (item.tipo.startsWith('image/')) {
    return el('a', {
      class: 'anexo-imagem',
      href: item.url,
      target: '_blank',
      rel: 'noopener',
      onclick: (evento) => {
        evento.preventDefault();
        ampliarImagem(item.url, item.nome);
      }
    }, el('img', { src: item.url, alt: item.nome, loading: 'lazy' }));
  }
  const extensao = (item.nome.split('.').pop() || '').toLowerCase();
  if (item.tipo.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm', 'ogv'].includes(extensao)) {
    const video = el('video', {
      src: item.url,
      controls: true,
      preload: 'metadata',
      playsinline: true,
      'aria-label': `Vídeo: ${item.nome}`
    });
    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
    const moldura = el('div', { class: 'video-anexo' }, video,
      el('button', {
        class: 'video-tela-cheia',
        type: 'button',
        onclick: async () => {
          try {
            if (moldura.requestFullscreen) {
              await moldura.requestFullscreen();
            } else if (video.webkitEnterFullscreen) {
              video.webkitEnterFullscreen();
            } else {
              window.open(item.url, '_blank', 'noopener');
            }
          } catch {
            if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
            else window.open(item.url, '_blank', 'noopener');
          }
        }
      }, 'Tela cheia'));

    video.addEventListener('webkitbeginfullscreen', () => {
      travarPaisagem();
    });
    video.addEventListener('webkitendfullscreen', () => screen.orientation?.unlock?.());
    return moldura;
  }
  if (item.tipo.startsWith('audio/') || ['mp3', 'm4a', 'ogg', 'opus', 'wav'].includes(extensao)) {
    return el('audio', {
      src: item.url,
      controls: true,
      preload: 'metadata',
      'aria-label': `Áudio: ${item.nome}`
    });
  }
  return el('a', { class: 'arquivo', href: item.url, target: '_blank', rel: 'noopener' },
    icone('arquivo'), el('span', null, item.nome || 'Arquivo'));
}

export function mensagem(item, { continuacao = false } = {}) {
  const pessoa = estado.detalhe.pessoas?.[item.autorId];
  const nome = pessoa?.nome || item.autorNome;
  const videos = linksDoYoutube(item.conteudo);
  const corpo = [
    item.conteudo && el('div', { class: `texto-livre${soEmojis(item.conteudo) ? ' so-emojis' : ''}` }, rico(item.conteudo)),
    item.embeds.map(embed => el('div', { class: 'texto-livre citacao' },
      embed.titulo && el('strong', null, rico(embed.titulo), '\n'), rico(embed.descricao))),
    videos.length > 0 && el('div', { class: 'anexos' }, videos.map(videoDoYoutube)),
    item.anexos.length > 0 && el('div', { class: 'anexos' }, item.anexos.map(anexo))
  ];
  const hora = el('time', { datetime: item.dataCriacao, title: formatarData(item.dataCriacao) },
    formatoHora.format(new Date(item.dataCriacao)));

  // Mensagens do próprio bot são registros do sistema, não falas de alguém.
  if (item.doBot) {
    return el('div', { class: 'registro' }, el('div', { class: 'registro-corpo' }, corpo), hora);
  }

  const propria = item.autorId === estado.usuario.id;
  const marcadores = [
    item.viaSite && el('span', { class: 'marcador' }, 'pelo site'),
    item.editadaEm && el('span', { class: 'marcador' }, 'editada'),
    item.apagadaEm && el('span', { class: 'marcador erro' }, 'apagada no Discord')
  ];
  const classes = ['mensagem', propria && 'propria', item.apagadaEm && 'apagada', continuacao && 'continuacao']
    .filter(Boolean).join(' ');

  // Mensagens seguidas da mesma pessoa ficam juntas, sem repetir foto e nome.
  if (continuacao) {
    return el('article', { class: classes },
      el('span', { class: 'mensagem-hora' }, hora),
      el('div', { class: 'mensagem-corpo' }, marcadores.some(Boolean) && el('header', null, marcadores), corpo));
  }

  return el('article', { class: classes },
    avatar({ id: item.autorId, nome, url: pessoa?.avatar, classe: 'media' }),
    el('div', { class: 'mensagem-corpo' },
      el('header', null,
        nomeColorido(nome, pessoa?.cor),
        propria && el('span', { class: 'marcador voce' }, 'você'),
        hora,
        marcadores),
      corpo));
}

// Separa a conversa por dia e junta as mensagens seguidas da mesma pessoa.
export function conversa(mensagens) {
  const JANELA_MS = 7 * 60 * 1000;
  const nos = [];
  let diaAnterior = '';
  let anterior = null;

  for (const item of mensagens) {
    const dia = formatoDia.format(new Date(item.dataCriacao));
    if (dia !== diaAnterior) {
      nos.push(el('div', { class: 'conversa-dia' }, el('span', null, dia)));
      diaAnterior = dia;
      anterior = null;
    }
    const continuacao = Boolean(anterior && !item.doBot && !anterior.doBot
      && anterior.autorId === item.autorId
      && new Date(item.dataCriacao) - new Date(anterior.dataCriacao) < JANELA_MS);
    nos.push(mensagem(item, { continuacao }));
    anterior = item;
  }
  return nos;
}

export function compositor(limiteMb) {
  const seletor = el('input', {
    type: 'file',
    id: 'arquivo',
    class: 'oculto-visualmente',
    multiple: true,
    onchange: (evento) => adicionarArquivos(evento.target.files)
  });

  const caixa = el('div', {
    class: 'compositor',
    ondragover: (evento) => {
      evento.preventDefault();
      caixa.classList.add('soltando');
    },
    ondragleave: () => caixa.classList.remove('soltando'),
    ondrop: (evento) => {
      evento.preventDefault();
      adicionarArquivos(evento.dataTransfer.files);
    }
  },
  listaDeArquivos('arquivos'),
  el('div', { class: 'compositor-linha' },
    seletor,
    el('label', { class: 'so-icone', for: 'arquivo', title: `Anexar arquivos (até ${limiteMb} MB cada)` },
      icone('clipe'), el('span', { class: 'oculto-visualmente' }, 'Anexar arquivos')),
    el('input', {
      type: 'text',
      id: 'mensagem',
      'aria-label': 'Mensagem',
      placeholder: 'Escreva, arraste arquivos ou cole um print (Ctrl+V)',
      maxlength: '1500',
      autocomplete: 'off',
      value: estado.rascunho,
      oninput: (evento) => { estado.rascunho = evento.target.value; },
      // Print copiado (Ctrl+V) entra como anexo.
      onpaste: (evento) => {
        if (!evento.clipboardData?.files?.length) return;
        evento.preventDefault();
        adicionarArquivos(evento.clipboardData.files);
      },
      onkeydown: (evento) => {
        if (evento.key === 'Enter') caixa.querySelector('.compositor-enviar').click();
      }
    }),
    el('button', {
      class: 'primario compositor-enviar',
      type: 'button',
      onclick: (evento) => enviarProva(evento.currentTarget)
    }, icone('enviar'), 'Enviar')));

  // As respostas prontas são as do servidor (editáveis em Admin > Configurações).
  const respostas = servidorAtual()?.respostasProntas || [];

  return el('div', { class: 'compositor-area' },
    areaDaEquipe() && respostas.length > 0 && el('label', { class: 'respostas-prontas' },
      el('span', null, 'Resposta pronta'),
      el('select', {
        id: 'resposta-pronta',
        onchange: (evento) => {
          const texto = respostas[Number(evento.target.value)]?.texto;
          if (texto) estado.rascunho = texto;
          desenhar();
          document.getElementById('mensagem')?.focus();
        }
      }, el('option', { value: '' }, 'Escolher…'),
      respostas.map((item, indice) => el('option', { value: String(indice) }, item.titulo)))),
    caixa,
    el('p', { class: 'dica' }, `Tudo o que você enviar é publicado no tópico do Discord. Até 10 arquivos de ${limiteMb} MB; para vídeos maiores, cole o link do YouTube.`));
}

export function painelStaff(denuncia, podeFinalizar) {
  if (estado.aceitando) {
    const formulario = el('form', { class: 'formulario', onsubmit: (evento) => evento.preventDefault() },
      el('div', { class: 'campo' },
        el('label', { for: 'acusadoId' }, 'ID do acusado'),
        el('input', { type: 'text', id: 'acusadoId', name: 'acusadoId', value: denuncia.acusado, required: true })),
      el('div', { class: 'campo' },
        el('label', { for: 'motivoPunicao' }, 'Motivo da punição'),
        el('textarea', { id: 'motivoPunicao', name: 'motivo', maxlength: '1000', required: true })),
      el('div', { class: 'campo' },
        el('label', { for: 'dataPunicao' }, 'Data da punição'),
        el('input', { type: 'text', id: 'dataPunicao', name: 'data', value: hoje(), placeholder: '31/12/2026', required: true })),
      el('div', { class: 'acoes' },
        el('button', {
          class: 'primario',
          type: 'submit',
          onclick: (evento) => {
            if (!formulario.reportValidity()) return;
            acaoStaff(evento.currentTarget, { acao: 'aceitar', ...Object.fromEntries(new FormData(formulario)) });
          }
        }, 'Aceitar denúncia'),
        el('button', {
          type: 'button',
          onclick: () => {
            estado.aceitando = false;
            desenhar();
          }
        }, 'Cancelar'))
    );
    return el('section', { class: 'cartao' }, el('h2', null, 'Aceitar denúncia'), formulario);
  }

  const botao = (rotulo, classe, acao) => el('button', {
    class: classe,
    type: 'button',
    onclick: (evento) => acaoStaff(evento.currentTarget, { acao })
  }, rotulo);

  return el('section', { class: 'cartao' },
    el('h2', null, 'Ações da staff'),
    el('div', { class: 'acoes-grade' },
      botao('Reivindicar', '', 'reivindicar'),
      botao('Analisar', '', 'analisar'),
      el('button', {
        class: 'ok',
        type: 'button',
        onclick: () => {
          estado.aceitando = true;
          desenhar();
        }
      }, 'Aceitar'),
      botao('Recusar', 'perigo', 'recusar')),
    podeFinalizar && el('button', {
      class: 'perigo largo',
      type: 'button',
      onclick: (evento) => finalizarDenuncia(evento.currentTarget, denuncia)
    }, 'Finalizar e arquivar')
  );
}

// Blocos que só a staff vê: histórico do acusado, registro de ações e notas internas.
export function blocosDaStaff() {
  const { historicoAcusado, auditoria = [], notas = [], pessoas = {}, acessos } = estado.detalhe;
  const nomeDe = (id) => pessoas[id]?.nome || 'Staff';

  return [
    historicoAcusado && el('section', { class: 'cartao' },
      el('h2', null, 'Histórico do acusado'),
      historicoAcusado.total === 0
        ? el('p', { class: 'sub' }, 'Nenhuma outra denúncia contra este ID.')
        : [
          el('p', { class: 'historico-resumo' },
            el('strong', null, String(historicoAcusado.total)), historicoAcusado.total === 1 ? ' outra denúncia, ' : ' outras denúncias, ',
            el('strong', null, String(historicoAcusado.aceitas)), historicoAcusado.aceitas === 1 ? ' aceita e ' : ' aceitas e ',
            el('strong', null, String(historicoAcusado.recusadas)), historicoAcusado.recusadas === 1 ? ' recusada.' : ' recusadas.'),
          el('ul', { class: 'historico-lista' }, historicoAcusado.casos.map(caso => el('li', null,
            el('button', { type: 'button', onclick: () => ir(`#/d/${caso.id}`) },
              el('span', null, el('strong', null, caso.motivo), el('small', null, formatarData(caso.dataCriacao))),
              selo(caso.status)))))
        ]),

    auditoria.length > 0 && el('section', { class: 'cartao' },
      el('h2', null, 'Registro de ações'),
      el('ol', { class: 'auditoria' }, auditoria.map(item => el('li', null,
        el('strong', null, nomeDe(item.autorId)),
        el('span', null, ` ${(ROTULOS_ACAO[item.acao] || item.acao).toLowerCase()}`),
        el('time', { datetime: item.data }, formatarData(item.data)))))),

    el('section', { class: 'cartao' },
      el('h2', null, 'Notas internas'),
      notas.length > 0 && el('ul', { class: 'notas' }, notas.map(nota => el('li', null,
        el('div', { class: 'texto-livre' }, nota.texto),
        el('small', null, `${nomeDe(nota.autorId)}, ${formatarData(nota.criadaEm)}`)))),
      el('textarea', {
        id: 'nota',
        'aria-label': 'Nova nota interna',
        placeholder: 'Anotação que só a staff vê',
        maxlength: '1000',
        value: estado.nota,
        oninput: (evento) => { estado.nota = evento.target.value; }
      }),
      el('button', { class: 'largo', type: 'button', onclick: (evento) => salvarNota(evento.currentTarget) }, icone('nota'), 'Salvar nota'),
      el('p', { class: 'dica' }, 'Não vai para o Discord nem aparece para o denunciante.')),

    acessos && el('section', { class: 'cartao' },
      el('h2', null, 'Acessos pelo site'),
      acessos.length
        ? el('ol', { class: 'auditoria' }, acessos.map(item => el('li', null,
          el('strong', null, pessoas[item.usuarioId]?.nome || 'Usuário'),
          el('span', null, ` abriu como ${item.relacao}`),
          el('time', { datetime: item.em }, formatarData(item.em)))))
        : el('p', { class: 'sub' }, 'Ninguém abriu este caso pelo site ainda.'))
  ];
}

// Avaliação do atendimento: o denunciante dá a nota depois da decisão.
export function cartaoDeAvaliacao() {
  const avaliacao = estado.detalhe.avaliacao;
  if (!avaliacao) return null;

  if (avaliacao.enviada && avaliacao.nota) {
    return el('section', { class: 'cartao' },
      el('h2', null, 'Avaliação do atendimento'),
      el('p', { class: 'avaliacao-nota' }, icone('estrela'), el('strong', null, `${avaliacao.nota}/10`)),
      avaliacao.comentario && el('p', { class: 'texto-livre sub' }, avaliacao.comentario));
  }
  if (!avaliacao.podeAvaliar || areaDaEquipe()) return null;

  return el('section', { class: 'cartao' },
    el('h2', null, 'Avalie o atendimento'),
    el('div', { class: 'notas-escolha', role: 'group', 'aria-label': 'Nota de 1 a 10' },
      Array.from({ length: 10 }, (_, indice) => indice + 1).map(nota => el('button', {
        type: 'button',
        'aria-pressed': String(estado.notaAvaliacao === nota),
        onclick: () => {
          estado.notaAvaliacao = nota;
          desenhar();
        }
      }, String(nota)))),
    el('textarea', {
      id: 'comentario-avaliacao',
      'aria-label': 'Comentário sobre o atendimento',
      placeholder: 'Conte como foi o atendimento (opcional)',
      maxlength: '500',
      value: estado.comentarioAvaliacao,
      oninput: (evento) => { estado.comentarioAvaliacao = evento.target.value; }
    }),
    el('button', { class: 'primario largo', type: 'button', onclick: (evento) => enviarAvaliacao(evento.currentTarget) }, 'Enviar avaliação'),
    el('p', { class: 'dica' }, 'A nota vai para a staff e entra no ranking. Só dá para avaliar uma vez.'));
}

export function telaDetalhe() {
  const voltar = el('button', { class: 'voltar', type: 'button', onclick: () => ir('#/') },
    icone('voltar'), VISTAS[estado.vista].titulo);

  if (!estado.detalhe) {
    return el('main', { class: 'principal' }, voltar, blocoAviso()
      || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando o caso' },
        el('span'), el('span'), el('span'), el('span')));
  }

  const { denuncia, mensagens, papeis, pessoas = {}, limiteUploadMb } = estado.detalhe;
  const dado = (rotulo, valor) => valor && el('div', { class: 'dado' }, el('dt', null, rotulo), el('dd', null, valor));
  const responsavel = pessoas[denuncia.claimedBy];
  // As ações de atendimento só existem no painel da staff.
  const mostrarStaff = areaDaEquipe() && papeis.staff && denuncia.aberta;

  return el('main', { class: 'principal' },
    voltar,
    el('div', { class: 'caso' },
      el('header', { class: 'caso-cabecalho' },
        el('div', { class: 'caso-titulo' },
          el('p', { class: 'caso-numero' }, `Caso ${numeroDoCaso(denuncia.id)}`),
          el('h1', null, `Denúncia contra ${denuncia.acusado}`),
          el('p', { class: 'sub' }, `${denuncia.platform}, aberta em ${formatarData(denuncia.dataCriacao)}`)),
        el('a', { class: 'botao', href: denuncia.linkDiscord, target: '_blank', rel: 'noopener noreferrer' },
          'Abrir no Discord', icone('externo'))),

      andamento(denuncia),
      blocoAviso(),

      el('div', { class: 'caso-corpo' },
        el('section', { class: 'caso-conversa', 'aria-label': 'Conversa do tópico' },
          el('div', { class: 'conversa', tabindex: '0', 'aria-label': `Conversa com ${mensagens.length} mensagens` },
            mensagens.length
              ? conversa(mensagens)
              : el('div', { class: 'vazio' },
                el('h3', null, 'Nenhuma mensagem ainda'),
                el('p', null, denuncia.aberta ? 'Envie a primeira prova no campo abaixo.' : 'Este caso foi encerrado sem mensagens no tópico.'))),
          denuncia.aberta
            ? compositor(limiteUploadMb)
            : el('p', { class: 'encerrado' }, icone('cadeado'), 'Caso encerrado. O envio de mensagens e arquivos está fechado.')),

        el('aside', { class: 'ficha', 'aria-label': 'Resumo do caso' },
          areaDaEquipe() && estado.presenca.length > 0 && el('section', { class: 'cartao presenca', role: 'status' },
            icone('olho'),
            el('span', null, `${estado.presenca.join(', ')} também ${estado.presenca.length === 1 ? 'está' : 'estão'} com este caso aberto.`)),
          (responsavel || denuncia.responsavel) && el('section', { class: 'cartao responsavel' },
            avatar({ id: denuncia.claimedBy, nome: responsavel?.nome || denuncia.responsavel, url: responsavel?.avatar, classe: 'media' }),
            el('div', null,
              el('span', null, 'Staff responsável'),
              nomeColorido(responsavel?.nome || denuncia.responsavel, responsavel?.cor))),
          el('section', { class: 'cartao' },
            el('h2', null, 'Resumo'),
            el('dl', { class: 'dados' },
              dado('Status', selo(denuncia.status)),
              // Para a staff, cada ID abre o perfil do jogador.
              dado('Denunciante', areaDaEquipe() && papeis.staff ? atalhosDeJogador(denuncia.denunciante) : denuncia.denunciante),
              dado('Acusado', areaDaEquipe() && papeis.staff ? atalhosDeJogador(denuncia.acusado) : denuncia.acusado),
              dado('Categoria', denuncia.categoria),
              dado('Prioridade', denuncia.prioridade === 'alta' ? el('span', { class: 'prioridade' }, 'Alta') : 'Normal'),
              areaDaEquipe() && dado('Prazo (SLA)', seloSla(denuncia)),
              dado('Motivo', denuncia.motivo))),
          el('section', { class: 'cartao' },
            el('h2', null, 'Provas informadas'),
            el('div', { class: 'texto-livre provas' }, denuncia.provas ? rico(denuncia.provas) : 'Nenhuma prova foi informada na abertura.'),
            linksDoYoutube(denuncia.provas).length > 0 && el('div', { class: 'anexos' }, linksDoYoutube(denuncia.provas).map(videoDoYoutube))),
          (denuncia.motivoAceite || denuncia.dataPunicao) && el('section', { class: 'cartao' },
            el('h2', null, 'Decisão da equipe'),
            el('dl', { class: 'dados' },
              dado('Punição', denuncia.motivoAceite),
              dado('Data', denuncia.dataPunicao))),
          cartaoDeAvaliacao(),
          mostrarStaff && painelStaff(denuncia, papeis.responsavel),
          areaDaEquipe() && blocosDaStaff())
      )
    )
  );
}
