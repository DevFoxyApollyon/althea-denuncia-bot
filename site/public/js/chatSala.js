// Peças do chat além das mensagens em si: abas, quem está online, controles da
// staff (modo lento, fechar, música), reações, respostas, sinalizações e o
// player de música.
import { executar } from './acoes.js';
import { carregarChat } from './chat.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { alternarSom, somLigado, tocar } from './sons.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';
import { api, avatar, avisar, el, enviarJson, formatarData, icone, nomeColorido } from './util.js';

const CHAVE_MUSICA_OCULTA = 'althea-musica-oculta';
const parametros = () => new URLSearchParams({ guildId: estado.guildId });
const recarregar = () => carregarChat({ silencioso: true });

// ---------------------------------------------------------------- abas
export function abasDoChat() {
  const aba = (canal, rotulo) => el('button', {
    type: 'button',
    role: 'tab',
    'aria-selected': String(estado.canalChat === canal),
    onclick: () => {
      if (estado.canalChat === canal) return;
      tocar('clique');
      estado.canalChat = canal;
      estado.chat = null;
      estado.respostaChat = null;
      carregarChat();
    }
  }, rotulo);

  return el('div', { class: 'chat-abas', role: 'tablist', 'aria-label': 'Abas do chat' },
    aba('geral', '# conversa'),
    aba('avisos', '# avisos'));
}

// ---------------------------------------------------------------- barra da sala
function controlesDaStaff(chat) {
  const mudar = (botao, corpo) => executar(botao, async () => {
    const resposta = await enviarJson('/api/chat/config', { guildId: estado.guildId, ...corpo });
    avisar('ok', resposta.mensagem);
    await recarregar();
  });
  const rotuloDoModo = (segundos) => (segundos === 0 ? 'Desligado' : segundos < 60 ? `${segundos} segundos` : `${segundos / 60} minuto${segundos === 60 ? '' : 's'}`);

  return el('div', { class: 'chat-staff' },
    el('label', null, el('span', null, 'Modo lento'),
      el('select', {
        id: 'chat-modo-lento',
        onchange: (evento) => mudar(evento.target, { modoLentoSeg: Number(evento.target.value) })
      }, (chat.modosLentos || [0]).map(segundos => el('option', { value: String(segundos), selected: segundos === chat.sala.modoLentoSeg }, rotuloDoModo(segundos))))),
    el('button', {
      class: chat.sala.fechado ? 'primario' : 'perigo',
      type: 'button',
      onclick: (evento) => mudar(evento.currentTarget, { fechado: !chat.sala.fechado })
    }, icone('cadeado'), chat.sala.fechado ? 'Reabrir chat' : 'Fechar chat'),
    el('form', {
      class: 'chat-musica-form',
      onsubmit: (evento) => {
        evento.preventDefault();
        const campo = evento.currentTarget.querySelector('input');
        if (!campo.value.trim()) return;
        executar(evento.currentTarget.querySelector('button'), async () => {
          await enviarJson('/api/chat/musica', { guildId: estado.guildId, url: campo.value.trim() });
          salvarPreferencia(CHAVE_MUSICA_OCULTA, '');
          await recarregar();
        });
      }
    },
    el('input', { type: 'text', id: 'chat-musica-link', 'aria-label': 'Link da música', placeholder: 'Link do YouTube ou do Spotify' }),
    el('button', { type: 'submit' }, icone('tocar'), 'Tocar para todos')),
    chat.musica && el('button', {
      type: 'button',
      onclick: (evento) => executar(evento.currentTarget, async () => {
        await api(`/api/chat/musica?${parametros()}`, { method: 'DELETE' });
        await recarregar();
      })
    }, 'Parar música'));
}

