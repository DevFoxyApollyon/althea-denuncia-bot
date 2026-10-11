// Painel do bot: o mesmo /painel do Discord, com a explicação de cada opção.
// Canais e cargos do servidor são escolhidos em listas; valem só para o
// servidor selecionado (menos os usuários isentos, que são de todos).
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { api, avisar, el, enviarJson, formatarData } from './util.js';

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

function linha({ nome, obrigatorio, explica }, id, controle, extra) {
  return el('div', { class: 'bot-linha' },
    el('div', { class: 'bot-rotulo' },
      el('label', { for: id }, nome, obrigatorio && el('span', { class: 'bot-obrigatorio' }, 'obrigatório')),
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

export function telaPainelDoBot() {
  const painel = estado.painelBot;

  if (!painel) {
    return el('main', { class: 'principal' }, blocoAviso() || el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': 'Carregando o painel do bot' },
      el('span'), el('span'), el('span'), el('span')));
  }

  const { edicao } = painel;
  const mudou = JSON.stringify(edicao) !== painel.salvo;
  const nomesDosIsentos = painel.valores.isentos.filter(item => item.nome);

  return el('main', { class: 'principal' },
    el('div', { class: 'config bot' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Painel do bot'),
          el('p', { class: 'sub' }, 'As mesmas opções do comando /painel do Discord. O que você salvar aqui vale na hora para o bot e para o site.'),
          painel.atualizado?.em && el('p', { class: 'sub bot-atualizado' }, `Última alteração: ${formatarData(painel.atualizado.em)}${painel.atualizado.por ? `, por ${painel.atualizado.por}` : ''}`)),
        el('div', { class: 'acoes' },
          mudou && el('span', { class: 'bot-pendente' }, 'Há mudanças não salvas'),
          el('button', { class: 'primario', type: 'button', disabled: !mudou, onclick: (evento) => salvar(evento.currentTarget) }, 'Salvar painel'))),
      blocoAviso(),

      el('section', { class: 'cartao' },
        el('h2', null, 'Funcionamento'),
        linha({ nome: 'Manutenção das denúncias', explica: 'Ligada, ninguém consegue abrir denúncia nova, nem pelo Discord nem pelo site, e a mensagem do /denuncia avisa da manutenção. As denúncias já abertas continuam normais.' },
          'bot-manutencao', interruptor(edicao, 'manutencao', 'bot-manutencao', { ligado: 'Em manutenção', desligado: 'Denúncias abertas' })),
        linha({ nome: 'Bloqueio de pendências anteriores', explica: 'Ligado, a staff só consegue reivindicar uma denúncia depois que as mais antigas do mesmo canal forem reivindicadas. Serve para ninguém pular a fila.' },
          'bot-bloqueio', interruptor(edicao, 'bloqueio', 'bot-bloqueio', { ligado: 'Fila em ordem', desligado: 'Qualquer ordem' }))),

      GRUPOS_DE_CANAIS.map(grupo => el('section', { class: 'cartao' },
        el('h2', null, grupo.titulo),
        el('p', { class: 'sub' }, grupo.texto),
        grupo.itens.map(item => linha(item, `bot-canal-${item.chave}`, seletor(edicao.channels, item, `bot-canal-${item.chave}`, painel.canais, '# '))))),

      el('section', { class: 'cartao' },
        el('h2', null, 'Canais de outros servidores'),
        el('p', { class: 'sub' }, 'Estes canais podem ficar em outro servidor, por isso entram pelo ID. O bot precisa estar no servidor e enxergar o canal. Para copiar o ID no Discord: ative o Modo desenvolvedor, clique com o botão direito no canal e escolha "Copiar ID do canal".'),
        CANAIS_EXTERNOS.map(item => linha(item, `bot-canal-${item.chave}`,
          el('input', {
            id: `bot-canal-${item.chave}`,
            type: 'text',
            inputmode: 'numeric',
            maxlength: '21',
            placeholder: 'Não configurado',
            value: edicao.channels[item.chave],
            oninput: (evento) => { edicao.channels[item.chave] = evento.target.value.trim(); },
            onchange: () => desenhar()
          }),
          painel.externos[item.chave] && edicao.channels[item.chave] === painel.valores.channels[item.chave] && el('small', null, painel.externos[item.chave])))),

      el('section', { class: 'cartao' },
        el('h2', null, 'Cargos'),
        el('p', { class: 'sub' }, 'O bot e o site decidem o que cada pessoa pode fazer pelos cargos dela no Discord.'),
        CARGOS.map(item => linha(item, `bot-cargo-${item.chave}`, seletor(edicao.roles, item, `bot-cargo-${item.chave}`, painel.cargos, '@ ')))),

      el('section', { class: 'cartao' },
        el('h2', null, 'Usuários isentos'),
        el('p', { class: 'sub' }, 'Contas que o bot não filtra: não levam strike por palavras proibidas, não têm links barrados, podem escrever em tópicos restritos e podem recusar uma denúncia escrevendo "recusado" no tópico. A lista é a mesma em todos os servidores.'),
        el('div', { class: 'campo' },
          el('label', { for: 'bot-isentos' }, 'IDs do Discord, um por linha'),
          el('textarea', {
            id: 'bot-isentos',
            rows: '4',
            placeholder: '123456789012345678',
            value: edicao.isentos,
            oninput: (evento) => { edicao.isentos = evento.target.value; },
            onchange: () => desenhar()
          })),
        nomesDosIsentos.length > 0 && el('p', { class: 'sub bot-isentos-nomes' }, `Na lista hoje: ${nomesDosIsentos.map(item => item.nome).join(', ')}.`))));
}
