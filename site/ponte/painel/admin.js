// Painel do dono. Tudo é montado com textContent (nada de HTML vindo da API).
const ACOES = ['fila', 'editar', 'executar', 'aplicar', 'cancelar', 'auth_falhou', 'hwid_diferente', 'guild_inativa', 'ping', 'codigo_negado', 'retirar', 'remover', 'limpar', 'regras', 'nota', 'relatorio', 'ativar', 'apagar',
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
  fila: 'abriu a fila', editar: 'editou uma punição', executar: 'começou a aplicar', aplicar: 'aplicou uma punição',
  cancelar: 'cancelou uma aplicação', auth_falhou: 'errou a autenticação', hwid_diferente: 'usou o token em outro PC',
  guild_inativa: 'tentou usar com a ponte desativada', ping: 'deu sinal de vida', codigo_negado: 'tentou gerar código sem permissão',
  retirar: 'retirou uma punição', remover: 'tirou uma punição da fila', limpar: 'limpou a fila', regras: 'mudou a tabela de motivos',
  nota: 'anotou numa punição', relatorio: 'abriu o relatório', ativar: 'ativou a ponte', apagar: 'apagou um registro',
  gm_busca: 'buscou pedidos', gm_resultado: 'respondeu um pedido', gm_auth_falhou: 'errou a autenticação da gamemode',
  gm_selo_invalido: 'recusou um selo (alerta)', gm_enviar: 'enviou uma punição ao jogo', gm_cancelar: 'cancelou um envio ao jogo',
  gm_incerto_ok: 'confirmou um incerto como aplicado', gm_incerto_reenviar: 'reenviou um incerto', gm_credencial: 'mexeu numa credencial',
  gm_config: 'mudou a configuração da gamemode'
};
const SUBROTULOS = {
  criar: 'criou uma credencial da gamemode', revogar: 'revogou uma credencial da gamemode', renovar: 'renovou uma credencial da gamemode',
  chave_mestra: 'trocou a chave mestra', pausar: 'pausou a gamemode', retomar: 'retomou a gamemode', executor: 'trocou quem aplica as punições',
  limites: 'mudou os limites da gamemode', acesso_admin_adicionar: 'liberou alguém no painel', acesso_admin_remover: 'tirou o acesso de alguém ao painel',
  apagar_pc: 'apagou um PC', apagar_codigo: 'apagou um código de ativação'
};
const rotulo = (acao, subacao) => SUBROTULOS[subacao] || ROTULOS[acao] || acao;
const ICONE_AUTOR = { pc: '🖥️', gamemode: '🎮', pessoa: '👤' };

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
const put = (caminho, corpo = {}) => api(caminho, { method: 'PUT', body: JSON.stringify(corpo) });

// Linha editável da tabela de motivos.
function linhaMotivo(m = { nome: '', sinonimos: [], cmd: 'ban', tempo: 1, avisos: 1 }) {
  const tr = document.createElement('tr');
  const campo = (tipo, valor, attrs = {}) => {
    const td = document.createElement('td');
    const el = document.createElement('input');
    el.type = tipo;
    el.value = valor;
    Object.assign(el, attrs);
    td.append(el);
    tr.append(td);
    return el;
  };
  campo('text', m.nome, { maxLength: 30 }).dataset.campo = 'nome';
  campo('text', m.sinonimos.join(', ')).dataset.campo = 'sinonimos';
  const tdTipo = document.createElement('td');
  const tipo = document.createElement('select');
  tipo.dataset.campo = 'cmd';
  tipo.append(new Option('Tempban (dias)', 'ban'), new Option('Cadeia (minutos)', 'cadeia'));
  tipo.value = m.cmd;
  tdTipo.append(tipo);
  tr.append(tdTipo);
  campo('number', m.tempo, { min: 0, max: 99999 }).dataset.campo = 'tempo';
  campo('number', m.avisos, { min: 0, max: 10 }).dataset.campo = 'avisos';
  const tdApagar = document.createElement('td');
  const apagar = document.createElement('button');
  apagar.type = 'button';
  apagar.className = 'perigo';
  apagar.textContent = 'Apagar';
  apagar.addEventListener('click', () => tr.remove());
  tdApagar.append(apagar);
  tr.append(tdApagar);
  return tr;
}

function lerMotivos() {
  return [...document.querySelectorAll('#aba-motivos tbody tr')].map(tr => {
    const v = (campo) => tr.querySelector(`[data-campo="${campo}"]`).value;
    return {
      nome: v('nome').trim(),
      sinonimos: v('sinonimos').split(',').map(s => s.trim()).filter(Boolean),
      cmd: v('cmd'),
      tempo: Number(v('tempo')),
      avisos: Number(v('avisos'))
    };
  }).filter(m => m.nome);
}

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

function preencher(secao, linhas) {
  const tbody = $(`#aba-${secao} tbody`);
  tbody.replaceChildren(...linhas);
}

