// Chat do servidor: uma sala para os membros. A staff pode apagar mensagens.
import { conversaNoFim, executar, rolarConversaParaOFim } from './acoes.js';
import { anexo } from './caso.js';
import { abasDoChat, acoesDaMensagem, barraDaSala, listaDeOnline, barraDeResposta, blocoDeSinalizadas, citacao, reacoesDaMensagem } from './chatSala.js';
import { desenhar } from './desenho.js';
import { CHAVE_CHAT, estado, raiz } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { rotaAtual } from './rotas.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';
import { api, avatar, avisar, el, enviarJson, formatarData, formatoDia, formatoHora, icone, nomeColorido, rico } from './util.js';

const LIMITE_TEXTO = 500;
const semAcento = (texto) => String(texto || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// O ponto em que a pessoa estava lendo e o que estava escrevendo ficam
// guardados no navegador: ao recarregar a página, o chat continua dali.
function lerPosicao() {
  try { return JSON.parse(lerPreferencia(CHAVE_CHAT) || '{}')[estado.guildId] || {}; } catch { return {}; }
}

function guardarPosicao(mudanca) {
  let tudo = {};
  try { tudo = JSON.parse(lerPreferencia(CHAVE_CHAT) || '{}') || {}; } catch { /* começa do zero */ }
  tudo[estado.guildId] = { ...tudo[estado.guildId], ...mudanca };
  salvarPreferencia(CHAVE_CHAT, JSON.stringify(tudo));
}

// Até quando a pessoa já leu o chat deste servidor (guardado no navegador).
export const lidaAteDoChat = () => lerPosicao().lidaAte || null;

// Quantas mensagens chegaram desde a última leitura; alimenta o contador do menu.
export async function carregarNovasDoChat() {
  if (!estado.guildId || rotaAtual().tipo === 'chat') return;
  const guildId = estado.guildId;
  const parametros = new URLSearchParams({ guildId });
  if (lidaAteDoChat()) parametros.set('desde', lidaAteDoChat());
  const novas = await api(`/api/chat/novas?${parametros}`).catch(() => null);
  if (!novas || estado.guildId !== guildId) return;
  const mudou = novas.total !== estado.chatNovas.total || novas.mencoes !== estado.chatNovas.mencoes;
  estado.chatNovas = novas;
  if (mudou && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) desenhar();
}

function guardarRolagem(evento) {
  const lista = evento.currentTarget;
  const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
  // Guarda a mensagem do topo da tela, não os pixels: a lista muda de tamanho.
  const primeira = [...lista.querySelectorAll('.mensagem')].find(item => item.offsetTop + item.offsetHeight > lista.scrollTop);
  guardarPosicao({ noFim, mensagem: noFim ? null : primeira?.dataset.id || null });
}

function restaurarPosicao() {
  const { noFim = true, mensagem, texto } = lerPosicao();
  if (texto && !estado.textoChat) {
    estado.textoChat = texto;
    desenhar();
  }
  const lista = raiz.querySelector('.chat-conversa');
  // Havendo mensagens novas, a tela abre na linha "Novas mensagens".
  const novas = lista?.querySelector('.conversa-dia.novas');
  const alvo = novas || (!noFim && mensagem && [...lista?.querySelectorAll('.mensagem') || []].find(item => item.dataset.id === mensagem));
  if (alvo) lista.scrollTop = Math.max(0, alvo.offsetTop - lista.offsetTop - 12);
  else rolarConversaParaOFim();
}

export async function carregarChat({ silencioso = false } = {}) {
  const guildId = estado.guildId;
  const primeira = !estado.chat;
  const noFim = conversaNoFim();
  try {
    const dados = await api(`/api/chat?${new URLSearchParams({ guildId, canal: estado.canalChat })}`);
    if (rotaAtual().tipo !== 'chat' || estado.guildId !== guildId) return;
    // Ao abrir, guarda até onde a pessoa tinha lido: é ali que entra a linha
    // "Novas mensagens". Enquanto ela está com o chat na tela, tudo conta como lido.
    if (primeira) estado.chatLidaAte = lidaAteDoChat();
    estado.chat = dados;
    if (!document.hidden) guardarPosicao({ lidaAte: new Date().toISOString() });
    estado.chatNovas = { total: 0, mencoes: 0 };
  } catch (erro) {
    if (silencioso) return;
    estado.chat = { mensagens: [], pessoas: {}, podeApagar: false, sala: { modoLentoSeg: 0, fechado: false }, online: [], emojis: [], sinalizadas: 0 };
    avisar('erro', erro.message);
  }
  desenhar();
  if (primeira) restaurarPosicao();
  else if (noFim) rolarConversaParaOFim();
}

// Pessoas que dá para marcar: quem aparece no chat (menos você).
function pessoasDoChat() {
  return Object.entries(estado.chat?.pessoas || {})
    .filter(([id]) => id !== estado.usuario.id)
    .map(([id, pessoa]) => ({ id, nome: pessoa.nome }));
}

// Enquanto a pessoa digita "@nome", sugere quem marcar.
function atualizarSugestoes(campo) {
  const antes = campo.value.slice(0, campo.selectionStart ?? campo.value.length);
  const termo = /(?:^|\s)@([^\s@]{1,30})$/.exec(antes)?.[1];
  // A staff pode marcar o servidor inteiro com @all.
  const todos = estado.chat?.podeApagar && termo && ['all', 'todos'].some(palavra => palavra.startsWith(semAcento(termo)))
    ? [{ id: 'all', nome: 'all' }]
    : [];
  const sugestoes = termo
    ? [...todos, ...pessoasDoChat().filter(pessoa => semAcento(pessoa.nome).includes(semAcento(termo))).slice(0, 6)]
    : [];
  const mudou = sugestoes.map(pessoa => pessoa.id).join() !== estado.sugestoesChat.map(pessoa => pessoa.id).join();
  estado.sugestoesChat = sugestoes;
  if (mudou) desenhar();
}

function marcar(pessoa) {
  const campo = document.getElementById('texto-chat');
  const cursor = campo.selectionStart ?? campo.value.length;
  const antes = campo.value.slice(0, cursor).replace(/@[^\s@]{1,30}$/, `@${pessoa.nome} `);
  estado.textoChat = antes + campo.value.slice(cursor);
  if (pessoa.id !== 'all') estado.mencoesChat[pessoa.nome] = pessoa.id;
  estado.sugestoesChat = [];
  guardarPosicao({ texto: estado.textoChat });
  desenhar();
  const novo = document.getElementById('texto-chat');
  novo.focus();
  novo.setSelectionRange(antes.length, antes.length);
}

// Troca cada "@Nome" escolhido na lista pelo formato que identifica a pessoa.
function textoComMencoes(texto) {
  // Vale tanto para quem clicou na sugestão quanto para quem digitou o nome
  // inteiro de alguém que está no chat. Nomes mais longos primeiro.
  const conhecidos = { ...Object.fromEntries(pessoasDoChat().map(pessoa => [pessoa.nome, pessoa.id])), ...estado.mencoesChat };
  const nomes = Object.keys(conhecidos).filter(nome => /^\d{15,21}$/.test(conhecidos[nome])).sort((a, b) => b.length - a.length);
  return nomes.reduce((atual, nome) => {
    const padrao = new RegExp(`@${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'gi');
    return atual.replace(padrao, `<@${conhecidos[nome]}>`);
  }, texto);
}

async function enviar(formulario) {
  const texto = textoComMencoes(estado.textoChat.trim());
  const arquivo = estado.arquivoChat;
  if (!texto && !arquivo) return;
  await executar(formulario.querySelector('button[type="submit"]'), async () => {
    if (arquivo) {
      // O arquivo vai como corpo da requisição; nome e texto, em cabeçalhos.
      await api(`/api/chat/arquivos?${new URLSearchParams({ guildId: estado.guildId, canal: estado.canalChat })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Arquivo-Nome': encodeURIComponent(arquivo.name), 'X-Mensagem': encodeURIComponent(texto) },
        body: arquivo
      });
    } else {
      await enviarJson('/api/chat', { guildId: estado.guildId, texto, canal: estado.canalChat, respostaA: estado.respostaChat?.id });
    }
    estado.respostaChat = null;
    estado.textoChat = '';
    estado.mencoesChat = {};
    estado.sugestoesChat = [];
    estado.arquivoChat = null;
    guardarPosicao({ texto: '', noFim: true, mensagem: null });
    await carregarChat({ silencioso: true });
    rolarConversaParaOFim();
  });
}

