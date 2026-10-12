// Painel do bot: o mesmo /painel do Discord, com a explicação de cada opção.
// Canais e cargos do servidor são escolhidos em listas; valem só para o
// servidor selecionado (menos os usuários isentos, que são de todos).
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { cartaoDeBackup } from './gestao.js';
import { api, avisar, el, enviarJson, formatarData, icone } from './util.js';

const GRUPOS_DE_CANAIS = [
  {
    titulo: 'Canais principais',
    texto: 'Onde as denúncias entram. Sem estes três o bot não funciona neste servidor.',
    itens: [
      { chave: 'pc', nome: 'Denúncias PC', obrigatorio: true, explica: 'Cada denúncia de PC vira um tópico neste canal.' },
      { chave: 'mobile', nome: 'Denúncias Mobile', obrigatorio: true, explica: 'Cada denúncia de Mobile vira um tópico neste canal.' },
      { chave: 'logs', nome: 'Cadeia Staff', obrigatorio: true, explica: 'O bot publica aqui cada denúncia que entra em análise ou é decidida, com o link do tópico, para a equipe acompanhar.' }
    ]
  },
  {
    titulo: 'Canais administrativos',
    texto: 'Registros e cópias. São opcionais: deixe "Não configurado" para desligar a função.',
    itens: [
      { chave: 'log', nome: 'Log administrativo', explica: 'Registro das ações da staff (análise, aceite, recusa), dos alertas de muitas denúncias contra o mesmo jogador e das mensagens apagadas nos tópicos.' },
      { chave: 'analysis', nome: 'Em análise', explica: 'Lista das denúncias que estão em análise. A mensagem sai daqui quando a denúncia é decidida.' },
      { chave: 'topDaily', nome: 'Top diário', explica: 'O ranking diário da staff é enviado neste canal.' },
      { chave: 'backup', nome: 'Backup', explica: 'Recebe o arquivo com a conversa e as provas quando a denúncia é finalizada. Usado quando não há canal Cloud.' },
      { chave: 'armazem', nome: 'Armazém', explica: 'Cada denúncia nova ganha uma cópia (tópico espelho) neste canal.' }
    ]
  }
];

const CANAIS_EXTERNOS = [
  { chave: 'cloud', nome: 'Cloud', explica: 'Destino principal do arquivo da denúncia finalizada (conversa e provas). Costuma ficar num servidor só de armazenamento.' },
  { chave: 'registro', nome: 'Registro', explica: 'Cada denúncia nova ganha uma cópia (tópico espelho) neste canal de outro servidor.' },
  { chave: 'canalDenuncia', nome: 'Canal fixo de denúncias', explica: 'Onde fica a mensagem do /denuncia com os botões "Denúncia PC" e "Denúncia Mobile". Ao trocar, o bot publica a mensagem no canal novo.' }
];

const CARGOS = [
  { chave: 'pc', nome: 'Pode denunciar no PC', obrigatorio: true, explica: 'Quem tem este cargo pode abrir denúncia de PC, no Discord e no site.' },
  { chave: 'permitido', nome: 'Pode denunciar no Mobile', obrigatorio: true, explica: 'Quem tem este cargo pode abrir denúncia de Mobile, no Discord e no site.' },
  { chave: 'administrador', nome: 'Staff (administrador)', explica: 'Atende as denúncias: reivindica, analisa, aceita e recusa. No site, vê a fila e os atendimentos.' },
  { chave: 'responsavel_admin', nome: 'Responsável', obrigatorio: true, explica: 'Tudo o que a staff faz, mais: finalizar denúncias, usar o /painel, ver a auditoria e mexer nas configurações do site, inclusive nesta tela.' }
];

export async function carregarPainelDoBot() {
  const guildId = estado.guildId;
  try {
    const dados = await api(`/api/painel-bot?${new URLSearchParams({ guildId })}`);
    if (estado.guildId !== guildId) return;
    aplicar(dados);
  } catch (erro) {
    estado.painelBot = null;
    avisar('erro', erro.message);
  }
  desenhar();
}

// "edicao" é o que está na tela; "salvo" é o que veio do servidor, para saber o que mudou.
function aplicar(dados) {
  const valores = {
    channels: { ...dados.valores.channels },
    roles: { ...dados.valores.roles },
    manutencao: dados.valores.manutencao,
    bloqueio: dados.valores.bloqueio,
    isentos: dados.valores.isentos.map(item => item.id).join('\n')
  };
  estado.painelBot = { ...dados, edicao: valores, salvo: JSON.stringify(valores) };
}