export function barraDaSala(chat, abas) {
  if (!chat) return el('div', { class: 'chat-barra' }, abas);
  const online = chat.online || [];
  const som = somLigado();
  const oculta = chat.musica && lerPreferencia(CHAVE_MUSICA_OCULTA) === chaveDaMusica(chat.musica);

  return el('div', { class: 'chat-barra' },
    abas,
    chat.sala.modoLentoSeg > 0 && el('span', { class: 'chat-etiqueta' }, icone('relogio'), `Modo lento: ${chat.sala.modoLentoSeg} s`),
    chat.sala.fechado && el('span', { class: 'chat-etiqueta fechado' }, icone('cadeado'), 'Chat fechado'),
    el('span', { class: 'chat-barra-fim' },
      el('details', { class: 'chat-online' },
      el('summary', null, el('span', { class: 'ponto-online' }), `${online.length} online`),
      el('ul', null, online.map(pessoa => el('li', null,
        el('span', { class: 'ponto-online' }),
        el('span', null, pessoa.nome),
        pessoa.staff && el('span', { class: 'marcador' }, 'staff'))))),
      oculta && el('button', {
        class: 'ver-tudo',
        type: 'button',
        onclick: () => {
          salvarPreferencia(CHAVE_MUSICA_OCULTA, '');
          sincronizarMusica(chat.musica, chat.pessoas);
          desenhar();
        }
      }, icone('tocar'), 'Mostrar música'),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-pressed': String(som),
        'aria-label': som ? 'Desligar os sons do chat' : 'Ligar os sons do chat',
        title: som ? 'Sons ligados' : 'Sons desligados',
        onclick: () => {
          alternarSom();
          desenhar();
        }
      }, icone(som ? 'som' : 'mudo')),
      chat.podeApagar && el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-expanded': String(estado.gerirChat),
        'aria-label': 'Ajustes do chat',
        title: 'Ajustes do chat',
        onclick: () => {
          estado.gerirChat = !estado.gerirChat;
          desenhar();
        }
      }, icone('ajustes'))),
    chat.podeApagar && estado.gerirChat && controlesDaStaff(chat));
}

// ---------------------------------------------------------------- respostas
export function responderA(item, nome) {
  tocar('clique');
  estado.respostaChat = { id: item.id, autorNome: nome, trecho: (item.texto || '[arquivo]').slice(0, 120) };
  desenhar();
  document.getElementById('texto-chat')?.focus();
}

export function barraDeResposta() {
  const resposta = estado.respostaChat;
  return resposta && el('div', { class: 'chat-respondendo' },
    icone('responder'),
    el('span', null, el('strong', null, `Respondendo a ${resposta.autorNome}`), el('small', null, resposta.trecho)),
    el('button', {
      class: 'so-icone',
      type: 'button',
      'aria-label': 'Cancelar a resposta',
      onclick: () => {
        estado.respostaChat = null;
        desenhar();
      }
    }, icone('fechar')));
}

// Trecho da mensagem respondida, acima do texto; clicar leva até a original.
export function citacao(item) {
  return item.resposta && el('button', {
    class: 'chat-citacao',
    type: 'button',
    title: 'Ir para a mensagem original',
    onclick: (evento) => {
      evento.stopPropagation();
      const original = [...document.querySelectorAll('.chat-conversa .mensagem')].find(no => no.dataset.id === item.resposta.id);
      if (!original) return avisar('erro', 'A mensagem original não está mais na tela.');
      original.scrollIntoView({ block: 'center', behavior: 'smooth' });
      original.classList.add('destaque');
      setTimeout(() => original.classList.remove('destaque'), 1600);
    }
  }, icone('responder'), el('strong', null, item.resposta.autorNome), el('span', null, item.resposta.trecho));
}

// ---------------------------------------------------------------- reações
async function reagir(botao, item, emoji) {
  tocar('reagir');
  estado.reagindoChat = null;
  await executar(botao, async () => {
    await enviarJson(`/api/chat/${encodeURIComponent(item.id)}/reacoes`, { guildId: estado.guildId, emoji });
    await recarregar();
  });
}

export function reacoesDaMensagem(item, emojis) {
  const escolhendo = estado.reagindoChat === item.id;
  if (!item.reacoes.length && !escolhendo) return null;

  return el('div', { class: 'reacoes' },
    item.reacoes.map(reacao => el('button', {
      class: 'reacao',
      type: 'button',
      'aria-pressed': String(reacao.minha),
      'aria-label': `${reacao.emoji}, ${reacao.total} ${reacao.total === 1 ? 'reação' : 'reações'}`,
      onclick: (evento) => {
        evento.stopPropagation();
        reagir(evento.currentTarget, item, reacao.emoji);
      }
    }, el('span', null, reacao.emoji), el('strong', null, String(reacao.total)))),
    escolhendo && el('span', { class: 'reacao-escolha', role: 'group', 'aria-label': 'Escolher reação' },
      emojis.map(emoji => el('button', {
        type: 'button',
        'aria-label': `Reagir com ${emoji}`,
        onclick: (evento) => {
          evento.stopPropagation();
          reagir(evento.currentTarget, item, emoji);
        }
      }, emoji))));
}