// O que falta para o servidor aplicar pela gamemode, na ordem do guia.
function proximoPasso(s, chaveMestra) {
  if (!chaveMestra) return 'Passo 1: colocar PONTE_CHAVE_MESTRA no .env e reiniciar o bot.';
  if (s.executor === 'pc') return 'Passo 1: /ponte gamemode executor tipo: Gamemode.';
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
      el('span', { classe: `selo ${s.ativo ? 'ok' : 'off'}` }, s.ativo ? 'Ativo' : 'Desativado'),
      el('span', { classe: 'selo' }, { pc: 'PC', gamemode: 'Gamemode', ambos: 'PC + gamemode' }[s.executor] || s.executor)),
    el('dl', {},
      el('div', {}, el('dt', {}, 'Ativado por'), el('dd', {}, ativador ? `${ativador} · ${relativo(s.ativadoEm)}` : relativo(s.ativadoEm))),
      el('div', {}, el('dt', {}, 'Último uso'), el('dd', {}, s.ultimoUso
        ? [quem?.nome && el('strong', {}, `${ICONE_AUTOR[quem.tipo] || ''} ${quem.nome} `), rotulo(s.ultimoUso.acao), el('small', {}, ` · ${relativo(s.ultimoUso.em)}`)]
        : 'ninguém usou ainda')),
      el('div', {}, el('dt', {}, 'PCs ativos'), el('dd', {}, `${s.pcs} de ${s.limitePcs}`))),
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

const carregadores = {
  async geral() {
    const [servidores, atividade, instalacoes, guia] = await Promise.all([
      api('/servidores'), api('/atividade'), api('/instalacoes'), api('/gamemode/guia').catch(() => null)
    ]);
    const ativos = servidores.filter(s => s.ativo);
    const pcsAtivos = instalacoes.filter(i => i.status === 'ativa');
    const gm = guia?.servidores || [];
    const incertos = gm.reduce((soma, s) => soma + s.incertos, 0);
    $('#numeros').replaceChildren(
      numero('Servidores ativos', String(ativos.length), `de ${servidores.length} cadastrado(s)`),
      numero('PCs online', String(pcsAtivos.filter(i => i.online).length), `de ${pcsAtivos.length} ativo(s)`),
      numero('Gamemodes online', String(gm.filter(s => s.online).length), `de ${gm.filter(s => s.credenciais).length} com credencial`),
      numero('Pedidos incertos', String(incertos), incertos ? 'resolver no Log Admin' : 'tudo certo', incertos ? 'tom-alerta' : '')
    );
    $('#servidores-total').textContent = servidores.length ? `${servidores.length} servidor(es)` : '';
    $('#lista-servidores').replaceChildren(...(servidores.length
      ? servidores.map(cartaoDoServidor)
      : [el('p', { classe: 'vazio' }, 'Nenhum servidor com a ponte ativada ainda. Gere um código em Códigos e use /ativar no Discord.')]));
    $('#atividade').replaceChildren(...(atividade.length
      ? atividade.map(itemDeAtividade)
      : [el('li', { classe: 'vazio' }, 'Nada aconteceu ainda.')]));
  },
  async instalacoes() {
    const lista = await api('/instalacoes');
    preencher('instalacoes', lista.map(i => linha(
      [i.nome, i.guild || i.guildId, i.status, i.criadoPor, data(i.ultimoUsoEm), i.ultimoIp, i.hwid, `…${i.ultimos4}`,
        { texto: i.online ? '● online' : '○ offline', classe: i.online ? 'online' : '' }],
      [
        i.status === 'ativa' && { texto: 'Revogar', confirmar: `Revogar o PC ${i.nome}?`, executar: () => post(`/instalacoes/${i.id}/revogar`), recarregar: 'instalacoes' },
        dono && { texto: 'Apagar', confirmar: `Apagar o PC ${i.nome} de vez? Ele some da lista${i.status === 'ativa' ? ' e o token para de funcionar na hora' : ''}. Não dá para desfazer.`, executar: () => post(`/instalacoes/${i.id}/apagar`), recarregar: 'instalacoes' }
      ]
    )));
  },
  async gamemode() {
    const filtro = new URLSearchParams();
    for (const [k, v] of new FormData($('#filtro-pedidos'))) if (v) filtro.set(k, v);
    const [conexoes, pedidos, uso] = await Promise.all([api('/gamemode/conexoes'), api(`/gamemode/pedidos?${filtro}`), api('/uso?acao=gm')]);

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
        `${c.executor}${c.guildPausada ? ' (pausado)' : ''}${c.modoTesteGuild ? ' · teste' : ''}`],
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
      { texto: s.executor, classe: s.executor === 'pc' ? 'atencao' : '' },
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
  async motivos() {
    const { tabela, propria } = await api('/motivos');
    $('#motivos-situacao').textContent = propria ? 'Tabela personalizada.' : 'Usando a tabela padrão.';
    $('#aba-motivos tbody').replaceChildren(...tabela.map(linhaMotivo));
  },
  async codigos() {
    const lista = await api('/codigos');
    preencher('codigos', lista.map(c => {
      const situacao = c.usadoEm ? 'usado' : c.expirado || (c.expiraEm && new Date(c.expiraEm) < new Date()) ? 'expirado' : 'disponível';
      return linha(
        [`…${c.ultimos4}`, data(c.criadoEm), data(c.expiraEm), c.limitePcs || 'padrão', data(c.usadoEm), c.guild || c.usadoPorGuild || '—', situacao],
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

async function iniciar() {
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

  $('#motivo-novo').addEventListener('click', () => $('#aba-motivos tbody').append(linhaMotivo()));
  $('#motivos-salvar').addEventListener('click', async () => {
    const tabela = lerMotivos();
    if (!tabela.length) return aviso('A tabela não pode ficar vazia (use Restaurar padrão).');
    try { const r = await put('/motivos', { tabela }); aviso(`Motivos salvos (${r.total}).`); carregar('motivos'); } catch (e) { aviso(e.message); }
  });
  $('#motivos-padrao').addEventListener('click', async () => {
    if (!confirm('Voltar para a tabela padrão? As mudanças feitas serão perdidas.')) return;
    try { await put('/motivos', { tabela: [] }); aviso('Tabela padrão restaurada.'); carregar('motivos'); } catch (e) { aviso(e.message); }
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