async function salvar(botao) {
  const painel = estado.painelBot;
  const { edicao } = painel;
  const antes = JSON.parse(painel.salvo);

  // Trocas que mudam quem tem acesso ou param as denúncias pedem confirmação.
  const avisos = [
    edicao.manutencao && !antes.manutencao && 'As denúncias entram em manutenção: ninguém consegue abrir denúncia nova até você desligar.',
    edicao.roles.responsavel_admin !== antes.roles.responsavel_admin && 'O cargo de responsável muda: quem tem o cargo novo passa a mandar no painel e quem só tem o antigo perde o acesso.',
    edicao.roles.administrador !== antes.roles.administrador && 'O cargo da staff muda: quem só tem o cargo antigo deixa de atender denúncias.',
    edicao.isentos !== antes.isentos && 'A lista de usuários isentos muda em todos os servidores, não só neste.'
  ].filter(Boolean);

  if (avisos.length) {
    const confirmado = await confirmar({ titulo: 'Salvar estas mudanças?', texto: avisos.join(' '), rotulo: 'Salvar', perigo: true });
    if (!confirmado) return;
  }

  await executar(botao, async () => {
    const resposta = await enviarJson('/api/painel-bot', { guildId: estado.guildId, ...edicao });
    aplicar(resposta);
    estado.servidores = (await api('/api/eu')).servidores;
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

// Situação da linha: "ok" (configurada), "vazio" (opcional sem valor) ou
// "falta" (obrigatória sem valor). "mudou" marca o que ainda não foi salvo.
function linha({ nome, obrigatorio, explica }, id, controle, extra, { valor = true, mudou = false } = {}) {
  const situacao = valor ? 'ok' : obrigatorio ? 'falta' : 'vazio';
  return el('div', { class: `bot-linha ${situacao}${mudou ? ' mudou' : ''}` },
    el('div', { class: 'bot-rotulo' },
      el('label', { for: id },
        el('span', { class: 'bot-ponto', 'aria-hidden': 'true' }),
        nome,
        obrigatorio && el('span', { class: 'bot-obrigatorio' }, 'obrigatório'),
        mudou && el('span', { class: 'bot-mudou' }, 'não salvo')),
      el('p', null, explica)),
    el('div', { class: 'bot-controle' }, controle, extra));
}

// Lista de canais ou cargos do servidor. Um valor salvo que não está na lista
// (canal de outro servidor, cargo apagado) continua aparecendo, para não se perder.
function seletor(objeto, item, id, opcoes, prefixo) {
  const valor = objeto[item.chave];
  const conhecido = !valor || opcoes.some(opcao => opcao.id === valor);
  const grupos = new Map();
  for (const opcao of opcoes) {
    const chave = opcao.categoria || '';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(opcao);
  }
  const opcao = (dado) => el('option', { value: dado.id, selected: dado.id === valor }, `${prefixo}${dado.nome}`);

  return el('select', {
    id,
    onchange: (evento) => {
      objeto[item.chave] = evento.target.value;
      desenhar();
    }
  },
  el('option', { value: '', selected: !valor }, item.obrigatorio ? 'Escolha...' : 'Não configurado'),
  !conhecido && el('option', { value: valor, selected: true }, `Fora deste servidor ou apagado (${valor})`),
  [...grupos].map(([categoria, lista]) => categoria
    ? el('optgroup', { label: categoria }, lista.map(opcao))
    : lista.map(opcao)));
}

function interruptor(edicao, chave, id, { ligado, desligado }) {
  return el('label', { class: 'bot-interruptor', for: id },
    el('input', {
      id,
      type: 'checkbox',
      role: 'switch',
      checked: edicao[chave],
      onchange: (evento) => {
        edicao[chave] = evento.target.checked;
        desenhar();
      }
    }),
    el('span', { class: 'bot-trilho', 'aria-hidden': 'true' }),
    el('span', null, edicao[chave] ? ligado : desligado));
}

// Cabeçalho de cada bloco: ícone, título e, à direita, quanto já está configurado.
function cabecalho(nomeIcone, titulo, texto, situacao) {
  return el('header', { class: 'bot-cabecalho' },
    el('span', { class: 'bot-icone', 'aria-hidden': 'true' }, icone(nomeIcone)),
    el('div', null, el('h2', null, titulo), texto && el('p', null, texto)),
    situacao && el('span', { class: `bot-situacao ${situacao.tom || ''}` }, situacao.texto));
}

// "3 de 5 configurados", ou quantos obrigatórios faltam.
function contar(itens, valores) {
  const feitos = itens.filter(item => valores[item.chave]).length;
  const faltam = itens.filter(item => item.obrigatorio && !valores[item.chave]).length;
  if (faltam) return { feitos, total: itens.length, tom: 'falta', texto: faltam === 1 ? 'Falta 1 obrigatório' : `Faltam ${faltam} obrigatórios` };
  return { feitos, total: itens.length, tom: feitos === itens.length ? 'ok' : '', texto: `${feitos} de ${itens.length} configurados` };
}

function resumo(rotulo, valor, detalhe, tom, alvo) {
  return el('button', {
    class: `bot-resumo-item ${tom || ''}`,
    type: 'button',
    onclick: () => document.getElementById(alvo)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, el('span', null, rotulo), el('strong', null, valor), el('small', null, detalhe));
}

export function telaPainelDoBot() {
  const painel = estado.painelBot;

  if (!painel) {
    return el('main', { class: 'principal' }, blocoAviso() || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando o painel do bot' },
      el('span'), el('span'), el('span'), el('span')));
  }

  const { edicao } = painel;
  const antes = JSON.parse(painel.salvo);
  const todosOsCanais = [...GRUPOS_DE_CANAIS.flatMap(grupo => grupo.itens), ...CANAIS_EXTERNOS];
  const mudancas = [
    edicao.manutencao !== antes.manutencao,
    edicao.bloqueio !== antes.bloqueio,
    edicao.isentos.trim() !== antes.isentos.trim(),
    ...todosOsCanais.map(item => edicao.channels[item.chave] !== antes.channels[item.chave]),
    ...CARGOS.map(item => edicao.roles[item.chave] !== antes.roles[item.chave])
  ].filter(Boolean).length;

  const canais = contar(todosOsCanais, edicao.channels);
  const cargos = contar(CARGOS, edicao.roles);
  const isentos = edicao.isentos.split(/[\s,;]+/).filter(Boolean).length;
  const nomesDosIsentos = painel.valores.isentos;
  const linhaDeCanal = (item, controle, extra) => linha(item, `bot-canal-${item.chave}`, controle, extra,
    { valor: edicao.channels[item.chave], mudou: edicao.channels[item.chave] !== antes.channels[item.chave] });

  return el('main', { class: 'principal' },
    el('div', { class: 'config bot' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Painel do bot'),
          el('p', { class: 'sub' }, 'As mesmas opções do comando /painel do Discord. O que você salvar aqui vale na hora para o bot e para o site.'),
          painel.atualizado?.em && el('p', { class: 'sub bot-atualizado' }, `Última alteração: ${formatarData(painel.atualizado.em)}${painel.atualizado.por ? `, por ${painel.atualizado.por}` : ''}`))),
      blocoAviso(),

      el('nav', { class: 'bot-resumo', 'aria-label': 'Resumo do painel' },
        resumo('Denúncias', edicao.manutencao ? 'Em manutenção' : 'Abertas', edicao.bloqueio ? 'Fila em ordem' : 'Fila em qualquer ordem', edicao.manutencao ? 'atencao' : 'ok', 'bot-funcionamento'),
        resumo('Canais', `${canais.feitos} de ${canais.total}`, canais.tom === 'falta' ? canais.texto : 'configurados', canais.tom, 'bot-canais'),
        resumo('Cargos', `${cargos.feitos} de ${cargos.total}`, cargos.tom === 'falta' ? cargos.texto : 'configurados', cargos.tom, 'bot-cargos'),
        resumo('Isentos', String(isentos), isentos === 1 ? 'conta sem filtros' : 'contas sem filtros', '', 'bot-isentos-bloco')),

      el('section', { class: 'cartao', id: 'bot-funcionamento' },
        cabecalho('ajustes', 'Funcionamento', 'Liga e desliga o que vale para o servidor inteiro.'),
        linha({ nome: 'Manutenção das denúncias', explica: 'Ligada, ninguém consegue abrir denúncia nova, nem pelo Discord nem pelo site, e a mensagem do /denuncia avisa da manutenção. As denúncias já abertas continuam normais.' },
          'bot-manutencao', interruptor(edicao, 'manutencao', 'bot-manutencao', { ligado: 'Em manutenção', desligado: 'Denúncias abertas' }), null,
          { valor: !edicao.manutencao, mudou: edicao.manutencao !== antes.manutencao }),
        linha({ nome: 'Bloqueio de pendências anteriores', explica: 'Ligado, a staff só consegue reivindicar uma denúncia depois que as mais antigas do mesmo canal forem reivindicadas. Serve para ninguém pular a fila.' },
          'bot-bloqueio', interruptor(edicao, 'bloqueio', 'bot-bloqueio', { ligado: 'Fila em ordem', desligado: 'Qualquer ordem' }), null,
          { valor: edicao.bloqueio, mudou: edicao.bloqueio !== antes.bloqueio })),

      GRUPOS_DE_CANAIS.map((grupo, indice) => el('section', { class: 'cartao', id: indice ? null : 'bot-canais' },
        cabecalho(indice ? 'documento' : 'balao', grupo.titulo, grupo.texto, contar(grupo.itens, edicao.channels)),
        grupo.itens.map(item => linhaDeCanal(item, seletor(edicao.channels, item, `bot-canal-${item.chave}`, painel.canais, '# '))))),

      el('section', { class: 'cartao' },
        cabecalho('externo', 'Canais de outros servidores', 'Podem ficar em outro servidor, por isso entram pelo ID. O bot precisa estar no servidor e enxergar o canal.', contar(CANAIS_EXTERNOS, edicao.channels)),
        el('p', { class: 'bot-ajuda' }, 'Para copiar o ID no Discord: ative o Modo desenvolvedor, clique com o botão direito no canal e escolha "Copiar ID do canal".'),
        CANAIS_EXTERNOS.map(item => linhaDeCanal(item,
          el('input', {
            id: `bot-canal-${item.chave}`,
            class: 'bot-id',
            type: 'text',
            inputmode: 'numeric',
            maxlength: '21',
            placeholder: 'Não configurado',
            value: edicao.channels[item.chave],
            oninput: (evento) => { edicao.channels[item.chave] = evento.target.value.trim(); },
            onchange: () => desenhar()
          }),
          painel.externos[item.chave] && edicao.channels[item.chave] === painel.valores.channels[item.chave] && el('small', null, painel.externos[item.chave])))),

      el('section', { class: 'cartao', id: 'bot-cargos' },
        cabecalho('escudo', 'Cargos', 'O bot e o site decidem o que cada pessoa pode fazer pelos cargos dela no Discord.', cargos),
        CARGOS.map(item => {
          const cor = painel.cargos.find(cargo => cargo.id === edicao.roles[item.chave])?.cor;
          // A cor entra por JavaScript: a política de segurança do site barra style no HTML.
          const amostra = el('span', { class: 'bot-cor', 'aria-hidden': 'true' });
          if (cor) amostra.style.background = cor;
          return linha(item, `bot-cargo-${item.chave}`,
            el('div', { class: 'bot-cargo' },
              amostra,
              seletor(edicao.roles, item, `bot-cargo-${item.chave}`, painel.cargos, '@ ')), null,
            { valor: edicao.roles[item.chave], mudou: edicao.roles[item.chave] !== antes.roles[item.chave] });
        })),

      el('section', { class: 'cartao', id: 'bot-isentos-bloco' },
        cabecalho('cadeado', 'Usuários isentos', 'Contas que o bot não filtra. A lista é a mesma em todos os servidores.', { texto: isentos === 1 ? '1 conta' : `${isentos} contas` }),
        el('ul', { class: 'bot-efeitos' },
          el('li', null, 'Não levam strike por palavras proibidas.'),
          el('li', null, 'Não têm links barrados.'),
          el('li', null, 'Podem escrever em tópicos restritos.'),
          el('li', null, 'Podem recusar uma denúncia escrevendo "recusado" no tópico.')),
        nomesDosIsentos.length > 0 && el('ul', { class: 'bot-pessoas', 'aria-label': 'Na lista hoje' },
          nomesDosIsentos.map(item => el('li', { title: item.id }, item.nome || `ID ${item.id}`))),
        el('div', { class: 'campo' },
          el('label', { for: 'bot-isentos' }, 'IDs do Discord, um por linha'),
          el('textarea', {
            id: 'bot-isentos',
            class: 'bot-id',
            rows: '4',
            placeholder: '123456789012345678',
            value: edicao.isentos,
            oninput: (evento) => { edicao.isentos = evento.target.value; },
            onchange: () => desenhar()
          }))),

      cartaoDeBackup(carregarPainelDoBot),

      // Barra que acompanha a tela: sempre à mão, sem precisar voltar ao topo.
      el('div', { class: `bot-barra${mudancas ? ' ativa' : ''}`, role: 'status' },
        el('p', null, mudancas
          ? (mudancas === 1 ? '1 mudança não salva' : `${mudancas} mudanças não salvas`)
          : 'Tudo salvo'),
        el('div', { class: 'acoes' },
          mudancas > 0 && el('button', {
            type: 'button',
            onclick: () => {
              painel.edicao = JSON.parse(painel.salvo);
              desenhar();
            }
          }, 'Descartar'),
          el('button', { class: 'primario', type: 'button', disabled: !mudancas, onclick: (evento) => salvar(evento.currentTarget) }, 'Salvar painel')))));
}
