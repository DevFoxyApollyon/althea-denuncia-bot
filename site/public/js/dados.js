// Carregamento das listas, do caso aberto e das demais telas; tempo real.
import { conversaNoFim, rolarConversaParaOFim } from './acoes.js';
import { carregarAvisos } from './avisos.js';
import { carregarChat, carregarNovasDoChat } from './chat.js';
import { carregarTeste, carregarTesteAdmin, carregarTestesPendentes } from './teste.js';
import { carregarPainelDoBot } from './bot.js';
import { carregarMotivosPonte } from './motivos.js';
import { carregarLogins, carregarMetas, carregarSaude } from './gestao.js';
import { carregarRascunhoDaConta } from './nova.js';
import { carregarSessoes } from './sessoes.js';
import { carregarConfigDoSite } from './config.js';
import { desenhar } from './desenho.js';
import { CHAVE_AREA, CHAVE_SERVIDOR, FILTROS, INTERVALO_ATUALIZACAO_MS, VISTAS, estado, raiz } from './estado.js';
import { lerVistos, marcarVisto, temNovidade } from './novidades.js';
import { ir, rotaAtual } from './rotas.js';
import { salvarPreferencia } from './tema.js';
import { api, areaDaEquipe, avisar, numeroDoCaso, papeisAtuais } from './util.js';

export let recargaPendente = null;
export let fluxo = null;
export let temporizador = null;
// Casos de uma vista. "Minhas" (jogador) e "Meus atendimentos" (staff) vêm
// da mesma consulta e são separados aqui.
// Na área da staff, digitar na busca procura no servidor inteiro, não só na
// lista aberta (fila ou meus atendimentos).
export const buscandoNoServidor = () => estado.area === 'staff' && Boolean(estado.busca.trim());

export function casosDaVista(vista = estado.vista) {
  if (vista === estado.vista && buscandoNoServidor()) return estado.listas.busca;
  const lista = estado.listas[VISTAS[vista].escopo];
  if (vista === 'minhas') return lista.filter(denuncia => denuncia.relacao !== 'staff');
  if (vista === 'atendimentos') return lista.filter(denuncia => denuncia.claimedBy === estado.usuario.id);
  return lista;
}

export function casosVisiveis() {
  const termo = estado.busca.trim().toLowerCase();
  const status = FILTROS[estado.filtro].status;
  const vistos = lerVistos();
  // Na lista do responsável a busca e os filtros são feitos no servidor, em
  // todas as denúncias; aqui só sobra o filtro de novidades.
  const noServidor = estado.vista === 'admin';
  const casos = casosDaVista().filter(denuncia => {
    if (noServidor) return !estado.soNovidades || temNovidade(denuncia, vistos);
    // A busca da staff já veio filtrada pelo texto; status e plataforma continuam valendo aqui.
    if (buscandoNoServidor()) {
      return (!status || status.includes(denuncia.status))
        && (estado.plataforma === 'todas' || denuncia.platform === estado.plataforma)
        && (estado.categoria === 'todas' || denuncia.categoria === estado.categoria);
    }
    if (status && !status.includes(denuncia.status)) return false;
    if (estado.plataforma !== 'todas' && denuncia.platform !== estado.plataforma) return false;
    if (estado.categoria !== 'todas' && denuncia.categoria !== estado.categoria) return false;
    if (estado.soNovidades && !temNovidade(denuncia, vistos)) return false;
    if (!termo) return true;
    return [denuncia.acusado, denuncia.denunciante, denuncia.motivo, denuncia.categoria, denuncia.guildNome, numeroDoCaso(denuncia.id)]
      .some(campo => String(campo || '').toLowerCase().includes(termo));
  });

  if (estado.ordem === 'padrao' || noServidor) return casos;
  const sinal = estado.ordem === 'antigas' ? 1 : -1;
  return [...casos].sort((a, b) => sinal * (new Date(a.dataCriacao) - new Date(b.dataCriacao)));
}

