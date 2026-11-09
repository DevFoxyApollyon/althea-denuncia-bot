// Configurações do site, editadas pelo responsável: categorias
// Valem só para o servidor selecionado.
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { api, avisar, el, enviarJson, icone } from './util.js';

// No formulário os termos de cada categoria ficam num campo só, separados por vírgula.
const paraEdicao = (config) => ({
  personalizada: config.personalizada,
  categorias: config.categorias.map(item => ({ nome: item.nome, grupo: item.grupo || '', prioridade: item.prioridade, termos: item.termos.join(', ') })),
});

export async function carregarConfigDoSite() {
  try {
    const dados = await api(`/api/config-site?${new URLSearchParams({ guildId: estado.guildId })}`);
    estado.configSite = paraEdicao(dados.config);
  } catch (erro) {
    estado.configSite = null;
    avisar('erro', erro.message);
  }
  desenhar();
}

// Depois de salvar, as outras telas (formulário, fila, respostas) usam os valores novos.
async function aplicarResposta(resultado) {
  estado.configSite = paraEdicao(resultado.config);
  estado.servidores = (await api('/api/eu')).servidores;
  avisar('ok', resultado.mensagem);
  desenhar();
}

async function salvar(botao) {
  const edicao = estado.configSite;
  await executar(botao, async () => {
    await aplicarResposta(await enviarJson('/api/config-site', {
      guildId: estado.guildId,
      config: {
        categorias: edicao.categorias.map(item => ({ ...item, termos: item.termos.split(',') })),
      }
    }));
  });
}

async function restaurar(botao) {
  const confirmado = await confirmar({
    titulo: 'Restaurar o padrão?',
    texto: 'As categorias deste servidor voltam aos valores originais do site. O que você editou aqui é apagado.',
    rotulo: 'Restaurar padrão',
    perigo: true
  });
  if (!confirmado) return;
  await executar(botao, async () => {
    await aplicarResposta(await enviarJson('/api/config-site', { guildId: estado.guildId, restaurar: true }));
  });
}

// Campo ligado direto ao objeto em edição: digitar não redesenha a tela.
function campo(objeto, chave, props) {
  return el(props.linhas ? 'textarea' : 'input', {
    type: props.linhas ? null : (props.tipo || 'text'),
    'aria-label': props.rotulo,
    placeholder: props.exemplo,
    maxlength: props.limite ? String(props.limite) : null,
    min: props.min,
    max: props.max,
    step: props.passo,
    rows: props.linhas ? String(props.linhas) : null,
    value: objeto[chave],
    oninput: (evento) => { objeto[chave] = evento.target.value; }
  });
}

function remover(lista, indice, rotulo) {
  return el('button', {
    class: 'so-icone',
    type: 'button',
    'aria-label': rotulo,
    title: rotulo,
    onclick: () => {
      lista.splice(indice, 1);
      desenhar();
    }
  }, icone('fechar'));
}

export function telaConfig() {
  const edicao = estado.configSite;

  if (!edicao) {
    return el('main', { class: 'principal' }, blocoAviso() || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando as configurações' },
      el('span'), el('span'), el('span'), el('span')));
  }

  return el('main', { class: 'principal' },
    el('div', { class: 'config' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Configurações'),
          el('p', { class: 'sub' }, edicao.personalizada
            ? 'Este servidor usa configurações próprias.'
            : 'Este servidor usa o padrão do site. Ao salvar, passa a usar o que estiver aqui.')),
        el('div', { class: 'acoes' },
          edicao.personalizada && el('button', { class: 'perigo', type: 'button', onclick: (evento) => restaurar(evento.currentTarget) }, 'Restaurar padrão'),
          el('button', { class: 'primario', type: 'button', onclick: (evento) => salvar(evento.currentTarget) }, 'Salvar configurações'))),
      blocoAviso(),

      el('section', { class: 'cartao' },
        el('h2', null, 'Categorias'),
        el('p', { class: 'sub' }, 'A categoria é reconhecida pelo motivo da denúncia: vale a primeira da lista que tiver um dos termos. Um termo casa com o começo da palavra, então "slid" pega "slide" e "slidou". Separe os termos por vírgula. O grupo só organiza a lista no formulário de denúncia.'),
        el('div', { class: 'config-lista' }, edicao.categorias.map((item, indice) => el('div', { class: 'config-categoria' },
          campo(item, 'nome', { rotulo: `Nome da categoria ${indice + 1}`, exemplo: 'Nome', limite: 40 }),
          campo(item, 'grupo', { rotulo: `Grupo da categoria ${indice + 1}`, exemplo: 'Grupo', limite: 30 }),
          campo(item, 'termos', { rotulo: `Termos da categoria ${indice + 1}`, exemplo: 'termo, outro termo' }),
          el('select', {
            'aria-label': `Prioridade da categoria ${indice + 1}`,
            onchange: (evento) => { item.prioridade = evento.target.value; }
          },
          el('option', { value: 'normal', selected: item.prioridade !== 'alta' }, 'Normal'),
          el('option', { value: 'alta', selected: item.prioridade === 'alta' }, 'Alta prioridade')),
          remover(edicao.categorias, indice, `Remover a categoria ${item.nome || indice + 1}`)))),
        el('button', {
          type: 'button',
          onclick: () => {
            edicao.categorias.push({ nome: '', grupo: '', prioridade: 'normal', termos: '' });
            desenhar();
          }
        }, icone('mais'), 'Adicionar categoria'))));
}
