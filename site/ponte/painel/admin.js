// Painel do dono. Tudo é montado com textContent (nada de HTML vindo da API).
const ACOES = ['editar', 'codigo_negado', 'regras', 'ativar', 'apagar',
  'gm', 'gm_busca', 'gm_resultado', 'gm_auth_falhou', 'gm_selo_invalido', 'gm_enviar', 'gm_cancelar', 'gm_incerto_ok', 'gm_incerto_reenviar', 'gm_credencial', 'gm_config'];
const STATUS_PEDIDO = ['aprovado', 'entregue', 'aplicada', 'simulada', 'recusada', 'erro', 'incerto', 'cancelado'];
// "ban 5d + 1 aviso(s)", "ban permanente", "cadeia 120 min".
const punicaoGm = (p) => {
  const base = p.tipo === 'ban' ? (p.tempo === 0 ? 'ban permanente' : `ban ${p.tempo}d`) : p.tipo === 'cadeia' ? `cadeia ${p.tempo} min` : p.tipo;
  return p.avisos ? `${base} + ${p.avisos} aviso(s)` : base;
};
let csrf = '';
// Dono do bot (OWNER_DISCORD_ID). Quem ele liberou vê o painel, mas não os botões só do dono.
let dono = false;
let ultimoUso = null;

const $ = (sel) => document.querySelector(sel);
const data = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—');

// "agora", "há 5 min", "há 3 h", "há 2 dias".
function relativo(v) {
  if (!v) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const dias = Math.floor(s / 86400);
  return `há ${dias} dia${dias === 1 ? '' : 's'}`;
}

// Elemento com texto seguro (textContent): nada de HTML vindo da API.
function el(tag, atributos = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'classe') elemento.className = valor;
    else if (chave.startsWith('on')) elemento.addEventListener(chave.slice(2), valor);
    else elemento.setAttribute(chave, valor);
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return elemento;
}

// O que cada ação da auditoria quer dizer, em português corrido.
const ROTULOS = {
  editar: 'editou uma punição', codigo_negado: 'tentou gerar código sem permissão',
  regras: 'mudou a tabela de motivos', ativar: 'ativou a ponte', apagar: 'apagou um registro',
  gm_busca: 'buscou pedidos', gm_resultado: 'respondeu um pedido', gm_auth_falhou: 'errou a autenticação da gamemode',
  gm_selo_invalido: 'recusou um selo (alerta)', gm_enviar: 'enviou uma punição ao jogo', gm_cancelar: 'cancelou um envio ao jogo',
  gm_incerto_ok: 'confirmou um incerto como aplicado', gm_incerto_reenviar: 'reenviou um incerto', gm_credencial: 'mexeu numa credencial',
  gm_config: 'mudou a configuração da gamemode'
};
const SUBROTULOS = {
  criar: 'criou uma credencial da gamemode', revogar: 'revogou uma credencial da gamemode', renovar: 'renovou uma credencial da gamemode',
  chave_mestra: 'trocou a chave mestra', pausar: 'pausou a gamemode', retomar: 'retomou a gamemode',
  limites: 'mudou os limites da gamemode', acesso_admin_adicionar: 'liberou alguém no painel', acesso_admin_remover: 'tirou o acesso de alguém ao painel',
  apagar_codigo: 'apagou um código de ativação'
};
const rotulo = (acao, subacao) => SUBROTULOS[subacao] || ROTULOS[acao] || acao;
const ICONE_AUTOR = { gamemode: '🎮', pessoa: '👤' };

// Celular: cada linha de tabela vira um cartão e cada célula mostra o nome da coluna.
function rotularTabelas(raizBusca = document) {
  for (const tabela of raizBusca.querySelectorAll('table')) {
    const nomes = [...tabela.querySelectorAll('thead th')].map(th => th.textContent.trim());
    for (const tr of tabela.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => { if (nomes[i]) td.dataset.rotulo = nomes[i]; });
    }
  }
}
const aviso = (texto) => { $('#aviso').textContent = texto || ''; };

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/admin/api${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.method ? { 'X-CSRF': csrf } : {}) },
    credentials: 'same-origin'
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || `Erro ${resposta.status}`);
  return corpo;
}
const post = (caminho, corpo = {}) => api(caminho, { method: 'POST', body: JSON.stringify(corpo) });

function linha(celulas, acao) {
  const tr = document.createElement('tr');
  for (const valor of celulas) {
    const td = document.createElement('td');
    if (valor && typeof valor === 'object') {
      td.textContent = valor.texto;
      if (valor.classe) td.className = valor.classe;
    } else td.textContent = valor ?? '—';
    tr.append(td);
  }
  // Uma ação ou uma lista delas.
  const td = document.createElement('td');
  for (const item of [].concat(acao || []).filter(Boolean)) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = item.perigo === false ? '' : 'perigo';
    botao.textContent = item.texto;
    botao.addEventListener('click', async () => {
      if (!confirm(item.confirmar)) return;
      try { await item.executar(); aviso('Feito.'); carregar(item.recarregar); } catch (e) { aviso(e.message); }
    });
    td.append(botao);
  }
  td.className = 'botoes';
  tr.append(td);
  return tr;
}