// Mudou a busca ou um filtro: na lista do responsável volta para a página 1 e
// pede de novo ao servidor (com uma pausa curta enquanto a pessoa digita).
let esperaDaBusca = null;
const pedidos = {};
export function filtrarLista({ digitando = false } = {}) {
  if (estado.area === 'staff' && digitando) {
    clearTimeout(esperaDaBusca);
    desenhar();
    if (!buscandoNoServidor()) return;
    esperaDaBusca = setTimeout(carregarBuscaDaStaff, 350);
    return;
  }
  if (estado.vista !== 'admin') return desenhar();
  estado.paginaAdmin = 1;
  clearTimeout(esperaDaBusca);
  if (!digitando) return carregarLista('admin');
  desenhar();
  esperaDaBusca = setTimeout(() => carregarLista('admin'), 350);
}

async function carregarBuscaDaStaff() {
  const termo = estado.busca.trim();
  if (!termo || !estado.guildId) return;
  const pedido = pedidos.busca = (pedidos.busca || 0) + 1;
  estado.carregando.busca = true;
  desenhar();
  try {
    const resultado = await api(`/api/denuncias?${new URLSearchParams({ guildId: estado.guildId, escopo: 'busca', busca: termo })}`);
    if (pedido !== pedidos.busca) return;
    estado.listas.busca = resultado.denuncias;
    estado.totalDaBusca = resultado.total || resultado.denuncias.length;
  } catch (erro) {
    if (pedido !== pedidos.busca) return;
    estado.listas.busca = [];
    estado.totalDaBusca = 0;
    avisar('erro', erro.message);
  }
  estado.carregando.busca = false;
  desenhar();
}

export async function carregarLista(escopo) {
  if (!estado.guildId) return;
  estado.carregando[escopo] = true;
  desenhar();
  // Só a resposta do pedido mais recente vale: as antigas chegam fora de ordem.
  const pedido = pedidos[escopo] = (pedidos[escopo] || 0) + 1;
  try {
    const parametros = new URLSearchParams({ guildId: estado.guildId, escopo });
    if (escopo === 'admin') {
      parametros.set('pagina', String(estado.paginaAdmin));
      if (estado.busca.trim()) parametros.set('busca', estado.busca.trim());
      if (estado.filtro !== 'todos') parametros.set('status', estado.filtro);
      if (estado.plataforma !== 'todas') parametros.set('plataforma', estado.plataforma);
      if (estado.categoria !== 'todas') parametros.set('categoria', estado.categoria);
      if (estado.ordem === 'antigas') parametros.set('ordem', 'antigas');
    }
    const resultado = await api(`/api/denuncias?${parametros}`);
    if (pedido !== pedidos[escopo]) return;
    estado.listas[escopo] = resultado.denuncias;
    if (escopo === 'admin') {
      estado.paginaAdmin = resultado.pagina || 1;
      estado.totalPaginasAdmin = resultado.totalPaginas || 1;
      estado.totalAdmin = resultado.total || resultado.denuncias.length;
    }
  } catch (erro) {
    if (pedido !== pedidos[escopo]) return;
    estado.listas[escopo] = [];
    avisar('erro', erro.message);
  }
  estado.carregando[escopo] = false;
  desenhar();
}

// Carrega o que a área atual mostra: a staff precisa da fila e dos próprios casos.
export function carregarArea() {
  const escopos = areaDaEquipe()
    ? ['fila', 'minhas', ...(estado.visaoAdmin ? ['admin'] : [])]
    : ['minhas'];
  carregarNovasDoChat();
  carregarAvisos();
  if (papeisAtuais().staff) carregarTestesPendentes();
  ouvirListas();
  return Promise.all(escopos.map(carregarLista));
}

export function escopoDoDetalhe() {
  if (!areaDaEquipe()) return 'minhas';
  return estado.vista === 'admin' ? 'admin' : 'fila';
}

export async function carregarDetalhe(id, { silencioso = false } = {}) {
  try {
    const parametros = new URLSearchParams({ escopo: escopoDoDetalhe() });
    const dados = await api(`/api/denuncias/${encodeURIComponent(id)}?${parametros}`);
    if (rotaAtual().id !== id) return;
    estado.detalhe = dados;
    marcarVisto(id);
  } catch (erro) {
    if (silencioso) return;
    estado.detalhe = null;
    avisar('erro', erro.message);
  }
  desenhar();
}

