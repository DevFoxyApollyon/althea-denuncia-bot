// Monta a tela e inicia o site.
import { telaIdentificar } from './abertas.js';
import { faixaDeAvisos, telaAvisos } from './avisos.js';
import { telaPainelDoBot } from './bot.js';
import { telaLogins, telaMetas, telaSaude } from './gestao.js';
import { telaDetalhe } from './caso.js';
import { telaChat } from './chat.js';
import { telaConfig } from './config.js';
import { agendarAtualizacao, aoMudarRota, carregarArea } from './dados.js';
import { telaEntrada } from './entrada.js';
import { telaHome } from './home.js';
import { CHAVE_AREA, CHAVE_SERVIDOR, CHAVE_TEMA, estado, raiz } from './estado.js';
import { barraSuperior, menuLateral } from './navegacao.js';
import { telaJogador } from './jogador.js';
import { telaNova } from './nova.js';
import { telaNumeros } from './numeros.js';
import { telaPainel } from './painel.js';
import { iniciarPush } from './push.js';
import { telaRanking } from './ranking.js';
import { telaAuditoria, telaVisaoGeral } from './responsavel.js';
import { rotaAtual } from './rotas.js';
import { telaSugestoes } from './sugestoes.js';
import { telaTeste, telaTesteAdmin } from './teste.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';
import { api, avisar, el, nomeDoSite, papeisAtuais } from './util.js';

// Aviso de cookies: o site só usa os essenciais, então basta informar uma vez.
function avisoDeCookies() {
  if (lerPreferencia('althea-cookies')) return null;
  return el('div', { class: 'aviso-cookies', role: 'region', 'aria-label': 'Aviso sobre cookies' },
    el('p', null, 'Este site usa só os cookies necessários para manter você conectado. Não há publicidade nem rastreamento. ',
      el('a', { href: '/cookies.html' }, 'Política de cookies'), ' e ', el('a', { href: '/privacidade.html' }, 'de privacidade'), '.'),
    el('button', {
      class: 'primario',
      type: 'button',
      onclick: () => {
        salvarPreferencia('althea-cookies', '1');
        desenhar();
      }
    }, 'Entendi'));
}

