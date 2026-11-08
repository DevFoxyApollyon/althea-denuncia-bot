// Motivos de punição da ponte com o jogo: a mesma tabela em todos os servidores.
// O motivo escrito no aceite da denúncia escolhe o comando (tempban ou cadeia), o tempo e os avisos.
// Administradores e responsáveis veem; só o responsável (e o dono do bot) altera.
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { api, avisar, el, enviarJson, icone } from './util.js';

export async function carregarMotivosPonte() {
  const guildId = estado.guildId;
  try {
    const dados = await api(`/api/motivos-ponte?${new URLSearchParams({ guildId })}`);
    if (estado.guildId !== guildId) return;
    aplicar(dados);
  } catch (erro) {
    estado.motivosPonte = null;
    avisar('erro', erro.message);
  }
  desenhar();
}

// "edicao" é o que está na tela; "salvo" é o que veio do servidor, para saber o que mudou.
function aplicar(dados) {
  const edicao = dados.tabela.map(m => ({ nome: m.nome, sinonimos: m.sinonimos.join(', '), cmd: m.cmd, tempo: m.tempo, avisos: m.avisos, texto: m.texto || '', salvo: true }));
  estado.motivosPonte = { propria: dados.propria, podeApagar: dados.podeApagar === true, podeEditar: dados.podeEditar === true, edicao, salvo: JSON.stringify(edicao) };
}

function descrever(m) {
  if (m.cmd === 'registro') return `${m.texto || 'Neutro'} · só visual, não vai para o jogo`;
  const tempo = Number(m.tempo) || 0;
  const avisos = Number(m.avisos) || 0;
  const base = m.cmd === 'cadeia' ? `Cadeia de ${tempo} min` : tempo === 0 ? 'Banimento permanente (/blackban)' : `Banimento de ${tempo} dia(s)`;
  return avisos > 0 ? `${base} + ${avisos} aviso(s)` : base;
}

const paraEnvio = (edicao) => edicao
  .filter(m => m.nome.trim())
  .map(m => ({
    nome: m.nome.trim(),
    sinonimos: m.sinonimos.split(',').map(s => s.trim()).filter(Boolean),
    cmd: m.cmd,
    tempo: m.cmd === 'registro' ? 0 : Number(m.tempo) || 0,
    avisos: m.cmd === 'registro' ? 0 : Number(m.avisos) || 0,
    ...(m.cmd === 'registro' ? { texto: String(m.texto || '').trim() } : {})
  }));