// Tempo real: o servidor avisa quando o caso muda e o site recarrega na hora.
// A verificação periódica continua como reserva, caso a conexão caia.
export function conectarEventos(id) {
  desconectarEventos();
  if (!('EventSource' in window)) return;

  fluxo = new EventSource(`/api/denuncias/${encodeURIComponent(id)}/eventos?escopo=${escopoDoDetalhe()}`);
  fluxo.addEventListener('mudou', () => {
    clearTimeout(recargaPendente);
    recargaPendente = setTimeout(() => {
      if (rotaAtual().id !== id || estado.aceitando) return;
      const noFim = conversaNoFim();
      carregarDetalhe(id, { silencioso: true }).then(() => { if (noFim) rolarConversaParaOFim(); });
    }, 500);
  });
  fluxo.addEventListener('presenca', (evento) => {
    try { estado.presenca = JSON.parse(evento.data).nomes || []; } catch { estado.presenca = []; }
    if (!estado.aceitando && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) desenhar();
  });
}

// Tempo real do chat: recarrega as mensagens quando o servidor avisa.
export function conectarChat() {
  if (!('EventSource' in window)) return;
  fluxo = new EventSource(`/api/chat/eventos?${new URLSearchParams({ guildId: estado.guildId })}`);
  fluxo.addEventListener('mudou', () => {
    if (rotaAtual().tipo === 'chat') carregarChat({ silencioso: true });
  });
}

export function desconectarEventos() {
  clearTimeout(recargaPendente);
  fluxo?.close();
  fluxo = null;
  estado.presenca = [];
}

// Tempo real das listas: quando uma denúncia do servidor muda (no Discord ou
// no site), a fila e as outras listas se atualizam sozinhas.
let fluxoDasListas = null;
let servidorOuvido = null;

export function ouvirListas() {
  if (!('EventSource' in window) || servidorOuvido === estado.guildId) return;
  fluxoDasListas?.close();
  servidorOuvido = estado.guildId;
  fluxoDasListas = new EventSource(`/api/eventos?${new URLSearchParams({ guildId: estado.guildId })}`);
  fluxoDasListas.addEventListener('lista', () => {
    const tipo = rotaAtual().tipo;
    const digitando = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (document.hidden || digitando || document.querySelector('dialog[open]')) return;
    if (tipo === 'inicio') carregarArea();
    else if (tipo === 'identificar') carregarNaoIdentificadas();
  });
  fluxoDasListas.addEventListener('acesso', () => atualizarAcesso());
}

// Os cargos ou o apelido mudaram no Discord: busca de novo o que a pessoa pode
// fazer e ajusta a tela, sem recarregar a página.
let conferindoAcesso = false;
export async function atualizarAcesso() {
  if (conferindoAcesso) return;
  conferindoAcesso = true;
  try {
    const dados = await api('/api/eu');
    const antes = JSON.stringify(papeisAtuais());
    estado.usuario = dados.usuario;
    estado.servidores = dados.servidores;
    estado.visaoAdmin = dados.visaoAdmin;
    estado.painelPonte = dados.painelPonte === true;

    // Saiu (ou foi removido) do servidor que estava aberto: recomeça do zero.
    if (!dados.servidores.some(servidor => servidor.id === estado.guildId)) return location.reload();

    const papeis = papeisAtuais();
    if (JSON.stringify(papeis) === antes) return desenhar();

    // Estava numa área que não pode mais ver: volta para a que ainda pode.
    const semAcesso = (estado.area === 'admin' && !papeis.responsavel) || (estado.area === 'staff' && !papeis.staff);
    if (semAcesso) {
      await abrirArea(papeis.staff ? 'staff' : 'jogador');
      // Depois da troca de tela, que limpa os avisos.
      setTimeout(() => avisar('erro', 'Seus cargos mudaram no Discord. Esta área não está mais disponível para você.'), 300);
    } else {
      avisar('ok', 'Seus cargos mudaram no Discord. O site foi atualizado.');
      desenhar();
      carregarArea();
    }
  } catch (erro) {
    // Sessão encerrada ou sem acesso a nenhum servidor: a tela de entrada resolve.
    if (erro.status === 401 || erro.status === 403) location.reload();
  } finally {
    conferindoAcesso = false;
  }
}