// ---------------------------------------------------------------- controle da gamemode (só o dono)
async function mudarGamemode(s, mudanca, pergunta) {
  if (pergunta && !confirm(pergunta)) return;
  let texto;
  try {
    const r = await post(`/servidores/${s.guildId}/gamemode`, mudanca);
    texto = ['Feito.',
      r.conexoesRetomadas && `${r.conexoesRetomadas} credencial(is) pausada(s) voltaram a funcionar.`,
    ].filter(Boolean).join(' ');
  } catch (e) { texto = e.message; }
  // Recarregar limpa o aviso: ele vem depois.
  await carregar('controle');
  aviso(texto);
}

// Interruptor liga/desliga (role=switch).
const interruptor = (ligado, rotulo, aoMudar) => el('button', {
  type: 'button', role: 'switch', classe: 'interruptor', 'aria-checked': String(ligado), 'aria-label': rotulo, title: rotulo, onclick: aoMudar
}, el('span', { classe: 'interruptor-bolinha' }));

// Uma linha de log da gamemode, em português.
function textoDoEvento(e) {
  const d = e.detalhes || {};
  const conta = [e.contaId && `conta ${e.contaId}`, e.nick].filter(Boolean).join(' ');
  switch (e.acao) {
    case 'gm_busca': return `Buscou ${(d.pedidos || []).length} pedido(s)`;
    case 'gm_resultado': return `Respondeu: ${d.status || '?'}${d.codigo ? ` (${d.codigo})` : ''}${conta ? ` · ${conta}` : ''}`;
    case 'gm_auth_falhou': return `Conexão recusada: ${d.codigo || '?'}`;
    case 'gm_enviar': return `${d.nome || 'Staff'} enviou ${d.alvos || 0} alvo(s) ao jogo${d.teste ? ' (teste)' : ''}`;
    case 'gm_cancelar': return `${d.nome || 'Staff'} cancelou um envio`;
    case 'gm_config': return `Configuração: ${d.sub || '?'}${d.para ? ` → ${d.para}` : ''}${d.modoTeste !== undefined ? ` → teste ${d.modoTeste ? 'ligado' : 'desligado'}` : ''}${d.via === 'admin' ? ' (painel)' : ''}`;
    case 'gm_selo_invalido': return 'Selo inválido: a credencial foi pausada';
    default: return ROTULOS[e.acao] || e.acao;
  }
}
const tomDoEvento = (e) => (e.acao === 'gm_auth_falhou' || e.acao === 'gm_selo_invalido' || ['recusada', 'erro', 'incerto'].includes(e.detalhes?.status) ? 'atencao'
  : e.detalhes?.status === 'aplicada' ? 'online' : '');

function logsDaGamemode(eventos = []) {
  return el('details', { classe: 'controle-logs', open: '' },
    el('summary', {}, `Logs da gamemode (${eventos.length ? `últimos ${eventos.length}` : 'nenhum ainda'})`),
    eventos.length
      ? el('ol', {}, eventos.map(e => el('li', { classe: tomDoEvento(e) },
        el('time', { datetime: new Date(e.em).toISOString(), title: data(e.em) }, relativo(e.em)),
        el('span', {}, textoDoEvento(e)))))
      : el('p', { classe: 'dica-curta' }, 'A gamemode ainda não registrou nada neste servidor.'));
}

async function renomearConexao(conexao) {
  const nome = prompt(`Nome novo para a credencial "${conexao.nome}" (até 40 letras).
É o nome que aparece no relatório: "Aplicada pela gamemode (nome)".`, conexao.nome);
  if (nome === null || nome.trim() === conexao.nome) return;
  let mensagem;
  try {
    const r = await post(`/gamemode/conexoes/${conexao.id}/nome`, { nome });
    mensagem = `Credencial renomeada para "${r.nome}".`;
  } catch (e) { mensagem = e.message; }
  await carregar('controle');
  aviso(mensagem);
}

async function editarIps(conexao) {
  const texto = prompt(`IPs que podem usar a credencial "${conexao.nome}", separados por vírgula.
Deixe vazio para aceitar qualquer IP.

Se errar o IP, a gamemode para de conectar (403 IP) até você corrigir aqui.`, conexao.ipsPermitidos.join(', '));
  if (texto === null) return;
  let mensagem;
  try {
    const r = await post(`/gamemode/conexoes/${conexao.id}/ips`, { ips: texto });
    mensagem = r.ips.length ? `Credencial travada em ${r.ips.join(', ')}.` : 'Trava por IP tirada: qualquer IP com a credencial é aceito.';
  } catch (e) { mensagem = e.message; }
  await carregar('controle');
  aviso(mensagem);
}

async function travarNoIpAtual(conexao) {
  if (!confirm(`Travar a credencial "${conexao.nome}" no IP ${conexao.ultimoIp}, de onde a gamemode conectou por último?

Se o IP do servidor do jogo mudar (internet de casa costuma mudar), ela para de conectar até você atualizar aqui.`)) return;
  let mensagem;
  try {
    const r = await post(`/gamemode/conexoes/${conexao.id}/ips`, { ips: [...conexao.ipsPermitidos, conexao.ultimoIp] });
    mensagem = `Credencial travada em ${r.ips.join(', ')}.`;
  } catch (e) { mensagem = e.message; }
  await carregar('controle');
  aviso(mensagem);
}