export function desenhar() {
  // Preserva o foco, o cursor e a rolagem do que estava na tela.
  const ativo = document.activeElement;
  const foco = ativo?.id;
  const cursor = ativo?.selectionStart;
  const rolagens = ['.principal', '.conversa'].map(seletor => [seletor, raiz.querySelector(seletor)?.scrollTop]);
  const casoAnterior = raiz.querySelector('.caso')?.dataset.id;

  let conteudo;
  if (!estado.usuario) {
    conteudo = telaEntrada();
  } else if (!estado.servidores.length) {
    conteudo = el('div', { class: 'aplicativo sem-menu' }, barraSuperior(), el('main', { class: 'principal' },
      el('div', { class: 'vazio alto' },
        el('h3', null, 'Nenhum servidor encontrado'),
        el('p', null, 'Sua conta não está em nenhum servidor onde o sistema de denúncias está configurado.'))));
  } else {
    const rota = rotaAtual();
    const principal = rota.tipo === 'detalhe' ? telaDetalhe()
      : rota.tipo === 'nova' ? telaNova()
        : rota.tipo === 'ranking' && papeisAtuais().staff ? telaRanking()
          : rota.tipo === 'numeros' && papeisAtuais().responsavel ? telaNumeros()
            : rota.tipo === 'sugestoes' ? telaSugestoes()
              : rota.tipo === 'identificar' ? telaIdentificar()
              : rota.tipo === 'chat' ? telaChat()
              : rota.tipo === 'home' ? telaHome()
              : rota.tipo === 'teste' && papeisAtuais().staff ? telaTeste()
              : rota.tipo === 'teste-admin' && papeisAtuais().responsavel ? telaTesteAdmin()
              : rota.tipo === 'avisos' && papeisAtuais().responsavel ? telaAvisos()
              : rota.tipo === 'jogador' && papeisAtuais().staff ? telaJogador()
              : rota.tipo === 'config' && papeisAtuais().responsavel ? telaConfig()
              : rota.tipo === 'bot' && papeisAtuais().responsavel ? telaPainelDoBot()
              : rota.tipo === 'saude' && papeisAtuais().responsavel ? telaSaude()
              : rota.tipo === 'logins' && papeisAtuais().responsavel ? telaLogins()
              : rota.tipo === 'metas' && papeisAtuais().responsavel ? telaMetas()
              : rota.tipo === 'geral' && papeisAtuais().responsavel ? telaVisaoGeral()
                : rota.tipo === 'auditoria' && papeisAtuais().responsavel ? telaAuditoria() : telaPainel();
    const faixa = rota.tipo !== 'avisos' && faixaDeAvisos();
    if (faixa) principal.prepend(faixa);
    conteudo = el('div', { class: `aplicativo rota-${rota.tipo} area-${rota.tipo === 'home' ? 'neutra' : estado.area}` }, barraSuperior(), menuLateral(), principal);
  }

  document.title = `${estado.usuario ? nomeDoSite() : estado.site.nome} - Denúncias`;
  raiz.className = '';
  raiz.replaceChildren(...[conteudo, avisoDeCookies()].filter(Boolean));

  const caso = raiz.querySelector('.caso');
  if (caso && estado.detalhe) caso.dataset.id = estado.detalhe.denuncia.id;

  for (const [seletor, topo] of rolagens) {
    const alvo = raiz.querySelector(seletor);
    if (!alvo) continue;
    // Ao abrir um caso, a conversa começa no fim; depois, fica onde estava.
    if (seletor === '.conversa' && caso?.dataset.id !== casoAnterior) alvo.scrollTop = alvo.scrollHeight;
    else if (typeof topo === 'number') alvo.scrollTop = topo;
  }

  if (foco) {
    const alvo = document.getElementById(foco);
    if (alvo && alvo.type !== 'file') {
      alvo.focus({ preventScroll: true });
      if (typeof cursor === 'number' && alvo.setSelectionRange) {
        try { alvo.setSelectionRange(cursor, cursor); } catch { /* campo sem seleção */ }
      }
    }
  }
}

export async function iniciar() {
  const tema = lerPreferencia(CHAVE_TEMA);
  if (tema === 'claro' || tema === 'escuro') document.documentElement.dataset.tema = tema;

  // Nome do servidor para a tela de login; não segura o carregamento da sessão.
  const site = api('/api/site').catch(() => estado.site);

  try {
    const dados = await api('/api/eu');
    estado.usuario = dados.usuario;
    estado.servidores = dados.servidores;
    estado.visaoAdmin = dados.visaoAdmin;
    // Volta para o servidor em que a pessoa estava na última visita.
    const salvo = lerPreferencia(CHAVE_SERVIDOR);
    estado.guildId = dados.servidores.find(servidor => servidor.id === salvo)?.id || dados.servidores[0]?.id || null;
  } catch (erro) {
    if (erro.status !== 401) avisar('erro', erro.message);
    estado.usuario = null;
  }

  estado.site = await site;

  const preferida = lerPreferencia(CHAVE_AREA);
  if (estado.usuario && papeisAtuais().responsavel && preferida === 'admin') {
    estado.area = 'admin';
    estado.vista = 'admin';
    if (rotaAtual().tipo === 'inicio' && !location.hash) history.replaceState(null, '', '#/geral');
  } else if (estado.usuario && papeisAtuais().staff && preferida !== 'jogador') {
    estado.area = 'staff';
    estado.vista = 'fila';
  }

  desenhar();
  if (!estado.usuario || !estado.guildId) return;

  window.addEventListener('hashchange', aoMudarRota);
  document.addEventListener('click', (evento) => {
    // Clicar fora fecha o painel de notificações e o menu da conta.
    const fechaSino = estado.sinoAberto && !evento.target.closest?.('.sino-area');
    const fechaPerfil = estado.perfilAberto && !evento.target.closest?.('.perfil-area');
    if (!fechaSino && !fechaPerfil) return;
    if (fechaSino) estado.sinoAberto = false;
    if (fechaPerfil) estado.perfilAberto = false;
    desenhar();
  });
  agendarAtualizacao();
  iniciarPush();
  await Promise.all([carregarArea(), aoMudarRota()]);
}