export function agendarAtualizacao() {
  clearInterval(temporizador);
  temporizador = setInterval(() => {
    const rota = rotaAtual();
    const digitando = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const dialogoAberto = Boolean(document.querySelector('dialog[open]'));
    if (document.hidden || digitando || dialogoAberto || estado.aceitando || estado.arquivos.length) return;
    if (rota.tipo === 'detalhe') carregarDetalhe(rota.id, { silencioso: true });
    else if (rota.tipo === 'inicio') carregarArea();
    else if (rota.tipo === 'chat') carregarChat({ silencioso: true });
    else {
      carregarNovasDoChat();
      carregarAvisos();
    }
  }, INTERVALO_ATUALIZACAO_MS * 3);
}

export async function aoMudarRota() {
  const rota = rotaAtual();
  estado.aviso = null;
  estado.arquivos = [];
  estado.rascunho = '';
  estado.nota = '';
  estado.notaAvaliacao = null;
  estado.comentarioAvaliacao = '';
  estado.aceitando = false;
  desconectarEventos();

  if (rota.tipo === 'detalhe') {
    if (estado.detalhe?.denuncia.id !== rota.id) estado.detalhe = null;
    desenhar();
    await carregarDetalhe(rota.id);
    if (rotaAtual().id === rota.id && estado.detalhe) conectarEventos(rota.id);
  } else {
    estado.detalhe = null;
    desenhar();
    if (rota.tipo === 'ranking') carregarRanking();
    if (rota.tipo === 'numeros') carregarNumeros();
    if (rota.tipo === 'sugestoes') carregarSugestoes();
    if (rota.tipo === 'geral') carregarGeral();
    if (rota.tipo === 'identificar') carregarNaoIdentificadas();
    if (rota.tipo === 'config') carregarConfigDoSite();
    if (rota.tipo === 'bot') carregarPainelDoBot();
    if (rota.tipo === 'motivos') carregarMotivosPonte();
    if (rota.tipo === 'saude') carregarSaude();
    if (rota.tipo === 'logins') carregarLogins();
    if (rota.tipo === 'metas') carregarMetas();
    if (rota.tipo === 'sessoes') carregarSessoes();
    if (rota.tipo === 'nova') carregarRascunhoDaConta();
    if (rota.tipo === 'jogador') carregarJogador(rota.id);
    if (rota.tipo === 'avisos') carregarAvisos();
    if (rota.tipo === 'teste') carregarTeste(rota.id);
    if (rota.tipo === 'teste-admin') carregarTesteAdmin(rota.id);
    if (rota.tipo === 'chat') {
      estado.chat = null;
      estado.arquivoChat = null;
      estado.respostaChat = null;
      estado.reagindoChat = null;
      estado.sinalizadasChat = null;
      carregarChat();
      conectarChat();
    }
    if (rota.tipo === 'auditoria') carregarAuditoria();
  }
  raiz.querySelector('.principal')?.scrollTo?.(0, 0);
}

export const buscar = (caminho, parametros) => api(`${caminho}?${new URLSearchParams({ guildId: estado.guildId, ...parametros })}`);

export async function carregarNaoIdentificadas() {
  try {
    estado.naoIdentificadas = await buscar('/api/nao-identificadas', {});
  } catch (erro) {
    estado.naoIdentificadas = { denuncias: [], minhaConta: null };
    avisar('erro', erro.message);
  }
  desenhar();
}


// Perfil de um jogador pelo ID da conta do jogo (só staff).
export async function carregarJogador(conta) {
  estado.jogador = null;
  if (!conta) return;
  try {
    const perfil = await buscar(`/api/jogadores/${encodeURIComponent(conta)}`, {});
    if (rotaAtual().id !== conta) return;
    estado.jogador = perfil;
  } catch (erro) {
    avisar('erro', erro.message);
  }
  desenhar();
}