async function salvar(botao, tabela, mensagemConfirmacao) {
  const confirmado = await confirmar({ titulo: 'Salvar os motivos?', texto: mensagemConfirmacao, rotulo: 'Salvar' });
  if (!confirmado) return;
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/motivos-ponte', { guildId: estado.guildId, tabela });
    aplicar(resposta);
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

// A tela mostra os motivos em grupos, nesta ordem. Só muda a exibição: a tabela salva
// continua na ordem em que foi criada.
const GRUPOS = [
  { chave: 'cadeia', titulo: 'Cadeia', explica: 'tempo em minutos' },
  { chave: 'ban', titulo: 'Banimento', explica: 'tempo em dias' },
  { chave: 'permanente', titulo: 'Banimento permanente', explica: 'dias = 0, vira /blackban' },
  { chave: 'neutro', titulo: 'Neutro', explica: 'só visual, não vai para o jogo' }
];
function grupoDoMotivo(m) {
  if (m.cmd === 'cadeia') return 'cadeia';
  if (m.cmd === 'registro') return 'neutro';
  return (Number(m.tempo) || 0) === 0 ? 'permanente' : 'ban';
}

// Um cartão por motivo: nome e resumo no topo; tipo, tempo, avisos e sinônimos com rótulo embaixo.
// Motivo já salvo só é apagado ou renomeado pelo dono do bot; o novo (ainda não salvo) pode sair.
// Sem poder editar (administrador), tudo fica só para leitura.
function linhaDoMotivo(m, indice, edicao, podeApagar, podeEditar) {
  const travado = !podeEditar || (m.salvo && !podeApagar);
  const campo = (props) => el('input', { ...props, readonly: props.readonly || !podeEditar, oninput: (e) => { m[props['data-campo']] = e.target.value; }, onchange: () => desenhar() });
  const rotulado = (rotulo, controle, classe = '') => el('label', { class: `motivo-campo ${classe}`.trim() }, el('span', null, rotulo), controle);
  const grupo = grupoDoMotivo(m);
  return el('article', { class: `motivo-item${grupo === 'ban' ? '' : ` ${grupo}`}`, 'data-indice': String(indice) },
    el('header', { class: 'motivo-topo' },
      campo({ 'data-campo': 'nome', class: 'motivo-nome', value: m.nome, maxlength: '30', 'aria-label': 'Motivo', placeholder: 'Nome do motivo (ex.: DM)', readonly: travado, title: travado && podeEditar ? 'Só o dono do bot renomeia motivos.' : null }),
      el('span', { class: 'motivo-resumo' }, descrever(m)),
      !travado && el('button', { type: 'button', class: 'so-icone perigo', title: 'Apagar motivo', 'aria-label': `Apagar ${m.nome || 'motivo'}`, onclick: () => { edicao.splice(indice, 1); desenhar(); } }, icone('lixeira'))),
    el('div', { class: 'motivo-campos' },
      rotulado('Tipo', el('select', { disabled: !podeEditar, onchange: (e) => { m.cmd = e.target.value; desenhar(); } },
        el('option', { value: 'ban', selected: m.cmd === 'ban' }, 'Tempban'),
        el('option', { value: 'cadeia', selected: m.cmd === 'cadeia' }, 'Cadeia'),
        el('option', { value: 'registro', selected: m.cmd === 'registro' }, 'Neutro'))),
      m.cmd === 'registro'
        ? rotulado('Texto que aparece (opcional)', campo({ 'data-campo': 'texto', value: m.texto || '', maxlength: '60', placeholder: 'Ex.: Mute 120 min' }), 'largo')
        : [
          rotulado(m.cmd === 'cadeia' ? 'Minutos' : 'Dias (0 = perm.)', campo({ 'data-campo': 'tempo', type: 'number', inputmode: 'numeric', min: '0', max: '99999', value: String(m.tempo) })),
          rotulado('Avisos', campo({ 'data-campo': 'avisos', type: 'number', inputmode: 'numeric', min: '0', max: '10', value: String(m.avisos) }))
        ],
      rotulado('Sinônimos', campo({ 'data-campo': 'sinonimos', value: m.sinonimos, placeholder: 'Separados por vírgula' }), 'largo')));
}

export function telaMotivosPonte() {
  const dados = estado.motivosPonte;
  if (!dados) {
    return el('main', { class: 'principal' }, blocoAviso() || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando os motivos' },
      el('span'), el('span'), el('span')));
  }
  const { edicao } = dados;
  const mudou = JSON.stringify(edicao) !== dados.salvo;

  return el('main', { class: 'principal' },
    el('div', { class: 'config' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Motivos de punição'),
          el('p', { class: 'sub' }, 'O motivo escrito no aceite da denúncia escolhe a punição aplicada pelo painel do jogo. A tabela é a mesma em todos os servidores: o que você salvar aqui vale para todos.'),
          el('p', { class: 'sub' }, dados.propria ? 'Tabela personalizada.' : 'Usando a tabela padrão do bot.'),
          !dados.podeEditar && el('p', { class: 'sub' }, 'Só o responsável adiciona e muda os motivos. Você pode ver a tabela.'),
          dados.podeEditar && !dados.podeApagar && el('p', { class: 'sub' }, 'Você pode mudar e adicionar motivos. Apagar ou renomear um motivo é só com o dono do bot.'))),
      el('section', { class: 'cartao' },
        el('p', { class: 'bot-ajuda' }, 'Neutro: só visual, para punições que não são ban nem cadeia (ex.: mute já dado no jogo). A denúncia é aceita normalmente, mas nada vai para o jogo; o texto aparece como a punição.'),
        el('p', { class: 'bot-ajuda' }, 'Vários motivos na mesma denúncia: banimentos somam dias e avisos; permanente (tempo 0) vence tudo e vira /blackban; banimento vence cadeia. Todo motivo vai com [DC] no fim. Os sinônimos também são reconhecidos (ex.: MONEY FARM e MF).'),
        GRUPOS.map(({ chave, titulo, explica }) => {
          const doGrupo = edicao.map((m, i) => [m, i]).filter(([m]) => grupoDoMotivo(m) === chave);
          return doGrupo.length > 0 && el('section', { class: `motivo-grupo ${chave}` },
            el('h2', { class: 'motivo-grupo-titulo' }, titulo, el('span', { class: 'motivo-grupo-conta' }, String(doGrupo.length)), el('small', null, explica)),
            el('div', { class: 'motivo-lista' }, doGrupo.map(([m, i]) => linhaDoMotivo(m, i, edicao, dados.podeApagar, dados.podeEditar))));
        })),
      // Barra fixa: à esquerda o que mexe na lista; à direita descartar e salvar.
      dados.podeEditar && el('div', { class: `bot-barra motivos-barra${mudou ? ' ativa' : ''}`, role: 'status' },
        el('p', null, mudou ? 'Mudanças não salvas' : 'Tudo salvo'),
        el('div', { class: 'motivos-barra-acoes' },
          el('div', { class: 'acoes' },
            el('button', { type: 'button', onclick: () => adicionarMotivo(edicao) }, '+ Adicionar motivo'),
            dados.propria && dados.podeApagar && el('button', {
              type: 'button',
              class: 'perigo',
              onclick: (e) => salvar(e.currentTarget, [], 'Voltar para a tabela padrão do bot em todos os servidores? As mudanças feitas serão perdidas.')
            }, 'Restaurar padrão')),
          el('div', { class: 'acoes' },
          mudou && el('button', { type: 'button', onclick: () => { dados.edicao = JSON.parse(dados.salvo); desenhar(); } }, 'Descartar'),
          el('button', {
            class: 'primario',
            type: 'button',
            disabled: !mudou,
            onclick: (e) => {
              const tabela = paraEnvio(edicao);
              if (!tabela.length) return avisar('erro', 'A tabela não pode ficar vazia. Use "Restaurar padrão".');
              salvar(e.currentTarget, tabela, `A tabela fica com ${tabela.length} motivos e vale para todos os servidores.`);
            }
          }, 'Salvar motivos'))))));
}

// Motivo novo no fim da lista: rola até ele e já deixa o nome para digitar.
function adicionarMotivo(edicao) {
  edicao.push({ nome: '', sinonimos: '', cmd: 'ban', tempo: 1, avisos: 1 });
  desenhar();
  const novo = document.querySelector(`.motivo-item[data-indice="${edicao.length - 1}"]`);
  novo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  novo?.querySelector('.motivo-nome')?.focus({ preventScroll: true });
}
