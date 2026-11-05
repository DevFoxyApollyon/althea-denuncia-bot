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
      { chave: 'provasStaff', nome: 'Provas da staff', explica: 'Canal fixo do /provastaff: a staff registra a punição com as provas, e o responsável aceita (vai para a Cadeia Staff) ou recusa.' },
      { chave: 'relatorioPunicoes', nome: 'Relatório de punições', explica: 'Histórico das punições aplicadas pelo painel do jogo (organização, nick, ID e link da denúncia). Sem este canal, vai para o Log administrativo.' },
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
  { chave: 'fundador', nome: 'Fundador', explica: 'Opcional. Escolhido, só quem tem este cargo entra no Painel do bot (aqui e no /painel do Discord) e nas Configurações do site. Sem ele, vale o cargo de responsável.' },
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
    somenteLeitura: Boolean(dados.valores.somenteLeitura),
    alertaCritico: dados.valores.alertaCritico !== false,
    esperaDenuncia: dados.valores.esperaDenuncia !== false,
    minutosDenuncia: Number(dados.valores.minutosDenuncia) || 1,
    avisoReivindicar: dados.valores.avisoReivindicar !== false,
    minutosAviso: Number(dados.valores.minutosAviso) || 15,
    arquivarTopico: Number(dados.valores.arquivarTopico) || 1440,
    esperaReivindicar: Boolean(dados.valores.esperaReivindicar),
    minutosReivindicar: Number(dados.valores.minutosReivindicar) || 1,
    analiseAutomatica: dados.valores.analiseAutomatica !== false,
    minutosAnalise: Number(dados.valores.minutosAnalise) || 30,
    topicosPrivados: dados.valores.topicosPrivados !== false,
    senhaCadeia: dados.valores.senhaCadeia === true,
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
    edicao.somenteLeitura && !antes.somenteLeitura && 'O site entra em modo somente leitura: todos continuam consultando, mas só você consegue enviar ou alterar algo por ele até desligar.',
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