export async function carregarAuditoria() {
  try {
    estado.auditoria = await buscar('/api/auditoria', {});
  } catch (erro) {
    estado.auditoria = { acoes: [], pessoas: {} };
    avisar('erro', erro.message);
  }
  desenhar();
}

// A visão geral junta o que já existe nas outras telas; se uma parte falhar,
// as demais aparecem mesmo assim.
export async function carregarGeral() {
  const [numeros, ranking, sugestoes, auditoria] = await Promise.all([
    buscar('/api/numeros', { dias: '30' }).catch(() => null),
    buscar('/api/ranking', { periodo: 'mes' }).catch(() => null),
    buscar('/api/sugestoes', { escopo: 'staff' }).catch(() => null),
    buscar('/api/auditoria', {}).catch(() => null)
  ]);
  estado.geral = { numeros, ranking, sugestoes, auditoria };
  desenhar();
}

export async function carregarSugestoes() {
  try {
    const parametros = new URLSearchParams({ guildId: estado.guildId, escopo: estado.area === 'admin' ? 'staff' : 'minhas' });
    estado.sugestoes = await api(`/api/sugestoes?${parametros}`);
  } catch (erro) {
    estado.sugestoes = { sugestoes: [], pessoas: {} };
    avisar('erro', erro.message);
  }
  desenhar();
}



export async function carregarNumeros() {
  try {
    const parametros = new URLSearchParams({ guildId: estado.guildId, dias: String(estado.diasNumeros) });
    estado.numeros = await api(`/api/numeros?${parametros}`);
  } catch (erro) {
    estado.numeros = { total: 0, porDia: [], porCategoria: [], porStatus: {} };
    avisar('erro', erro.message);
  }
  desenhar();
}


export async function carregarRanking() {
  try {
    const parametros = new URLSearchParams({ guildId: estado.guildId, periodo: estado.periodoRanking });
    estado.ranking = await api(`/api/ranking?${parametros}`);
  } catch (erro) {
    estado.ranking = { staff: [] };
    avisar('erro', erro.message);
  }
  desenhar();
}

export function abrirVista(vista) {
  estado.vista = vista;
  estado.area = VISTAS[vista].area;
  estado.filtro = 'todos';
  estado.busca = '';
  estado.plataforma = 'todas';
  estado.categoria = 'todas';
  estado.ordem = 'padrao';
  estado.soNovidades = false;
  estado.paginaAdmin = 1;
  salvarPreferencia(CHAVE_AREA, estado.area);
  ir('#/');
  return carregarArea();
}

// Troca de servidor: limpa o que era do anterior e abre o painel da pessoa
// nele. A escolha fica guardada para a próxima visita.
export function entrarNoServidor(guildId) {
  estado.guildId = guildId;
  estado.listas = { minhas: [], fila: [], admin: [], busca: [] };
  estado.saude = null;
  estado.topicos = null;
  estado.logins = null;
  estado.metas = null;
  estado.chat = null;
  estado.canalChat = 'geral';
  estado.jogador = null;
  estado.configSite = null;
  estado.painelBot = null;
  salvarPreferencia(CHAVE_SERVIDOR, guildId);
  const papeis = estado.servidores.find(servidor => servidor.id === guildId)?.papeis || {};
  // Mantém a área em que a pessoa estava, se ela também existe nesse servidor.
  const area = estado.area === 'admin' && papeis.responsavel ? 'admin' : papeis.staff && estado.area !== 'jogador' ? 'staff' : 'jogador';
  return abrirArea(area);
}

export function abrirArea(area) {
  estado.sugestoes = null;
  if (area !== 'admin') return abrirVista(area === 'staff' ? 'fila' : 'minhas');

  // O painel do responsável abre na visão geral, não numa lista.
  estado.area = 'admin';
  estado.vista = 'admin';
  salvarPreferencia(CHAVE_AREA, 'admin');
  ir('#/geral');
  return carregarArea();
}