function escolherArquivo(arquivo) {
  if (!arquivo) return;
  const limite = estado.chat?.limiteArquivoMb || 20;
  if (!/^(image|audio|video)\//.test(arquivo.type)) avisar('erro', 'No chat só entram imagens, áudios e vídeos.');
  else if (arquivo.size > limite * 1024 * 1024) avisar('erro', `No chat, cada arquivo pode ter até ${limite} MB. Para vídeos maiores, mande o link do YouTube.`);
  else estado.arquivoChat = arquivo;
  desenhar();
}

// Moderação de uma mensagem: um diálogo só, com as três ações da staff.
// Castigo pede tempo e motivo; banimento pede motivo; apagar não pede nada.
const UNIDADES = { minutos: 1, horas: 60, dias: 24 * 60 };

function abrirModeracao(nome, podePunir, podeFixar) {
  return new Promise((resolver) => {
    const tempo = el('input', { type: 'number', id: 'castigo-tempo', min: '1', max: '720', step: '1', value: '10', 'aria-label': 'Tempo do castigo' });
    const unidade = el('select', { id: 'castigo-unidade', 'aria-label': 'Unidade do tempo' },
      Object.keys(UNIDADES).map(nomeDaUnidade => el('option', { value: nomeDaUnidade }, nomeDaUnidade)));
    const motivo = el('textarea', { id: 'punicao-motivo', maxlength: '200', rows: '2', placeholder: 'Motivo (aparece para a pessoa e na auditoria)' });
    const erro = el('p', { class: 'dialogo-erro', role: 'alert', hidden: true });
    const campoTempo = el('div', { class: 'campo moderacao-tempo', hidden: true }, el('label', { for: 'castigo-tempo' }, 'Tempo do castigo'), el('div', null, tempo, unidade));
    const campoMotivo = el('div', { class: 'campo', hidden: true }, el('label', { for: 'punicao-motivo' }, 'Motivo'), motivo);
    const aplicar = el('button', { class: 'perigo-cheio', type: 'button' }, 'Apagar mensagem');

    let acao = 'apagar';
    const ROTULOS = { apagar: 'Apagar mensagem', castigo: 'Dar castigo', banimento: 'Banir do chat', fixar: 'Fixar no topo' };
    const opcao = (valor, titulo, texto) => el('label', { class: valor === 'banimento' ? 'banimento' : '' },
      el('input', {
        type: 'radio', name: 'moderacao', value: valor, checked: valor === acao,
        onchange: () => {
          acao = valor;
          campoTempo.hidden = valor !== 'castigo';
          campoMotivo.hidden = !['castigo', 'banimento'].includes(valor);
          erro.hidden = true;
          aplicar.textContent = ROTULOS[valor];
        }
      }),
      el('span', null, el('strong', null, titulo), el('small', null, texto)));

    aplicar.addEventListener('click', () => {
      const falha = ['castigo', 'banimento'].includes(acao) && motivo.value.trim().length < 3 ? 'Escreva o motivo.'
        : acao === 'castigo' && !(Number(tempo.value) >= 1) ? 'Informe o tempo do castigo.'
          : acao === 'castigo' && Number(tempo.value) * UNIDADES[unidade.value] > 30 * 24 * 60 ? 'O castigo pode ter no máximo 30 dias.'
            : '';
      if (falha) {
        erro.textContent = falha;
        erro.hidden = false;
        return;
      }
      dialogo.close('sim');
    });

    const dialogo = el('dialog', { class: 'dialogo moderacao' },
      el('h2', null, `Moderar mensagem de ${nome}`),
      el('p', null, 'Tudo o que for feito aqui fica registrado na auditoria.'),
      el('div', { class: 'punicoes-chat', role: 'radiogroup', 'aria-label': 'Ação' },
        opcao('apagar', 'Apagar mensagem', 'Some do chat para todos.'),
        podePunir && opcao('castigo', 'Dar castigo', 'Não escreve no chat pelo tempo que você definir.'),
        podePunir && opcao('banimento', 'Banir do chat', 'Não escreve mais, até a staff remover.'),
        podeFixar && opcao('fixar', 'Fixar no topo', 'Vira o aviso preso no topo do chat, para todos.')),
      !podePunir && el('p', { class: 'dica' }, 'Castigo e banimento não aparecem porque esta mensagem é sua.'),
      campoTempo,
      campoMotivo,
      erro,
      el('div', { class: 'dialogo-acoes' },
        el('button', { type: 'button', onclick: () => dialogo.close('nao') }, 'Cancelar'),
        aplicar));
    dialogo.addEventListener('close', () => {
      resolver(dialogo.returnValue === 'sim'
        ? { acao, motivo: motivo.value.trim(), minutos: Math.round(Number(tempo.value) * UNIDADES[unidade.value]) }
        : null);
      dialogo.remove();
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

async function moderar(botao, item, nome) {
  const decisao = await abrirModeracao(nome, item.autorId !== estado.usuario.id, Boolean(item.texto));
  if (!decisao) return;
  await executar(botao, async () => {
    if (decisao.acao === 'fixar') {
      await enviarJson('/api/chat/fixada', { guildId: estado.guildId, mensagemId: item.id });
    } else if (decisao.acao === 'apagar') {
      await api(`/api/chat/${encodeURIComponent(item.id)}?${new URLSearchParams({ guildId: estado.guildId })}`, { method: 'DELETE' });
    } else {
      await enviarJson('/api/chat/banimentos', {
        guildId: estado.guildId,
        usuarioId: item.autorId,
        motivo: decisao.motivo,
        minutos: decisao.acao === 'castigo' ? decisao.minutos : null
      });
    }
    await carregarChat({ silencioso: true });
  });
}

async function desafixar(botao) {
  await executar(botao, async () => {
    await api(`/api/chat/fixada?${new URLSearchParams({ guildId: estado.guildId })}`, { method: 'DELETE' });
    await carregarChat({ silencioso: true });
  });
}

async function desbanir(botao, usuarioId) {
  await executar(botao, async () => {
    await api(`/api/chat/banimentos/${encodeURIComponent(usuarioId)}?${new URLSearchParams({ guildId: estado.guildId })}`, { method: 'DELETE' });
    await carregarChat({ silencioso: true });
  });
}

function mensagemDoChat(item, chat, continuacao = false) {
  const { pessoas, podeApagar } = chat;
  const pessoa = pessoas[item.autorId];
  const nome = pessoa?.nome || item.autorNome || 'Membro';
  const propria = item.autorId === estado.usuario.id;

  const hora = el('time', { datetime: item.criadaEm, title: formatarData(item.criadaEm) }, formatoHora.format(new Date(item.criadaEm)));

  // Para a staff, clicar na mensagem abre a moderação (links, vídeos e
  // imagens dentro dela continuam funcionando normalmente).
  const aoClicar = podeApagar && ((evento) => {
    if (evento.target.closest('a, button, video, audio, img, iframe')) return;
    moderar(evento.currentTarget.querySelector('.chat-apagar'), item, nome);
  });

  return el('article', {
    class: `mensagem${continuacao ? ' continuacao' : ''}${propria ? ' propria' : ''}${podeApagar ? ' moderavel' : ''}${item.todos || item.mencoes?.includes(estado.usuario.id) ? ' mencionado' : ''}`,
    'data-id': item.id,
    onclick: aoClicar
  },
    continuacao
      ? el('span', { class: 'mensagem-hora' }, hora)
      : avatar({ id: item.autorId, nome, url: pessoa?.avatar, classe: 'media' }),
    el('div', { class: 'mensagem-corpo' },
      !continuacao && el('header', null,
        nomeColorido(nome, pessoa?.cor),
        hora,
        item.todos && el('span', { class: 'marcador todos' }, '@all')),
      citacao(item),
      item.texto && el('div', { class: 'texto-livre' }, rico(item.texto, { pessoas, cargos: {}, canais: {} })),
      item.anexo && el('div', { class: 'anexos' }, anexo(item.anexo)),
      reacoesDaMensagem(item, chat.emojis || [])),
    acoesDaMensagem(item, nome, {
      propria,
      podeModerar: podeApagar,
      aoModerar: (botao) => moderar(botao, item, nome),
      prazoApagarMin: chat.prazoApagarMin,
      banido: Boolean(chat.banido)
    }));
}

export function telaChat() {
  const chat = estado.chat;
  const nos = [];
  let diaAnterior = '';
  let linhaDeNovas = false;
  let anterior = null;
  for (const item of chat?.mensagens || []) {
    const dia = formatoDia.format(new Date(item.criadaEm));
    if (dia !== diaAnterior) nos.push(el('div', { class: 'conversa-dia' }, dia));
    diaAnterior = dia;
    // A linha entra antes da primeira mensagem que chegou depois da última leitura.
    if (!linhaDeNovas && estado.chatLidaAte && item.autorId !== estado.usuario.id && new Date(item.criadaEm) > new Date(estado.chatLidaAte)) {
      linhaDeNovas = true;
      nos.push(el('div', { class: 'conversa-dia novas', role: 'separator' }, 'Novas mensagens'));
    }
    // Junta com a anterior quando é a mesma pessoa, em menos de 7 minutos,
    // sem nada no meio (troca de dia, linha de novas, resposta ou @all).
    const junta = anterior && nos.at(-1)?.classList.contains('mensagem') && anterior.autorId === item.autorId
      && !item.resposta && !item.todos && new Date(item.criadaEm) - new Date(anterior.criadaEm) < 7 * 60 * 1000;
    nos.push(mensagemDoChat(item, chat, Boolean(junta)));
    anterior = item;
  }

  const formulario = el('form', {
    class: 'compositor-area',
    onsubmit: (evento) => {
      evento.preventDefault();
      enviar(evento.currentTarget);
    }
  },
  el('div', { class: 'compositor' },
    barraDeResposta(),
    estado.arquivoChat && el('div', { class: 'compositor-arquivo' },
      icone('clipe'),
      el('span', null, estado.arquivoChat.name),
      el('small', null, `${(estado.arquivoChat.size / 1024 / 1024).toFixed(1)} MB`),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': 'Remover o arquivo',
        onclick: () => {
          estado.arquivoChat = null;
          desenhar();
        }
      }, icone('fechar'))),
    estado.sugestoesChat.length > 0 && el('div', { class: 'chat-sugestoes', role: 'listbox', 'aria-label': 'Marcar alguém' },
      estado.sugestoesChat.map(pessoa => el('button', { type: 'button', role: 'option', onclick: () => marcar(pessoa) }, `@${pessoa.nome}`))),
    el('div', { class: 'compositor-linha' },
      el('input', {
        type: 'file',
        id: 'arquivo-chat',
        class: 'oculto-visualmente',
        accept: 'image/*,audio/*,video/*',
        onchange: (evento) => escolherArquivo(evento.target.files[0])
      }),
      el('label', { class: 'so-icone', for: 'arquivo-chat', title: `Enviar imagem, áudio ou vídeo (até ${chat?.limiteArquivoMb || 20} MB)` },
        icone('clipe'), el('span', { class: 'oculto-visualmente' }, 'Enviar imagem, áudio ou vídeo')),
      el('input', {
        type: 'text',
        id: 'texto-chat',
        'aria-label': 'Mensagem para o chat',
        placeholder: estado.canalChat === 'avisos' ? 'Escrever um aviso' : 'Conversar em #conversa',
        maxlength: String(LIMITE_TEXTO),
        autocomplete: 'off',
        value: estado.textoChat,
        oninput: (evento) => {
          estado.textoChat = evento.target.value;
          guardarPosicao({ texto: estado.textoChat });
          atualizarSugestoes(evento.target);
        }
      }),
      el('button', { class: 'so-icone compositor-enviar', type: 'submit', 'aria-label': 'Enviar', title: 'Enviar (Enter)' }, icone('enviar')))));

  return el('main', { class: 'principal' },
    el('div', { class: 'chat' },
      blocoAviso(),
      el('div', { class: 'chat-corpo' },
      el('section', { class: 'cartao chat-cartao' },
        barraDaSala(chat, abasDoChat()),
        chat?.fixada && el('div', { class: 'chat-fixada' },
          icone('alerta'),
          el('div', null,
            el('div', { class: 'texto-livre' }, rico(chat.fixada.texto, { pessoas: chat.pessoas, cargos: {}, canais: {} })),
            el('small', null, `Aviso fixado, de ${chat.pessoas[chat.fixada.autorId]?.nome || 'staff'}`)),
          chat.podeApagar && el('button', { class: 'ver-tudo', type: 'button', onclick: (evento) => desafixar(evento.currentTarget) }, 'Desafixar')),
        el('div', { class: 'conversa chat-conversa', tabindex: '0', onscroll: chat ? guardarRolagem : null, 'aria-label': 'Mensagens do chat', 'aria-busy': chat ? null : 'true' },
          !chat
            ? el('div', { class: 'carregador', role: 'status', 'aria-label': 'Carregando o chat' }, el('span'), el('span'), el('span'))
            : nos.length
              ? nos
              : el('div', { class: 'vazio' },
                el('h3', null, estado.canalChat === 'avisos' ? 'Nenhum aviso ainda' : 'Ninguém escreveu ainda'),
                el('p', null, estado.canalChat === 'avisos' ? 'Os avisos da staff aparecem aqui.' : 'Mande a primeira mensagem para o servidor.'))),
        chat?.banido
          ? el('p', { class: 'encerrado' }, icone('cadeado'), chat.banido.expiraEm
            ? `Você está de castigo no chat até ${formatarData(chat.banido.expiraEm)}.${chat.banido.motivo ? ` Motivo: ${chat.banido.motivo}.` : ''} Ainda pode ler as mensagens.`
            : `Você foi banido do chat deste servidor pela staff.${chat.banido.motivo ? ` Motivo: ${chat.banido.motivo}.` : ''} Ainda pode ler as mensagens.`)
          : chat && !chat.podeApagar && estado.canalChat === 'avisos'
            ? el('p', { class: 'encerrado' }, icone('cadeado'), 'Nesta aba só a staff escreve. Para conversar, volte para a aba Conversa.')
            : chat && !chat.podeApagar && chat.sala.fechado
              ? el('p', { class: 'encerrado' }, icone('cadeado'), 'O chat está fechado pela staff no momento. Você ainda pode ler as mensagens.')
              : formulario),
      listaDeOnline(chat)),

      blocoDeSinalizadas(chat),

      chat?.banidos?.length > 0 && el('section', { class: 'cartao' },
        el('h2', null, `Castigos e banimentos do chat (${chat.banidos.length})`),
        el('ul', { class: 'chat-banidos' }, chat.banidos.map(banido => {
          const pessoa = chat.pessoas[banido.usuarioId];
          return el('li', null,
            avatar({ id: banido.usuarioId, nome: pessoa?.nome || 'Membro', url: pessoa?.avatar }),
            el('span', null,
              nomeColorido(pessoa?.nome || 'Membro', pessoa?.cor),
              el('small', null, `${banido.expiraEm ? `Castigo até ${formatarData(banido.expiraEm)}` : 'Banimento sem prazo'}, por ${chat.pessoas[banido.banidoPor]?.nome || 'staff'}${banido.motivo ? `. Motivo: ${banido.motivo}` : ''}`)),
            el('span', { class: `selo ${banido.expiraEm ? 'analise' : 'recusada'}` }, banido.expiraEm ? 'Castigo' : 'Banido'),
            el('button', { type: 'button', onclick: (evento) => desbanir(evento.currentTarget, banido.usuarioId) }, 'Remover'));
        })))));
}