// ---------------------------------------------------------------- sinalizar e apagar a própria
function perguntarMotivo(nome) {
  return new Promise((resolver) => {
    const motivo = el('textarea', { id: 'sinalizar-motivo', rows: '2', maxlength: '200', placeholder: 'O que há de errado? (opcional)' });
    const dialogo = el('dialog', { class: 'dialogo' },
      el('h2', null, `Sinalizar mensagem de ${nome}`),
      el('p', null, 'A staff recebe a mensagem para analisar. Quem escreveu não fica sabendo quem sinalizou.'),
      el('div', { class: 'campo' }, motivo),
      el('div', { class: 'dialogo-acoes' },
        el('button', { type: 'button', onclick: () => dialogo.close('nao') }, 'Cancelar'),
        el('button', { class: 'perigo-cheio', type: 'button', onclick: () => dialogo.close('sim') }, 'Sinalizar')));
    dialogo.addEventListener('close', () => {
      resolver(dialogo.returnValue === 'sim' ? { motivo: motivo.value.trim() } : null);
      dialogo.remove();
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

async function sinalizar(botao, item, nome) {
  const decisao = await perguntarMotivo(nome);
  if (!decisao) return;
  await executar(botao, async () => {
    const resposta = await enviarJson(`/api/chat/${encodeURIComponent(item.id)}/sinalizar`, { guildId: estado.guildId, motivo: decisao.motivo });
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

async function apagarPropria(botao, item) {
  tocar('apagar');
  await executar(botao, async () => {
    await api(`/api/chat/${encodeURIComponent(item.id)}?${parametros()}`, { method: 'DELETE' });
    await recarregar();
  });
}

// Botões que aparecem ao passar o mouse (ou sempre, no celular).
export function acoesDaMensagem(item, nome, { propria, podeModerar, aoModerar, prazoApagarMin, banido }) {
  const noPrazo = Date.now() - new Date(item.criadaEm).getTime() < (prazoApagarMin || 5) * 60000;
  const botao = (rotulo, nomeIcone, aoClicar, classe = '') => el('button', {
    class: `so-icone ${classe}`.trim(),
    type: 'button',
    'aria-label': `${rotulo}: mensagem de ${nome}`,
    title: rotulo,
    onclick: (evento) => {
      evento.stopPropagation();
      aoClicar(evento.currentTarget);
    }
  }, icone(nomeIcone));

  return el('span', { class: 'chat-acoes' },
    !banido && botao('Responder', 'responder', () => responderA(item, nome)),
    !banido && botao('Reagir', 'sorriso', () => {
      tocar('clique');
      estado.reagindoChat = estado.reagindoChat === item.id ? null : item.id;
      desenhar();
    }),
    !propria && !podeModerar && botao('Sinalizar para a staff', 'bandeira', (no) => sinalizar(no, item, nome)),
    propria && !podeModerar && noPrazo && botao('Apagar minha mensagem', 'lixeira', (no) => apagarPropria(no, item)),
    podeModerar && botao('Moderar: apagar, castigo, banir ou fixar', 'escudo', aoModerar, 'chat-apagar'));
}

// ---------------------------------------------------------------- fila de sinalizadas (staff)
export async function carregarSinalizadas() {
  estado.sinalizadasChat = await api(`/api/chat/sinalizacoes?${parametros()}`).catch(() => null);
  desenhar();
}

export function blocoDeSinalizadas(chat) {
  if (!chat?.podeApagar || !chat.sinalizadas) return null;
  const dados = estado.sinalizadasChat;
  const resolver = (botao, id, apagar) => executar(botao, async () => {
    await enviarJson(`/api/chat/sinalizacoes/${encodeURIComponent(id)}/resolver`, { guildId: estado.guildId, apagar });
    if (apagar) tocar('apagar');
    await carregarSinalizadas();
    await recarregar();
  });

  return el('section', { class: 'cartao' },
    el('h2', null, `Mensagens sinalizadas (${chat.sinalizadas})`),
    !dados
      ? el('button', { type: 'button', onclick: carregarSinalizadas }, 'Ver as sinalizações')
      : el('ul', { class: 'chat-sinalizadas' }, dados.sinalizacoes.map(item => el('li', null,
        el('div', null,
          el('strong', null, dados.pessoas[item.autorId]?.nome || 'Membro', ': '),
          el('span', { class: 'texto-livre' }, item.trecho),
          el('small', null, `Sinalizada por ${dados.pessoas[item.por]?.nome || 'um membro'}, ${formatarData(item.em)}${item.motivo ? `. Motivo: ${item.motivo}` : ''}`)),
        el('span', { class: 'chat-sinalizadas-acoes' },
          el('button', { class: 'perigo', type: 'button', onclick: (evento) => resolver(evento.currentTarget, item.id, true) }, 'Apagar mensagem'),
          el('button', { type: 'button', onclick: (evento) => resolver(evento.currentTarget, item.id, false) }, 'Dispensar'))))));
}

// ---------------------------------------------------------------- música
// O player fica fora da área que o site redesenha: se fosse recriado a cada
// atualização do chat, a música pararia toda hora.
let noDaMusica = null;
let chaveAtual = null;
const chaveDaMusica = (musica) => (musica ? `${musica.tipo}:${musica.ref}` : null);

export function sincronizarMusica(musica, pessoas = {}) {
  const chave = chaveDaMusica(musica);
  const oculta = chave && lerPreferencia(CHAVE_MUSICA_OCULTA) === chave;
  const desejada = oculta ? null : chave;
  if (desejada === chaveAtual) return;

  noDaMusica?.remove();
  noDaMusica = null;
  chaveAtual = desejada;
  if (!desejada) return;

  const endereco = musica.tipo === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${musica.ref}?rel=0`
    : `https://open.spotify.com/embed/${musica.ref}`;

  noDaMusica = el('aside', { class: `radio ${musica.tipo}`, 'aria-label': 'Música do chat' },
    el('header', null,
      el('span', { class: 'radio-disco' }, icone('tocar')),
      el('span', null, el('strong', null, 'Música do chat'), el('small', null, `Colocada por ${pessoas[musica.por]?.nome || 'staff'}. Aperte o play para ouvir.`)),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': 'Esconder a música',
        title: 'Esconder (só para você)',
        onclick: () => {
          salvarPreferencia(CHAVE_MUSICA_OCULTA, chave);
          sincronizarMusica(musica, pessoas);
          desenhar();
        }
      }, icone('fechar'))),
    el('iframe', { src: endereco, title: 'Player da música do chat', allow: 'autoplay; encrypted-media; picture-in-picture', loading: 'lazy' }));
  document.body.append(noDaMusica);
}

// ---------------------------------------------------------------- quem está online
// Coluna ao lado da conversa, com a staff em cima, como a lista de membros do Discord.
export function listaDeOnline(chat) {
  if (!chat) return null;
  const online = chat.online || [];
  const grupo = (titulo, pessoas) => pessoas.length > 0 && [
    el('h3', null, `${titulo}, ${pessoas.length}`),
    el('ul', null, pessoas.map(pessoa => {
      const dados = chat.pessoas[pessoa.id];
      return el('li', { class: pessoa.id === estado.usuario.id ? 'eu' : '' },
        avatar({ id: pessoa.id, nome: dados?.nome || pessoa.nome, url: dados?.avatar }),
        nomeColorido(dados?.nome || pessoa.nome, dados?.cor));
    }))
  ];

  return el('aside', { class: 'chat-membros', 'aria-label': `Online agora: ${online.length}` },
    el('h2', null, `Online agora (${online.length})`),
    grupo('Staff', online.filter(pessoa => pessoa.staff)),
    grupo('Membros', online.filter(pessoa => !pessoa.staff)),
    !online.length && el('p', { class: 'sub' }, 'Ninguém com o chat aberto.'));
}