// Situação da linha: "ok" (configurada), "desligado" (opcional sem valor; não usar "vazio", que é a classe dos estados vazios do site) ou
// "falta" (obrigatória sem valor). "mudou" marca o que ainda não foi salvo.
function linha({ nome, obrigatorio, explica }, id, controle, extra, { valor = true, mudou = false } = {}) {
  const situacao = valor ? 'ok' : obrigatorio ? 'falta' : 'desligado';
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

// Campo de minutos ao lado de um interruptor: botões de menos e mais em volta
// do número, que também aceita digitar. "passo" é quanto cada clique muda.
function campoMinutos(edicao, chave, id, minimo, maximo, padrao, passo = 1) {
  const definir = (valor) => {
    const minutos = Math.round(Number(valor));
    edicao[chave] = Math.min(maximo, Math.max(minimo, Number.isFinite(minutos) ? minutos : padrao));
    desenhar();
  };
  const atual = edicao[chave];
  return el('div', { class: 'bot-minutos' },
    el('div', { class: 'bot-passo', role: 'group', 'aria-label': 'Minutos' },
      el('button', {
        type: 'button', 'aria-label': `Menos ${passo} minuto(s)`, disabled: atual <= minimo,
        onclick: () => definir(atual - passo)
      }, '−'),
      el('label', { for: id },
        el('input', {
          id, type: 'number', min: String(minimo), max: String(maximo), step: '1', inputmode: 'numeric',
          value: String(atual),
          onchange: (evento) => definir(evento.target.value)
        }),
        el('span', null, 'min')),
      el('button', {
        type: 'button', 'aria-label': `Mais ${passo} minuto(s)`, disabled: atual >= maximo,
        onclick: () => definir(atual + passo)
      }, '+')),
    el('small', null, `de ${minimo} a ${maximo}`));
}

const OPCOES_ARQUIVAR = [[60, '1 hora'], [1440, '1 dia'], [4320, '3 dias'], [10080, '1 semana']];

// Permissões do bot em cada canal configurado (lidas do Discord quando a tela abre).
function cartaoDePermissoes(permissoes) {
  if (!permissoes) return null;
  const nomes = Object.fromEntries([...GRUPOS_DE_CANAIS.flatMap(grupo => grupo.itens), ...CANAIS_EXTERNOS].map(item => [item.chave, item.nome]));
  const faltam = permissoes.canais.filter(c => c.situacao !== 'ok').length + permissoes.responsavel.canais.filter(c => c.situacao !== 'ok').length;
  return el('section', { class: 'cartao', id: 'bot-permissoes' },
    cabecalho('escudo', 'Permissões do bot',
      'O que o bot precisa em cada canal configurado. Para corrigir: no Discord, Editar canal > Permissões, escolha o cargo do bot e marque o que falta.',
      faltam ? { tom: 'falta', texto: faltam === 1 ? '1 problema' : `${faltam} problemas` } : { tom: 'ok', texto: 'Tudo certo' }),
    permissoes.canais.length === 0 && el('p', { class: 'bot-ajuda' }, 'Nenhum canal configurado ainda.'),
    el('ul', { class: 'bot-permissoes' },
      permissoes.canais.map(canal => el('li', { class: canal.situacao },
        el('span', { class: 'bot-ponto', 'aria-hidden': 'true' }),
        el('div', null,
          el('strong', null, nomes[canal.chave] || canal.chave),
          el('span', { class: 'bot-permissoes-canal' }, canal.nome || `ID ${canal.canalId}`),
          canal.situacao === 'sumiu'
            ? el('p', null, 'O bot não encontra este canal: foi apagado ou o bot não está no servidor dele.')
            : canal.situacao === 'falta'
              ? el('p', null, `Falta: ${canal.faltando.join(', ')}. Serve para: ${canal.para}`)
              : el('p', null, canal.para)))),
      permissoes.responsavel.canais.map(canal => el('li', { class: canal.situacao },
        el('span', { class: 'bot-ponto', 'aria-hidden': 'true' }),
        el('div', null,
          el('strong', null, `Responsável vê os tópicos privados`),
          el('span', { class: 'bot-permissoes-canal' }, canal.nome),
          el('p', null, canal.situacao === 'ok'
            ? `O cargo ${permissoes.responsavel.cargo} tem "Gerenciar tópicos" neste canal.`
            : `O cargo ${permissoes.responsavel.cargo} não tem "Ver canal" e "Gerenciar tópicos" aqui. O bot tenta dar sozinho ao ligar; se continuar assim, falta ao bot "Gerenciar permissões" neste canal.`))))));
}

// Denúncias pendentes cujo tópico foi apagado: procura sob demanda (confere no Discord).
function cartaoDeTravadas(painel) {
  const travadas = painel.travadas;
  const procurar = (botao) => executar(botao, async () => {
    painel.travadas = await api(`/api/painel-bot/travadas?${new URLSearchParams({ guildId: estado.guildId })}`);
    desenhar();
  });
  const tirar = (botao, ids) => executar(botao, async () => {
    const resposta = await enviarJson('/api/painel-bot/travadas', { guildId: estado.guildId, ids });
    avisar('ok', resposta.mensagem);
    painel.travadas = { ...travadas, travadas: travadas.travadas.filter(d => !ids.includes(d.id)) };
    desenhar();
  });
  return el('section', { class: 'cartao', id: 'bot-travadas' },
    cabecalho('alerta', 'Denúncias travadas',
      'Pendentes cujo tópico foi apagado no Discord. Elas travam o bloqueio de pendências: ninguém reivindica as mais novas do canal. Tópico apagado com o bot ligado já sai da fila sozinho.',
      travadas && { tom: travadas.travadas.length ? 'falta' : 'ok', texto: travadas.travadas.length ? `${travadas.travadas.length} travada(s)` : 'Nenhuma' }),
    !travadas && el('p', { class: 'bot-ajuda' }, 'O bot confere no Discord as 30 pendentes mais antigas.'),
    travadas && travadas.travadas.length === 0 && el('p', { class: 'bot-ajuda' }, `Conferidas ${travadas.conferidas} pendente(s): nenhuma com o tópico apagado.`),
    travadas && travadas.travadas.length > 0 && el('ul', { class: 'bot-travadas' },
      travadas.travadas.map(d => el('li', null,
        el('div', null,
          el('strong', null, `Denunciante ${d.denunciante || '?'} · acusado ${d.acusado || '?'}`),
          el('p', null, `${d.motivo || 'Sem motivo'} · aberta em ${formatarData(d.em)}`)),
        el('button', { type: 'button', onclick: (evento) => tirar(evento.currentTarget, [d.id]) }, 'Tirar da fila')))),
    el('div', { class: 'acoes bot-acoes-cartao' },
      travadas?.travadas?.length > 1 && el('button', { type: 'button', class: 'perigo', onclick: (evento) => tirar(evento.currentTarget, travadas.travadas.map(d => d.id)) }, 'Tirar todas da fila'),
      el('button', { type: 'button', onclick: (evento) => procurar(evento.currentTarget) }, travadas ? 'Procurar de novo' : 'Procurar denúncias travadas')));
}

// Quem mudou o quê no painel (site e /painel do Discord), das mais novas para as mais antigas.
function cartaoDeHistorico(historico) {
  return el('section', { class: 'cartao', id: 'bot-historico' },
    cabecalho('relogio', 'Histórico de alterações', 'As últimas 20 mudanças no painel, pelo site ou pelo /painel do Discord.',
      { texto: historico?.length ? `${historico.length} registro(s)` : 'Vazio' }),
    !historico?.length && el('p', { class: 'bot-ajuda' }, 'Nenhuma alteração registrada ainda. O histórico começa a contar a partir desta versão do bot.'),
    historico?.length > 0 && el('ol', { class: 'bot-historico' },
      historico.map(item => el('li', null,
        el('p', { class: 'bot-historico-quem' },
          el('strong', null, item.por || 'Alguém'),
          ` ${item.via === 'discord' ? 'no /painel do Discord' : 'pelo site'} · ${formatarData(item.em)}`),
        el('ul', null, item.mudancas.map(m => el('li', null, el('span', null, m.campo), `: ${m.antes} → ${m.depois}`)))))));
}

// Motivos de punição da ponte com o jogo: só leitura (quem edita é o dono do bot,
// no /admin ou com /ponte motivos, porque a tabela é a mesma em todos os servidores).
function cartaoDeMotivos(motivos) {
  if (!motivos?.itens?.length) return null;
  const grupos = new Map();
  for (const item of motivos.itens) {
    if (!grupos.has(item.grupo)) grupos.set(item.grupo, []);
    grupos.get(item.grupo).push(item);
  }
  return el('section', { class: 'cartao', id: 'bot-motivos' },
    cabecalho('arquivo', 'Motivos de punição (jogo)',
      'Tabela usada pelo painel do jogo para escolher a punição pelo motivo do aceite. É a mesma em todos os servidores; administradores e responsáveis alteram em Motivos de punição.',
      { texto: `${motivos.itens.length} motivos${motivos.propria ? ' · personalizada' : ''}` }),
    el('p', { class: 'bot-ajuda' }, 'Vários motivos na mesma denúncia: banimentos somam dias e avisos; permanente vence tudo (vira /blackban); banimento vence cadeia. Todo motivo vai com [DC] no fim.'),
    [...grupos.entries()].map(([grupo, itens]) => el('div', { class: 'campo' },
      el('strong', null, grupo),
      el('p', { class: 'bot-ajuda' }, itens.map(item => (item.sinonimos.length ? `${item.nome} (${item.sinonimos.join(', ')})` : item.nome)).join(' · ')))));
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
    edicao.somenteLeitura !== antes.somenteLeitura,
    edicao.alertaCritico !== antes.alertaCritico,
    edicao.esperaDenuncia !== antes.esperaDenuncia,
    edicao.minutosDenuncia !== antes.minutosDenuncia,
    edicao.avisoReivindicar !== antes.avisoReivindicar,
    edicao.minutosAviso !== antes.minutosAviso,
    edicao.arquivarTopico !== antes.arquivarTopico,
    edicao.esperaReivindicar !== antes.esperaReivindicar,
    edicao.minutosReivindicar !== antes.minutosReivindicar,
    edicao.analiseAutomatica !== antes.analiseAutomatica,
    edicao.minutosAnalise !== antes.minutosAnalise,
    edicao.topicosPrivados !== antes.topicosPrivados,
    edicao.senhaCadeia !== antes.senhaCadeia,
    edicao.isentos.trim() !== antes.isentos.trim(),
    ...todosOsCanais.map(item => edicao.channels[item.chave] !== antes.channels[item.chave]),
    ...CARGOS.map(item => edicao.roles[item.chave] !== antes.roles[item.chave])
  ].filter(Boolean).length;

  const canais = contar(todosOsCanais, edicao.channels);
  const cargos = contar(CARGOS, edicao.roles);
  const isentos = edicao.isentos.split(/[\s,;]+/).filter(Boolean).length;
  const nomesDosIsentos = painel.valores.isentos;
  const problemas = painel.permissoes
    ? painel.permissoes.canais.filter(c => c.situacao !== 'ok').length + painel.permissoes.responsavel.canais.filter(c => c.situacao !== 'ok').length
    : 0;
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
        resumo('Isentos', String(isentos), isentos === 1 ? 'conta sem filtros' : 'contas sem filtros', '', 'bot-isentos-bloco'),
        painel.permissoes && resumo('Permissões', problemas ? String(problemas) : 'OK', problemas ? (problemas === 1 ? 'problema' : 'problemas') : 'tudo certo', problemas ? 'falta' : 'ok', 'bot-permissoes')),

      cartaoDePermissoes(painel.permissoes),

      el('section', { class: 'cartao', id: 'bot-funcionamento' },
        cabecalho('ajustes', 'Funcionamento', 'Liga e desliga o que vale para o servidor inteiro.'),
        linha({ nome: 'Manutenção das denúncias', explica: 'Ligada, ninguém consegue abrir denúncia nova, nem pelo Discord nem pelo site, e a mensagem do /denuncia avisa da manutenção. As denúncias já abertas continuam normais.' },
          'bot-manutencao', interruptor(edicao, 'manutencao', 'bot-manutencao', { ligado: 'Em manutenção', desligado: 'Denúncias abertas' }), null,
          { valor: !edicao.manutencao, mudou: edicao.manutencao !== antes.manutencao }),
        linha({ nome: 'Bloqueio de pendências anteriores', explica: 'Ligado, a staff só consegue reivindicar uma denúncia depois que as mais antigas do mesmo canal forem reivindicadas. Serve para ninguém pular a fila.' },
          'bot-bloqueio', interruptor(edicao, 'bloqueio', 'bot-bloqueio', { ligado: 'Fila em ordem', desligado: 'Qualquer ordem' }), null,
          { valor: edicao.bloqueio, mudou: edicao.bloqueio !== antes.bloqueio }),
        linha({ nome: 'Site em modo somente leitura', explica: 'Ligado, o site fica só para consulta: ninguém abre denúncia, envia mensagem, escreve no chat nem decide caso por ele. Só o responsável continua podendo alterar. O bot no Discord segue funcionando normalmente. Serve para manutenção sem tirar o site do ar.' },
          'bot-leitura', interruptor(edicao, 'somenteLeitura', 'bot-leitura', { ligado: 'Só consulta', desligado: 'Site normal' }), null,
          { valor: !edicao.somenteLeitura, mudou: edicao.somenteLeitura !== antes.somenteLeitura }),
        linha({ nome: 'Alerta de motivo crítico', explica: 'Ligado, o bot marca o cargo de responsável no tópico da denúncia quando o motivo é zaralho, dark RP, hack ou mods proibidos. Desligado, a denúncia abre normalmente, sem marcar ninguém.' },
          'bot-alerta-critico', interruptor(edicao, 'alertaCritico', 'bot-alerta-critico', { ligado: 'Marca o responsável', desligado: 'Sem marcação' }), null,
          { valor: edicao.alertaCritico, mudou: edicao.alertaCritico !== antes.alertaCritico }),
        linha({ nome: 'Espera entre denúncias', explica: 'Ligada, quem acabou de abrir uma denúncia espera o tempo escolhido para abrir outra, pelo Discord ou pelo site. Desligada, pode abrir uma atrás da outra.' },
          'bot-espera-denuncia', interruptor(edicao, 'esperaDenuncia', 'bot-espera-denuncia', { ligado: `Espera ${edicao.minutosDenuncia} min`, desligado: 'Sem espera' }),
          edicao.esperaDenuncia && campoMinutos(edicao, 'minutosDenuncia', 'bot-minutos-denuncia', 1, 60, 1),
          { valor: edicao.esperaDenuncia, mudou: edicao.esperaDenuncia !== antes.esperaDenuncia || edicao.minutosDenuncia !== antes.minutosDenuncia }),
        linha({ nome: 'Aviso de reivindicação parada', explica: 'Ligado, quando uma denúncia fica reivindicada sem ir para análise pelo tempo escolhido, o bot avisa quem reivindicou no tópico, no Log Admin e por DM. Desligado, ninguém é avisado.' },
          'bot-aviso-reivindicar', interruptor(edicao, 'avisoReivindicar', 'bot-aviso-reivindicar', { ligado: `Após ${edicao.minutosAviso} min`, desligado: 'Sem aviso' }),
          edicao.avisoReivindicar && campoMinutos(edicao, 'minutosAviso', 'bot-minutos-aviso', 5, 120, 15, 5),
          { valor: edicao.avisoReivindicar, mudou: edicao.avisoReivindicar !== antes.avisoReivindicar || edicao.minutosAviso !== antes.minutosAviso }),
        linha({ nome: 'Espera para reivindicar', explica: 'Ligada, a staff espera o tempo escolhido depois de reivindicar uma denúncia para reivindicar outra. O cargo de responsável não espera. Desligada, pode reivindicar uma atrás da outra.' },
          'bot-espera-reivindicar', interruptor(edicao, 'esperaReivindicar', 'bot-espera-reivindicar', { ligado: `Espera ${edicao.minutosReivindicar} min`, desligado: 'Sem espera' }),
          edicao.esperaReivindicar && campoMinutos(edicao, 'minutosReivindicar', 'bot-minutos-reivindicar', 1, 60, 1),
          { valor: edicao.esperaReivindicar, mudou: edicao.esperaReivindicar !== antes.esperaReivindicar || edicao.minutosReivindicar !== antes.minutosReivindicar }),
        linha({ nome: 'Análise automática', explica: 'Ligada, a denúncia reivindicada que ficar parada vai sozinha para análise depois do tempo escolhido, em nome de quem reivindicou. Desligada, ela fica reivindicada até alguém colocar em análise.' },
          'bot-analise-automatica', interruptor(edicao, 'analiseAutomatica', 'bot-analise-automatica', { ligado: `Após ${edicao.minutosAnalise} min`, desligado: 'Desligada' }),
          edicao.analiseAutomatica && campoMinutos(edicao, 'minutosAnalise', 'bot-minutos-analise', 5, 240, 30, 5),
          { valor: edicao.analiseAutomatica, mudou: edicao.analiseAutomatica !== antes.analiseAutomatica || edicao.minutosAnalise !== antes.minutosAnalise }),
        linha({ nome: 'Tópicos privados', explica: 'Ligada, a denúncia em que todos os acusados estão no banco abre em tópico privado: só o denunciante, os acusados e a staff veem. Desligada, toda denúncia abre em tópico público (só as partes e a staff conseguem falar nele, como antes).' },
          'bot-topicos-privados', interruptor(edicao, 'topicosPrivados', 'bot-topicos-privados', { ligado: 'Privado', desligado: 'Sempre público' }), null,
          { valor: edicao.topicosPrivados, mudou: edicao.topicosPrivados !== antes.topicosPrivados }),
        linha({ nome: 'Senha para aceitar e recusar na Cadeia Staff', explica: 'Ligada, quem clica em Aceitar ou Recusar na Cadeia Staff precisa da senha pessoal. Na primeira vez a pessoa cria a senha (digita e confirma); depois fica liberada por 30 minutos e, passado esse tempo, digita a senha de novo. Só um código protegido da senha fica guardado.' },
          'bot-senha-cadeia', interruptor(edicao, 'senhaCadeia', 'bot-senha-cadeia', { ligado: 'Pede senha', desligado: 'Sem senha' }), null,
          { valor: edicao.senhaCadeia, mudou: edicao.senhaCadeia !== antes.senhaCadeia }),
        linha({ nome: 'Arquivar tópicos sem mensagem', explica: 'Tempo sem mensagem até o tópico de uma denúncia nova ser arquivado. Arquivado, ele some da lista do lado no Discord, mas continua aberto pelo link e volta sozinho quando alguém escreve. Vale para as denúncias abertas depois de salvar.' },
          'bot-arquivar', el('select', {
            id: 'bot-arquivar',
            onchange: (evento) => { edicao.arquivarTopico = Number(evento.target.value); desenhar(); }
          }, OPCOES_ARQUIVAR.map(([valor, texto]) => el('option', { value: String(valor), selected: edicao.arquivarTopico === valor }, texto))), null,
          { valor: true, mudou: edicao.arquivarTopico !== antes.arquivarTopico })),

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

      cartaoDeMotivos(painel.motivosPonte),

      cartaoDeTravadas(painel),

      cartaoDeHistorico(painel.historico),

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
