// Avisos do responsável: a faixa que todos veem no topo e a tela em que o
// responsável publica e remove.
import { executar } from './acoes.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';
import { api, avisar, el, enviarJson, formatarData, icone } from './util.js';

const CHAVE_FECHADOS = 'althea-avisos-fechados';
const TIPOS = { info: 'Informação', atencao: 'Atenção', urgente: 'Urgente' };
const DURACOES = [[0, 'Até eu remover'], [1, '1 hora'], [6, '6 horas'], [24, '1 dia'], [72, '3 dias'], [168, '7 dias']];

function fechados() {
  try { return JSON.parse(lerPreferencia(CHAVE_FECHADOS) || '[]') || []; } catch { return []; }
}

export async function carregarAvisos() {
  if (!estado.guildId) return;
  const guildId = estado.guildId;
  const dados = await api(`/api/avisos?${new URLSearchParams({ guildId })}`).catch(() => null);
  if (!dados || estado.guildId !== guildId) return;
  const mudou = JSON.stringify(dados.avisos) !== JSON.stringify(estado.avisosSite);
  estado.avisosSite = dados.avisos;
  if (mudou && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) desenhar();
}

// Faixa no topo de qualquer tela. Cada pessoa pode fechar um aviso para si.
export function faixaDeAvisos() {
  const ocultos = fechados();
  const visiveis = (estado.avisosSite || []).filter(item => !ocultos.includes(item.id));
  if (!visiveis.length) return null;

  return el('div', { class: 'avisos-do-site' }, visiveis.map(item => el('div', { class: `aviso-do-site ${item.tipo}`, role: item.tipo === 'urgente' ? 'alert' : 'status' },
    icone(item.tipo === 'info' ? 'sino' : 'alerta'),
    el('p', { class: 'texto-livre' }, item.texto),
    el('button', {
      class: 'so-icone',
      type: 'button',
      'aria-label': 'Fechar este aviso',
      title: 'Fechar (só para você)',
      onclick: () => {
        salvarPreferencia(CHAVE_FECHADOS, JSON.stringify([...fechados(), item.id].slice(-50)));
        desenhar();
      }
    }, icone('fechar')))));
}

// ---------------------------------------------------------------- tela do responsável
async function publicar(formulario) {
  const dados = Object.fromEntries(new FormData(formulario));
  await executar(formulario.querySelector('button[type="submit"]'), async () => {
    const resposta = await enviarJson('/api/avisos', { guildId: estado.guildId, texto: dados.texto, tipo: dados.tipo, horas: Number(dados.horas) });
    estado.textoAviso = '';
    await carregarAvisos();
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

async function remover(botao, id) {
  await executar(botao, async () => {
    await api(`/api/avisos/${encodeURIComponent(id)}?${new URLSearchParams({ guildId: estado.guildId })}`, { method: 'DELETE' });
    await carregarAvisos();
    desenhar();
  });
}

export function telaAvisos() {
  const avisos = estado.avisosSite || [];
  const formulario = el('form', {
    class: 'formulario cartao',
    onsubmit: (evento) => {
      evento.preventDefault();
      publicar(evento.currentTarget);
    }
  },
  el('div', { class: 'campo' },
    el('label', { for: 'aviso-texto' }, 'Texto do aviso'),
    el('textarea', {
      id: 'aviso-texto', name: 'texto', rows: '3', maxlength: '400', required: true,
      placeholder: 'Ex.: Manutenção hoje às 23h. As denúncias voltam em seguida.',
      value: estado.textoAviso || '',
      oninput: (evento) => { estado.textoAviso = evento.target.value; }
    })),
  el('div', { class: 'avisos-opcoes' },
    el('div', { class: 'campo' },
      el('label', { for: 'aviso-tipo' }, 'Tipo'),
      el('select', { id: 'aviso-tipo', name: 'tipo' }, Object.entries(TIPOS).map(([valor, rotulo]) => el('option', { value: valor }, rotulo)))),
    el('div', { class: 'campo' },
      el('label', { for: 'aviso-horas' }, 'Fica no ar por'),
      el('select', { id: 'aviso-horas', name: 'horas' }, DURACOES.map(([horas, rotulo]) => el('option', { value: String(horas) }, rotulo))))),
  el('div', { class: 'acoes' }, el('button', { class: 'primario', type: 'submit' }, 'Publicar aviso')));

  return el('main', { class: 'principal' },
    el('div', { class: 'avisos-tela' },
      el('header', { class: 'pagina-titulo' }, el('h1', null, 'Avisos')),
      el('p', { class: 'sub' }, 'O aviso aparece no topo do site para todos os membros deste servidor. Cada pessoa pode fechar para si.'),
      blocoAviso(),
      formulario,
      el('section', { class: 'cartao' },
        el('h2', null, `No ar agora (${avisos.length})`),
        avisos.length
          ? el('ul', { class: 'avisos-lista' }, avisos.map(item => el('li', { class: item.tipo },
            el('div', null,
              el('p', { class: 'texto-livre' }, item.texto),
              el('small', null, [TIPOS[item.tipo], item.por && `por ${item.por}`, formatarData(item.criadoEm), item.expiraEm ? `sai em ${formatarData(item.expiraEm)}` : 'sem prazo'].filter(Boolean).join(', '))),
            el('button', { class: 'perigo', type: 'button', onclick: (evento) => remover(evento.currentTarget, item.id) }, 'Remover'))))
          : el('p', { class: 'sub' }, 'Nenhum aviso publicado.'))));
}