// Limites dos envios à gamemode (os mesmos do /ponte gamemode limites).
function limitesDoServidor(s) {
  const l = s.limites || {};
  const campo = (nome, rotulo, valor, min, max) => el('label', {}, rotulo,
    el('input', { type: 'number', name: nome, min: String(min), max: String(max), step: '1', inputmode: 'numeric', value: String(valor ?? ''), required: '' }));
  const salvar = async (evento) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    await mudarGamemode(s, {
      limites: {
        maxBanDias: Number(dados.get('maxBanDias')),
        maxCadeiaMin: Number(dados.get('maxCadeiaMin')),
        maxAvisos: Number(dados.get('maxAvisos')),
        permitirPermanente: dados.get('permitirPermanente') === 'on'
      }
    }, null);
  };
  return el('div', { classe: 'controle-limites' },
    el('span', { classe: 'controle-rotulo' }, 'Limites dos envios', el('small', {}, 'A gamemode também tem os limites dela (ALTHEA_MAX_*): vale o menor dos dois.')),
    el('form', { onsubmit: salvar },
      campo('maxBanDias', 'Ban máximo (dias)', l.maxBanDias, 1, 99999),
      campo('maxCadeiaMin', 'Cadeia máxima (min)', l.maxCadeiaMin, 1, 99999),
      campo('maxAvisos', 'Avisos máximos', l.maxAvisos, 0, 10),
      el('label', { classe: 'caixa' }, el('input', { type: 'checkbox', name: 'permitirPermanente', ...(l.permitirPermanente ? { checked: '' } : {}) }), 'Ban permanente liberado'),
      el('button', { type: 'submit', classe: 'pequeno' }, 'Salvar limites')));
}

// Trava por IP de cada credencial do servidor.
function travaPorIp(conexoes = []) {
  return el('div', { classe: 'controle-ips' },
    el('span', { classe: 'controle-rotulo' }, 'Trava por IP', el('small', {}, 'Só os IPs da lista conseguem usar a credencial.')),
    conexoes.length
      ? el('ul', {}, conexoes.map(c => {
        const livre = !c.ipsPermitidos.length;
        const foraDaLista = c.ultimoIp && !c.ipsPermitidos.includes(c.ultimoIp);
        return el('li', { classe: livre ? 'livre' : '' },
          el('div', {},
            el('strong', {}, c.nome),
            el('span', { classe: livre ? 'atencao' : 'online' }, livre ? '⚠️ qualquer IP' : `🔒 ${c.ipsPermitidos.join(', ')}`),
            el('small', {}, c.ultimoIp ? `Último contato: ${c.ultimoIp}${foraDaLista && !livre ? ' (fora da lista)' : ''}` : 'Ainda não conectou')),
          el('div', { classe: 'controle-ips-botoes' },
            c.ultimoIp && foraDaLista && el('button', { type: 'button', classe: 'pequeno', onclick: () => travarNoIpAtual(c) }, livre ? 'Travar no IP atual' : 'Adicionar IP atual'),
            el('button', { type: 'button', classe: 'pequeno', onclick: () => editarIps(c) }, 'Editar IPs'),
            el('button', { type: 'button', classe: 'pequeno', onclick: () => renomearConexao(c) }, 'Renomear')));
      }))
      : el('p', { classe: 'dica-curta' }, 'Nenhuma credencial ativa. Crie com /ponte gamemode criar.'));
}

function cartaoDeControle(s) {
  // Só aplica de verdade sem pausa e sem teste nos dois lados.
  const real = !s.pausado && !s.modoTesteBot && s.modoTesteJogo === false;
  const situacao = real ? 'Aplica de verdade' : s.pausado ? 'Pausada' : 'Só simula';
  const jogo = s.modoTesteJogo === null ? 'sem contato ainda' : s.modoTesteJogo ? 'ligado' : 'desligado';

  return el('article', { classe: `cartao-servidor controle${real ? ' real' : ''}` },
    el('header', {},
      el('h3', {}, s.nome || s.guildId),
      el('span', { classe: `selo ${s.online ? 'ok' : 'off'}` }, s.online ? '● gamemode online' : '○ gamemode offline'),
      el('span', { classe: `selo ${real ? 'perigo' : 'neutro'}` }, situacao)),
    el('div', { classe: 'controle-linha' },
      el('span', { classe: 'controle-rotulo' }, 'Modo teste no bot', el('small', {}, `No jogo: ${jogo}`)),
      interruptor(s.modoTesteBot, 'Modo teste no bot', () => mudarGamemode(s, { modoTeste: !s.modoTesteBot },
        s.modoTesteBot ? 'Desligar o modo teste no bot? Com o jogo também fora do teste, as próximas punições são aplicadas de verdade.' : null))),
    el('div', { classe: 'controle-linha' },
      el('span', { classe: 'controle-rotulo' }, 'Entregar pedidos', el('small', {}, s.pausado ? 'Pausada: os pedidos ficam na fila' : 'A gamemode recebe os pedidos')),
      interruptor(!s.pausado, 'Entregar pedidos', () => mudarGamemode(s, { pausado: !s.pausado },
        s.pausado ? null : 'Pausar a gamemode? As buscas vêm vazias até retomar.'))),
    limitesDoServidor(s),
    travaPorIp(s.conexoes),
    logsDaGamemode(s.eventos),
    el('footer', {},
      el('span', { classe: 'dica-curta' }, `${s.aplicadas} aplicada(s) · ${s.simuladas} simulada(s)${s.incertos ? ` · ${s.incertos} incerto(s)` : ''}`),
      el('code', {}, s.guildId)));
}

