// Cartão com o perfil do Discord de um membro: abre ao clicar no nome ou na foto.
import { estado } from './estado.js';
import { api, avatar, el, formatarData, nomeColorido } from './util.js';

const INSIGNIAS = {
  Staff: 'Equipe do Discord',
  Partner: 'Dono de servidor parceiro',
  Hypesquad: 'Eventos HypeSquad',
  HypeSquadOnlineHouse1: 'HypeSquad Bravery',
  HypeSquadOnlineHouse2: 'HypeSquad Brilliance',
  HypeSquadOnlineHouse3: 'HypeSquad Balance',
  BugHunterLevel1: 'Caçador de bugs',
  BugHunterLevel2: 'Caçador de bugs nível 2',
  PremiumEarlySupporter: 'Apoiador inicial',
  VerifiedDeveloper: 'Desenvolvedor verificado',
  CertifiedModerator: 'Moderador certificado',
  ActiveDeveloper: 'Desenvolvedor ativo',
  VerifiedBot: 'Bot verificado'
};

function corDoCargo(cor) {
  const bolinha = el('i');
  if (/^#[0-9a-f]{6}$/i.test(cor || '')) bolinha.style.background = cor;
  return bolinha;
}

const data = (valor) => (valor ? formatarData(valor).replace(/ às .*/, '') : null);

function conteudo(perfil) {
  const linha = (rotulo, valor) => valor && el('div', { class: 'dado' }, el('dt', null, rotulo), el('dd', null, valor));
  const insignias = perfil.insignias.map(nome => INSIGNIAS[nome]).filter(Boolean);
  const topo = el('div', { class: 'perfil-dc-topo' });
  if (perfil.banner) topo.style.backgroundImage = `url("${perfil.banner}")`;
  else if (perfil.corDestaque) topo.style.background = perfil.corDestaque;

  return [
    topo,
    el('div', { class: 'perfil-dc-cabeca' },
      avatar({ id: perfil.id, nome: perfil.nome, url: perfil.avatar, classe: 'grande' }),
      el('div', { class: 'perfil-dc-nomes' },
        el('h2', null, nomeColorido(perfil.nome, perfil.cor),
          perfil.tag && el('span', { class: 'perfil-dc-tag', title: 'Tag do servidor' },
            perfil.tag.insignia && el('img', { src: perfil.tag.insignia, alt: '' }), perfil.tag.texto),
          perfil.bot && el('span', { class: 'marcador' }, 'BOT')),
        el('p', null, `@${perfil.usuario}`, perfil.nomeGlobal && perfil.nomeGlobal !== perfil.nome ? ` · ${perfil.nomeGlobal}` : ''))),
    insignias.length > 0 && el('div', { class: 'perfil-dc-insignias' }, insignias.map(nome => el('span', { class: 'marcador' }, nome))),
    el('dl', { class: 'dados' },
      linha('Conta criada', data(perfil.contaCriadaEm)),
      linha('No servidor desde', perfil.noServidor ? data(perfil.entrouEm) : 'Não está mais no servidor'),
      linha('Impulsiona desde', data(perfil.impulsionaDesde)),
      linha('ID', el('code', null, perfil.id))),
    perfil.cargos.length > 0 && el('section', { class: 'perfil-dc-cargos' },
      el('h3', null, `Cargos (${perfil.cargos.length})`),
      el('div', null, perfil.cargos.map(cargo => el('span', { class: 'perfil-dc-cargo' }, corDoCargo(cargo.cor), cargo.nome))))
  ];
}

export async function abrirPerfilDiscord(userId) {
  if (!userId) return;
  const corpo = el('div', { class: 'perfil-dc-corpo', 'aria-busy': 'true' }, el('p', { class: 'perfil-dc-carregando' }, 'Carregando perfil…'));
  const dialogo = el('dialog', { class: 'dialogo perfil-dc', 'aria-label': 'Perfil do Discord' },
    el('button', { class: 'perfil-dc-fechar', type: 'button', 'aria-label': 'Fechar', onclick: () => dialogo.close() }, '×'),
    corpo);
  // Clique fora do cartão fecha.
  dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) dialogo.close(); });
  dialogo.addEventListener('close', () => dialogo.remove());
  document.body.append(dialogo);
  dialogo.showModal();

  try {
    const perfil = await api(`/api/membros/${userId}?${new URLSearchParams({ guildId: estado.guildId })}`);
    corpo.replaceChildren(...conteudo(perfil).filter(Boolean));
  } catch (erro) {
    corpo.replaceChildren(el('p', { class: 'perfil-dc-carregando' }, erro.message || 'Não foi possível carregar o perfil.'));
  }
  corpo.removeAttribute('aria-busy');
}

// Envolve foto e nome num botão que abre o perfil.
export function comPerfil(userId, ...filhos) {
  if (!/^\d{15,21}$/.test(String(userId || ''))) return filhos;
  return el('button', { type: 'button', class: 'abre-perfil', title: 'Ver perfil do Discord', onclick: () => abrirPerfilDiscord(userId) }, filhos);
}
