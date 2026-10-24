// Motivos de punição da ponte com o jogo: a mesma tabela em todos os servidores.
// O motivo escrito no aceite da denúncia escolhe o comando (tempban ou cadeia), o tempo e os avisos.
// Administradores e responsáveis veem e alteram.
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
  const edicao = dados.tabela.map(m => ({ nome: m.nome, sinonimos: m.sinonimos.join(', '), cmd: m.cmd, tempo: m.tempo, avisos: m.avisos }));
  estado.motivosPonte = { propria: dados.propria, edicao, salvo: JSON.stringify(edicao) };
}

function descrever(m) {
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
    tempo: Number(m.tempo) || 0,
    avisos: Number(m.avisos) || 0
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

// Um cartão por motivo: nome e resumo no topo; tipo, tempo, avisos e sinônimos com rótulo embaixo.
function linhaDoMotivo(m, indice, edicao) {
  const campo = (props) => el('input', { ...props, oninput: (e) => { m[props['data-campo']] = e.target.value; }, onchange: () => desenhar() });
  const rotulado = (rotulo, controle, classe = '') => el('label', { class: `motivo-campo ${classe}`.trim() }, el('span', null, rotulo), controle);
  const permanente = m.cmd !== 'cadeia' && (Number(m.tempo) || 0) === 0;
  return el('article', { class: `motivo-item${m.cmd === 'cadeia' ? ' cadeia' : permanente ? ' permanente' : ''}` },
    el('header', { class: 'motivo-topo' },
      campo({ 'data-campo': 'nome', class: 'motivo-nome', value: m.nome, maxlength: '30', 'aria-label': 'Motivo', placeholder: 'Nome do motivo (ex.: DM)' }),
      el('span', { class: 'motivo-resumo' }, descrever(m)),
      el('button', { type: 'button', class: 'so-icone perigo', title: 'Apagar motivo', 'aria-label': `Apagar ${m.nome || 'motivo'}`, onclick: () => { edicao.splice(indice, 1); desenhar(); } }, icone('lixeira'))),
    el('div', { class: 'motivo-campos' },
      rotulado('Tipo', el('select', { onchange: (e) => { m.cmd = e.target.value; desenhar(); } },
        el('option', { value: 'ban', selected: m.cmd === 'ban' }, 'Tempban'),
        el('option', { value: 'cadeia', selected: m.cmd === 'cadeia' }, 'Cadeia'))),
      rotulado(m.cmd === 'cadeia' ? 'Minutos' : 'Dias (0 = perm.)', campo({ 'data-campo': 'tempo', type: 'number', inputmode: 'numeric', min: '0', max: '99999', value: String(m.tempo) })),
      rotulado('Avisos', campo({ 'data-campo': 'avisos', type: 'number', inputmode: 'numeric', min: '0', max: '10', value: String(m.avisos) })),
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
          el('p', { class: 'sub' }, dados.propria ? 'Tabela personalizada.' : 'Usando a tabela padrão do bot.'))),
      el('section', { class: 'cartao' },
        el('p', { class: 'bot-ajuda' }, 'Vários motivos na mesma denúncia: banimentos somam dias e avisos; permanente (tempo 0) vence tudo e vira /blackban; banimento vence cadeia. Todo motivo vai com [DC] no fim. Os sinônimos também são reconhecidos (ex.: MONEY FARM e MF).'),
        el('div', { class: 'motivo-lista' }, edicao.map((m, i) => linhaDoMotivo(m, i, edicao))),
        el('button', { type: 'button', class: 'motivo-adicionar', onclick: () => { edicao.push({ nome: '', sinonimos: '', cmd: 'ban', tempo: 1, avisos: 1 }); desenhar(); } }, '+ Adicionar motivo')),
      el('div', { class: `bot-barra${mudou ? ' ativa' : ''}`, role: 'status' },
        el('p', null, mudou ? 'Mudanças não salvas' : 'Tudo salvo'),
        el('div', { class: 'acoes' },
          dados.propria && el('button', {
            type: 'button',
            onclick: (e) => salvar(e.currentTarget, [], 'Voltar para a tabela padrão do bot em todos os servidores? As mudanças feitas serão perdidas.')
          }, 'Restaurar padrão'),
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
          }, 'Salvar motivos')))));
}