function preencher(secao, linhas) {
  const tbody = $(`#aba-${secao} tbody`);
  tbody.replaceChildren(...linhas);
}

// O que falta para o servidor aplicar pela gamemode, na ordem do guia.
function proximoPasso(s, chaveMestra) {
  if (!chaveMestra) return 'Passo 1: colocar PONTE_CHAVE_MESTRA no .env e reiniciar o bot.';
  if (!s.credenciais) return 'Passo 1: /ponte gamemode criar nome:';
  if (!s.ultimoContatoEm) return 'Passo 2: instalar o include e o althea_credenciais.txt na gamemode.';
  if (!s.online) return 'A gamemode parou de buscar: conferir o servidor (rcon althea status).';
  if (s.pausado || s.pausadas) return 'Pausada: /ponte gamemode retomar (se foi selo inválido, conferir a credencial antes).';
  if (s.incertos) return 'Resolver os incertos no Log Admin.';
  if (s.modoTesteBot || s.modoTesteJogo) return 'Em teste: quando conferir, desligar o modo teste no bot e no jogo.';
  if (s.semIp) return 'Funcionando. Falta restringir os IPs da credencial.';
  return '✅ Aplicando de verdade.';
}

// Linha sem a coluna de botões.
function linhaSimples(celulas) {
  const tr = linha(celulas);
  tr.lastChild.remove();
  return tr;
}

function numero(rotuloNumero, valor, detalhe, tom = '') {
  return el('div', { classe: `numero ${tom}` }, el('span', { classe: 'numero-rotulo' }, rotuloNumero), el('strong', {}, valor), detalhe && el('small', {}, detalhe));
}

function cartaoDoServidor(s) {
  const quem = s.ultimoUso?.quem;
  const ativador = s.ativadoPor ? (s.ativadoPor.nome || s.ativadoPor.id) : '';
  const desativar = dono && s.ativo && el('button', {
    type: 'button', classe: 'perigo pequeno',
    onclick: async () => {
      if (!confirm(`Desativar a ponte em ${s.nome || s.guildId}?`)) return;
      try { await post(`/servidores/${s.guildId}/desativar`); aviso('Ponte desativada.'); carregar('geral'); } catch (e) { aviso(e.message); }
    }
  }, 'Desativar');
  return el('article', { classe: `cartao-servidor ${s.ativo ? '' : 'apagado'}` },
    el('header', {},
      el('h3', {}, s.nome || 'Servidor sem nome'),
      el('span', { classe: `selo ${s.ativo ? 'ok' : 'off'}` }, s.ativo ? 'Ativo' : 'Desativado')),
    el('dl', {},
      el('div', {}, el('dt', {}, 'Ativado por'), el('dd', {}, ativador ? `${ativador} · ${relativo(s.ativadoEm)}` : relativo(s.ativadoEm))),
      el('div', {}, el('dt', {}, 'Último uso'), el('dd', {}, s.ultimoUso
        ? [quem?.nome && el('strong', {}, `${ICONE_AUTOR[quem.tipo] || ''} ${quem.nome} `), rotulo(s.ultimoUso.acao), el('small', {}, ` · ${relativo(s.ultimoUso.em)}`)]
        : 'ninguém usou ainda'))),
    el('footer', {}, el('code', { title: 'ID do servidor' }, s.guildId), desativar));
}

function itemDeAtividade(a) {
  const detalhe = [a.nick || a.contaId, a.comando].filter(Boolean).join(' · ');
  return el('li', {},
    el('span', { classe: 'atividade-icone', 'aria-hidden': 'true' }, ICONE_AUTOR[a.quem?.tipo] || '•'),
    el('div', {},
      el('p', {}, el('strong', {}, a.quem?.nome || 'Sistema'), ` ${rotulo(a.acao, a.sub)}`),
      detalhe && el('p', { classe: 'atividade-detalhe' }, detalhe),
      el('small', {}, `${a.guild || a.guildId || 'todos os servidores'} · ${relativo(a.em)}`)));
}

// ---------- Status ao vivo (Visão geral) ----------
let relogioStatus = null;

function estadoDoServidor(s) {
  if (s.pausado) return { tom: 'aviso', texto: 'Pausado' };
  if (s.fila.incertos) return { tom: 'aviso', texto: 'Precisa de atenção' };
  if (s.gamemode.online) return { tom: 'ok', texto: 'Funcionando' };
  return { tom: 'perigo', texto: 'Offline' };
}

function linhaStatus(rotuloLinha, valor, tom = '') {
  return el('div', { classe: `status-linha ${tom}` }, el('dt', {}, rotuloLinha), el('dd', {}, valor));
}

function cartaoDeStatus(s) {
  const estado = estadoDoServidor(s);
  const naFila = s.fila.esperando + s.fila.paraGamemode + s.fila.comGamemode;
  const pausar = dono && el('button', {
    type: 'button', classe: `pequeno ${s.pausado ? '' : 'perigo'}`,
    onclick: async (evento) => {
      const pausado = !s.pausado;
      if (pausado && !confirm(`Pausar a gamemode em ${s.nome || s.guildId}? Nada novo vai para o jogo até retomar.`)) return;
      evento.currentTarget.disabled = true;
      try {
        await post(`/servidores/${s.guildId}/gamemode`, { pausado });
        aviso(pausado ? 'Gamemode pausada.' : 'Gamemode retomada.');
        atualizarStatus();
      } catch (e) { aviso(e.message); evento.currentTarget.disabled = false; }
    }
  }, s.pausado ? '▶ Retomar' : '⏸ Pausar');

  return el('article', { classe: `cartao-status tom-${estado.tom}` },
    el('header', {},
      el('span', { classe: 'farol', 'aria-hidden': 'true' }),
      el('h3', {}, s.nome || 'Servidor sem nome'),
      el('span', { classe: `selo ${estado.tom === 'ok' ? 'ok' : estado.tom === 'perigo' ? 'perigo' : 'neutro'}` }, estado.texto)),
    el('dl', {},
      linhaStatus('Gamemode', !s.gamemode.credenciais ? 'sem credencial'
        : s.pausado ? `pausada · ${s.gamemode.online ? 'online' : 'offline'}`
          : s.gamemode.online ? `● online · ${relativo(s.gamemode.ultimoContatoEm)}`
            : `○ offline${s.gamemode.ultimoContatoEm ? ` · visto ${relativo(s.gamemode.ultimoContatoEm)}` : ''}`,
      s.gamemode.online && !s.pausado ? 'ok' : 'atencao'),
      linhaStatus('Na fila', naFila
        ? [s.fila.esperando && `${s.fila.esperando} esperando envio`, s.fila.paraGamemode && `${s.fila.paraGamemode} para a gamemode buscar`, s.fila.comGamemode && `${s.fila.comGamemode} com a gamemode`].filter(Boolean).join(' · ')
        : 'vazia'),
      s.fila.incertos > 0 && linhaStatus('Incertos', `${s.fila.incertos} sem resposta: resolver no Relatório de punições`, 'atencao'),
      s.modoTeste && linhaStatus('Modo teste', 'ligado: a gamemode só simula', 'atencao'),
      linhaStatus('Resposta (24 h)', !s.resposta ? 'sem pedidos respondidos'
        : [s.resposta.media === null ? 'sem resposta a tempo' : `média ${s.resposta.media} s · máx ${s.resposta.maximo} s`,
          `${s.resposta.respondidos} respondido(s)`, s.resposta.timeouts && `${s.resposta.timeouts} timeout(s)`].filter(Boolean).join(' · '),
      !s.resposta ? '' : s.resposta.timeouts || (s.resposta.media ?? 0) > 60 ? 'atencao' : 'ok'),
      linhaStatus('Última aplicada', s.ultimaAplicada
        ? `${s.ultimaAplicada.alvo ? `${s.ultimaAplicada.alvo} · ` : ''}pela gamemode · ${relativo(s.ultimaAplicada.em)}`
        : 'nenhuma ainda')),
    pausar && el('footer', {}, pausar));
}

async function atualizarStatus() {
  if ($('#aba-geral')?.hidden) return;
  try {
    const { em, servidores } = await api('/status');
    $('#status-servidores').replaceChildren(...(servidores.length
      ? servidores.map(cartaoDeStatus)
      : [el('p', { classe: 'vazio' }, 'Nenhum servidor com a ponte ativa.')]));
    $('#status-atualizado').textContent = `Atualizado ${new Date(em).toLocaleTimeString('pt-BR')} · a cada 15 s`;
  } catch (e) {
    $('#status-atualizado').textContent = `Sem atualizar: ${e.message}`;
  }
}

function ligarStatusAoVivo() {
  clearInterval(relogioStatus);
  atualizarStatus();
  relogioStatus = setInterval(() => {
    if (document.hidden || $('#aba-geral')?.hidden) return;
    atualizarStatus();
  }, 15000);
}

// ---------- Pedidos incertos (aba Pedidos e credenciais) ----------
function cartaoDeIncerto(g) {
  const decidir = async (evento, aplicada) => {
    const pergunta = aplicada
      ? 'Registrar como APLICADA? Confirme no jogo antes: a punição fecha e não vai de novo.'
      : 'Mandar de novo? Confirme no jogo que NÃO foi aplicada, senão o jogador leva duas vezes.';
    if (!confirm(pergunta)) return;
    for (const b of evento.currentTarget.parentElement.querySelectorAll('button')) b.disabled = true;
    try {
      const r = await post(`/gamemode/incertos/${g.punicaoId}`, { aplicada });
      aviso(r.mensagem);
      carregar('gamemode');
    } catch (e) {
      aviso(e.message);
      for (const b of evento.currentTarget.parentElement.querySelectorAll('button')) b.disabled = false;
    }
  };
  return el('article', { classe: 'incerto' },
    el('header', {},
      el('strong', {}, g.guild || g.guildId),
      el('small', {}, [g.acusado && `acusado ${g.acusado}`, g.aceitoPor && `aceita por ${g.aceitoPor}`].filter(Boolean).join(' · '))),
    el('ul', {}, g.alvos.map(a => el('li', {},
      el('span', {}, `${a.nick || 'conta'} ${a.conta ? `· conta ${a.conta}` : ''}`),
      el('span', {}, `${punicaoGm(a)} · ${a.motivo}`),
      el('small', {}, `${a.codigo || 'sem resposta'} · entregue ${relativo(a.entregueEm)}${a.rodada > 1 ? ` · rodada ${a.rodada}` : ''}`)))),
    el('footer', {},
      g.link && el('a', { href: g.link, target: '_blank', rel: 'noopener' }, 'Abrir denúncia'),
      el('div', { classe: 'botoes' },
        el('button', { type: 'button', classe: 'primario', onclick: (e) => decidir(e, true) }, '✅ Foi aplicada'),
        el('button', { type: 'button', onclick: (e) => decidir(e, false) }, '🔁 Tentar novamente'))));
}

const carregadores = {
  async geral() {
    ligarStatusAoVivo();
    const [servidores, atividade, guia] = await Promise.all([
      api('/servidores'), api('/atividade'), api('/gamemode/guia').catch(() => null)
    ]);
    const ativos = servidores.filter(s => s.ativo);
    const gm = guia?.servidores || [];
    const incertos = gm.reduce((soma, s) => soma + s.incertos, 0);
    $('#numeros').replaceChildren(
      numero('Servidores ativos', String(ativos.length), `de ${servidores.length} cadastrado(s)`),
      numero('Gamemodes online', String(gm.filter(s => s.online).length), `de ${gm.filter(s => s.credenciais).length} com credencial`),
      numero('Pedidos incertos', String(incertos), incertos ? 'resolver em Pedidos e credenciais' : 'tudo certo', incertos ? 'tom-alerta' : '')
    );
    $('#servidores-total').textContent = servidores.length ? `${servidores.length} servidor(es)` : '';
    $('#lista-servidores').replaceChildren(...(servidores.length
      ? servidores.map(cartaoDoServidor)
      : [el('p', { classe: 'vazio' }, 'Nenhum servidor com a ponte ativada ainda. Gere um código em Códigos e use /ativar no Discord.')]));
    $('#atividade').replaceChildren(...(atividade.length
      ? atividade.map(itemDeAtividade)
      : [el('li', { classe: 'vazio' }, 'Nada aconteceu ainda.')]));
  },
  async gamemode() {
    const filtro = new URLSearchParams();
    for (const [k, v] of new FormData($('#filtro-pedidos'))) if (v) filtro.set(k, v);
    const [conexoes, pedidos, uso, incertos] = await Promise.all([api('/gamemode/conexoes'), api(`/gamemode/pedidos?${filtro}`), api('/uso?acao=gm'), api('/gamemode/incertos')]);

    $('#gm-incertos-total').textContent = incertos.length ? `${incertos.length} punição(ões)` : '';
    $('#gm-incertos').replaceChildren(...(incertos.length
      ? incertos.map(cartaoDeIncerto)
      : [el('p', { classe: 'vazio' }, 'Nenhum pedido incerto. 👍')]));

    const semIp = conexoes.filter(c => c.status === 'ativa' && !c.ipsPermitidos.length);
    $('#gm-sem-ip').hidden = !semIp.length;
    $('#gm-sem-ip').textContent = semIp.length
      ? `⚠️ ${semIp.length} credencial(is) ativa(s) aceita(m) qualquer IP: ${semIp.map(c => c.nome).join(', ')}. Quando souber os IPs do servidor do jogo, crie uma credencial com ips: e revogue esta.`
      : '';

    $('#gm-conexoes tbody').replaceChildren(...conexoes.map(c => linha(
      [c.guild || c.guildId, c.nome, c.status === 'ativa' ? (c.pausada ? 'pausada' : 'ativa') : 'revogada',
        { texto: c.online ? '● online' : '○ offline', classe: c.online ? 'online' : '' },
        data(c.ultimoContatoEm), c.ultimoIp, c.versaoInclude, c.modoTesteInformado === null ? '—' : c.modoTesteInformado ? 'sim' : 'não',
        { texto: c.ipsPermitidos.length ? c.ipsPermitidos.join(', ') : 'qualquer IP', classe: c.ipsPermitidos.length ? '' : 'atencao' },
        `…${c.ultimos4}`,
        `${c.guildPausada ? 'pausado' : 'ativo'}${c.modoTesteGuild ? ' · teste' : ''}`],
      c.status === 'ativa' && [
        { texto: c.pausada ? 'Retomar' : 'Pausar', perigo: false, confirmar: `${c.pausada ? 'Retomar' : 'Pausar'} a credencial ${c.nome}?`, executar: () => post(`/gamemode/conexoes/${c.id}/pausar`, { pausada: !c.pausada }), recarregar: 'gamemode' },
        { texto: 'Revogar', confirmar: `Revogar a credencial ${c.nome}? A gamemode para de buscar na hora.`, executar: () => post(`/gamemode/conexoes/${c.id}/revogar`), recarregar: 'gamemode' }
      ]
    )));

    $('#gm-pedidos tbody').replaceChildren(...pedidos.map(p => linhaSimples([
      data(p.criadoEm), p.guild || p.guildId, p.conta || p.nick, `${punicaoGm(p)}${p.rodada > 1 ? ` (rodada ${p.rodada})` : ''}`, p.motivo, p.aprovadoPor,
      { texto: `${p.status}${p.teste ? ' · teste' : ''}`, classe: p.status === 'aplicada' ? 'online' : ['incerto', 'erro', 'recusada'].includes(p.status) ? 'atencao' : '' },
      p.codigo, `${p.entregas}${p.devolucoes ? ` (${p.devolucoes} dev.)` : ''}`,
      { texto: [p.resultado?.nome, p.resultado?.organizacao, p.resolvidoPor && `resolvido por ${p.resolvidoPor}`].filter(Boolean).join(' · '), classe: 'detalhes' }
    ])));

    $('#gm-uso tbody').replaceChildren(...uso.map(u => linhaSimples([
      data(u.em), u.guild || u.guildId, u.acao, u.ip, { texto: u.detalhes ? JSON.stringify(u.detalhes) : '', classe: 'detalhes' }
    ])));
  },
  // Aba só do dono: modo teste do bot, pausa e limites de cada servidor.
  async controle() {
    const { servidores } = await api('/gamemode/guia');
    $('#controle-gm-lista').replaceChildren(...(servidores.length
      ? servidores.map(cartaoDeControle)
      : [el('p', { classe: 'vazio' }, 'Nenhum servidor com a ponte ativa.')]));
  },
  async guia() {
    const [{ chaveMestra, versaoInclude, servidores }, chave] = await Promise.all([api('/gamemode/guia'), api('/chave')]);
    $('#chave-situacao').textContent = chave.configurada
      ? `Configurada · impressão ${chave.impressao} · ${chave.credenciais} credencial(is)`
      : 'Não configurada: a API da gamemode responde 503.';
    $('#chave-situacao').className = chave.configurada ? 'online' : 'atencao';
    $('#chave-trocar').textContent = chave.configurada ? 'Trocar chave' : 'Gerar chave';
    $('#guia-versao').textContent = versaoInclude;
    $('#guia-chave').hidden = chaveMestra;
    $('#guia-chave').textContent = chaveMestra ? '' : '⚠️ PONTE_CHAVE_MESTRA não está no .env do bot: a API da gamemode responde 503 e não dá para criar credencial. Comece pelo passo 1.';

    $('#guia-servidores tbody').replaceChildren(...servidores.map(s => linhaSimples([
      s.nome || s.guildId,
      { texto: s.credenciais ? `${s.credenciais} ativa(s)${s.semIp ? ' · qualquer IP' : ''}` : 'nenhuma', classe: s.credenciais ? '' : 'atencao' },
      { texto: s.online ? '● online' : s.ultimoContatoEm ? `○ offline desde ${data(s.ultimoContatoEm)}` : 'nunca conectou', classe: s.online ? 'online' : 'atencao' },
      s.modoTesteBot ? 'ligado' : 'desligado',
      s.modoTesteJogo === null ? '—' : s.modoTesteJogo ? 'ligado' : 'desligado',
      `${s.aplicadas} aplicada(s) · ${s.simuladas} simulada(s)${s.incertos ? ` · ${s.incertos} incerto(s)` : ''}`,
      { texto: proximoPasso(s, chaveMestra), classe: 'detalhes' }
    ])));
  },
  async acessos() {
    const lista = await api('/acessos');
    preencher('acessos', lista.map(a => linha(
      [a.nome || '(nome não encontrado)', a.userId, data(a.adicionadoEm)],
      { texto: 'Apagar', confirmar: `Apagar o acesso de ${a.nome || a.userId} ao painel? A pessoa deixa de entrar na hora.`, executar: () => post(`/acessos/${a.userId}/remover`), recarregar: 'acessos' }
    )));
  },
  async uso(continuar = false) {
    const filtro = new FormData($('#filtro-uso'));
    const params = new URLSearchParams();
    for (const [k, v] of filtro) if (v) params.set(k, v);
    if (continuar && ultimoUso) params.set('antes', ultimoUso);
    const lista = await api(`/uso?${params}`);
    ultimoUso = lista.length ? lista[lista.length - 1].em : ultimoUso;
    const linhas = lista.map(u => linhaSimples([data(u.em), u.guild || u.guildId, `${rotulo(u.acao, u.detalhes?.sub)} (${u.acao})`, u.contaId, u.comando, u.ip,
      { texto: u.detalhes ? JSON.stringify(u.detalhes) : '', classe: 'detalhes' }]));
    const tbody = $('#aba-uso tbody');
    if (continuar) tbody.append(...linhas); else tbody.replaceChildren(...linhas);
    $('#mais-uso').hidden = lista.length < 50;
  },
  async codigos() {
    const lista = await api('/codigos');
    preencher('codigos', lista.map(c => {
      const situacao = c.usadoEm ? 'usado' : c.expirado || (c.expiraEm && new Date(c.expiraEm) < new Date()) ? 'expirado' : 'disponível';
      return linha(
        [`…${c.ultimos4}`, data(c.criadoEm), data(c.expiraEm), data(c.usadoEm), c.guild || c.usadoPorGuild || '—', situacao],
        [
          dono && situacao === 'disponível' && { texto: 'Expirar', confirmar: 'Expirar este código?', executar: () => post(`/codigos/${c.id}/expirar`), recarregar: 'codigos' },
          dono && { texto: 'Apagar', confirmar: `Apagar o código …${c.ultimos4} da lista? Não dá para desfazer${situacao === 'usado' ? ' (o servidor que usou continua ativo)' : ''}.`, executar: () => post(`/codigos/${c.id}/apagar`), recarregar: 'codigos' }
        ]
      );
    }));
  }
};

async function carregar(aba) {
  const secao = $(`#aba-${aba}`);
  secao?.setAttribute('aria-busy', 'true');
  try { aviso(''); await carregadores[aba](); } catch (e) { aviso(e.message); }
  secao?.removeAttribute('aria-busy');
  rotularTabelas(secao || document);
}

function trocarAba(aba) {
  if (!carregadores[aba] || $(`nav [data-aba="${aba}"]`)?.hidden) aba = 'geral';
  for (const botao of document.querySelectorAll('nav button')) {
    const ativa = botao.dataset.aba === aba;
    botao.classList.toggle('ativa', ativa);
    if (ativa) botao.setAttribute('aria-current', 'page'); else botao.removeAttribute('aria-current');
    if (ativa) botao.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  for (const secao of document.querySelectorAll('main section')) secao.hidden = secao.id !== `aba-${aba}`;
  if (location.hash !== `#${aba}`) history.replaceState(null, '', `#${aba}`);
  carregar(aba);
}

// Tema claro ou escuro: o mesmo do site (fica salvo no navegador em "althea-tema").
function alternarTema() {
  const claro = document.documentElement.dataset.tema !== 'claro';
  document.documentElement.dataset.tema = claro ? 'claro' : 'escuro';
  try { localStorage.setItem('althea-tema', claro ? 'claro' : 'escuro'); } catch { /* sem armazenamento: vale só nesta aba */ }
}

async function iniciar() {
  $('#tema').addEventListener('click', alternarTema);
  const selecao = $('#filtro-uso select');
  for (const acao of ACOES) selecao.append(new Option(acao === 'gm' ? 'gm_* (todas da gamemode)' : acao, acao));
  const statusPedido = $('#filtro-pedidos select');
  for (const status of STATUS_PEDIDO) statusPedido.append(new Option(status, status));
  $('#filtro-pedidos').addEventListener('submit', (e) => { e.preventDefault(); carregar('gamemode'); });
  $('#chave-trocar').addEventListener('click', async () => {
    const texto = prompt('A chave nova vale na hora e as credenciais são recifradas. Depois você precisa colar a chave no .env do seu PC antes do próximo pacote.\n\nDigite TROCAR para continuar:');
    if (texto !== 'TROCAR') return;
    try {
      const r = await post('/chave/trocar', { confirmar: 'TROCAR' });
      $('#chave-linha').textContent = `PONTE_CHAVE_MESTRA=${r.chave}`;
      $('#chave-resumo').textContent = [
        `Impressão nova: ${r.impressao}.`,
        `${r.recifradas} credencial(is) recifrada(s).`,
        r.ilegiveis ? `${r.ilegiveis} credencial(is) já estavam ilegíveis e precisam ser renovadas no Discord.` : '',
        r.envGravado ? 'Gravada também no .env da hospedagem.' : 'Não foi possível gravar no .env da hospedagem: ela vale até o bot reiniciar. Coloque no .env e suba o pacote.'
      ].filter(Boolean).join(' ');
      $('#chave-nova').hidden = false;
      aviso('Chave mestra trocada.');
      carregar('guia');
    } catch (e) { aviso(e.message); }
  });
  for (const botao of document.querySelectorAll('nav button')) botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  for (const botao of document.querySelectorAll('[data-aba-link]')) botao.addEventListener('click', () => trocarAba(botao.dataset.abaLink));

  $('#filtro-uso').addEventListener('submit', (e) => { e.preventDefault(); ultimoUso = null; carregar('uso'); });
  $('#mais-uso').addEventListener('click', () => carregadores.uso(true).catch(e => aviso(e.message)));
  $('#gerar-codigo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    try {
      const { codigo } = await post('/codigos', dados);
      $('#codigo-novo').textContent = `${codigo}  (aparece só agora: copie)`;
      carregar('codigos');
    } catch (erro) { aviso(erro.message); }
  });


  try { ({ csrf, dono } = await api('/csrf')); } catch (e) { aviso(e.message); }
  for (const elemento of document.querySelectorAll('.so-dono')) elemento.hidden = !dono;
  $('#papel').textContent = dono ? 'Dono do bot' : 'Acesso liberado';
  $('#papel').classList.add(dono ? 'ok' : 'neutro');
  $('#chave-trocar').hidden = !dono;
  $('#novo-acesso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { userId } = Object.fromEntries(new FormData(e.target));
    try {
      const r = await post('/acessos', { userId: userId.trim() });
      aviso(r.encontrado ? `Acesso liberado para ${r.nome}.` : 'Acesso liberado. O bot não achou o nome dessa conta: confira se o ID está certo.');
      e.target.reset();
      carregar('acessos');
    } catch (erro) { aviso(erro.message); }
  });
  trocarAba(location.hash.slice(1) || 'geral');
}

iniciar();
