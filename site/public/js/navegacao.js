// Barra superior, seletor de áreas, notificações e menu lateral.
import { sair } from './acoes.js';
import { abrirArea, abrirVista, casosDaVista, entrarNoServidor, filtrarLista } from './dados.js';
import { desenhar } from './desenho.js';
import { ROTAS_PROPRIAS, VISTAS, estado } from './estado.js';
import { marca } from './marca.js';
import { marcarVisto, novidadesDoJogador } from './novidades.js';
import { ativarPush, blocoDoPush, desativarPush } from './push.js';
import { ir, rotaAtual } from './rotas.js';
import { alternarTema, temaAtual } from './tema.js';
import {
  avatar,
  el,
  fotoDoUsuario,
  icone,
  nomeDoSite,
  nomeDoUsuario,
  numeroDoCaso,
  papeisAtuais,
  podeAbrir,
  selo,
  tempoRelativo
} from './util.js';

// Jogador, Staff e Admin ficam na barra superior, sempre à vista.
export function seletorDeAreas() {
  const papeis = papeisAtuais();
  if (!papeis.staff) return null;
  const botao = (area, rotulo, nomeIcone) => el('button', {
    type: 'button',
    // Na página inicial (logo) nenhuma área fica marcada.
    'aria-pressed': String(estado.area === area && rotaAtual().tipo !== 'home'),
    onclick: () => abrirArea(area)
  }, icone(nomeIcone), rotulo);

  return el('div', { class: `areas area-${estado.area}`, role: 'group', 'aria-label': 'Área do site' },
    botao('jogador', 'Jogador', 'usuario'),
    botao('staff', 'Staff', 'escudo'),
    papeis.responsavel && botao('admin', 'Admin', 'grade'));
}

export function marcarTudoComoLido() {
  for (const denuncia of novidadesDoJogador()) marcarVisto(denuncia.id);
  estado.soNovidades = false;
  estado.sinoAberto = false;
  desenhar();
}

export function painelDeNotificacoes(novidades) {
  return el('div', { class: 'notificacoes', role: 'dialog', 'aria-label': 'Notificações' },
    el('header', null,
      el('strong', null, 'Notificações'),
      novidades.length > 0 && el('button', { class: 'ver-tudo', type: 'button', onclick: marcarTudoComoLido }, icone('visto'), 'Marcar tudo como lido')),
    novidades.length
      ? el('ul', null, novidades.slice(0, 8).map(denuncia => el('li', null,
        el('button', {
          type: 'button',
          onclick: () => {
            estado.sinoAberto = false;
            estado.area = 'jogador';
            estado.vista = 'minhas';
            ir(`#/d/${denuncia.id}`);
          }
        },
        el('span', null,
          el('strong', null, `Denúncia ${numeroDoCaso(denuncia.id)}, acusado ${denuncia.acusado}`),
          el('small', null, `Atividade ${tempoRelativo(denuncia.ultimaAtividade)}`)),
        selo(denuncia.status)))))
      : el('p', { class: 'sub' }, 'Nenhuma novidade nas suas denúncias.'),
    novidades.length > 8 && el('p', { class: 'sub' }, `e mais ${novidades.length - 8}`),
    blocoDoPush());
}

const papelDoUsuario = (papeis) => (papeis.responsavel ? 'Responsável' : papeis.staff ? 'Staff' : 'Jogador');

// Menu que abre ao clicar na própria conta: quem é você neste servidor,
// preferências do aparelho e a saída.
export function menuDoPerfil(papeis, claro) {
  const fechar = () => { estado.perfilAberto = false; };
  const item = (rotulo, nomeIcone, aoClicar, classe = '') => el('button', {
    class: `perfil-item ${classe}`.trim(),
    type: 'button',
    role: 'menuitem',
    onclick: (evento) => {
      fechar();
      aoClicar(evento);
    }
  }, icone(nomeIcone), el('span', null, rotulo));

  return el('div', { class: 'notificacoes perfil-menu', role: 'menu', 'aria-label': 'Sua conta' },
    el('div', { class: 'perfil-cabecalho' },
      avatar({ id: estado.usuario.id, nome: nomeDoUsuario(), url: fotoDoUsuario(), classe: 'grande' }),
      el('div', null,
        el('strong', null, nomeDoUsuario()),
        el('span', null, `${papelDoUsuario(papeis)} em ${nomeDoSite()}`),
        estado.usuario.nome !== nomeDoUsuario() && el('small', null, `Discord: ${estado.usuario.nome}`))),

    el('p', { class: 'perfil-titulo' }, 'Atalhos'),
    item('Minhas denúncias', 'casa', () => abrirArea('jogador')),
    papeis.staff && item('Painel da staff', 'escudo', () => abrirArea('staff')),
    item('Chat do servidor', 'balao', () => ir('#/chat')),
    papeis.responsavel && item('Configurações do site', 'ajustes', () => {
      estado.area = 'admin';
      estado.vista = 'admin';
      ir('#/config');
    }),

    el('p', { class: 'perfil-titulo' }, 'Configurações deste aparelho'),
    item(claro ? 'Usar tema escuro' : 'Usar tema claro', claro ? 'lua' : 'sol', alternarTema),
    estado.push === 'inativo' && item('Ativar notificações', 'sino', (evento) => ativarPush(evento.currentTarget)),
    estado.push === 'ativo' && item('Desativar notificações', 'sino', () => desativarPush().then(desenhar)),
    estado.push === 'bloqueado' && el('p', { class: 'sub' }, 'Notificações bloqueadas nas permissões do navegador.'),

    el('p', { class: 'perfil-titulo' }, 'Sobre o site'),
    el('p', { class: 'politicas perfil-politicas' },
      el('a', { href: '/termos.html' }, 'Termos de serviço'),
      el('a', { href: '/privacidade.html' }, 'Privacidade'),
      el('a', { href: '/cookies.html' }, 'Cookies')),

    item('Sair da conta', 'sair', sair, 'perigo'));
}

export function barraSuperior() {
  const claro = temaAtual() === 'claro';
  const papeis = papeisAtuais();
  const novidades = novidadesDoJogador();

  return el('header', { class: 'topo' },
    marca(),
    seletorDeAreas(),
    el('label', { class: 'busca topo-busca' },
      icone('busca'),
      el('input', {
        type: 'search',
        id: 'busca',
        'aria-label': 'Buscar denúncias',
        placeholder: 'Buscar por acusado, motivo ou número do caso',
        value: estado.busca,
        oninput: (evento) => {
          estado.busca = evento.target.value;
          if (rotaAtual().tipo !== 'inicio') ir('#/');
          filtrarLista({ digitando: true });
        }
      })),
    el('div', { class: 'topo-acoes' },
      el('div', { class: 'sino-area' },
        el('button', {
          class: 'so-icone sino',
          type: 'button',
          id: 'sino',
          'aria-expanded': String(estado.sinoAberto),
          'aria-label': novidades.length ? `Notificações: ${novidades.length} ${novidades.length === 1 ? 'denúncia com novidade' : 'denúncias com novidade'}` : 'Notificações: nenhuma novidade',
          onclick: (evento) => {
            evento.stopPropagation();
            estado.sinoAberto = !estado.sinoAberto;
            estado.perfilAberto = false;
            desenhar();
          }
        }, icone('sino'), novidades.length > 0 && el('span', { class: 'sino-contagem' }, String(novidades.length))),
        estado.sinoAberto && painelDeNotificacoes(novidades)),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': claro ? 'Usar tema escuro' : 'Usar tema claro',
        title: claro ? 'Tema escuro' : 'Tema claro',
        onclick: alternarTema
      }, icone(claro ? 'lua' : 'sol')),
      el('div', { class: 'perfil-area' },
        el('button', {
          class: 'usuario',
          type: 'button',
          id: 'perfil',
          'aria-haspopup': 'menu',
          'aria-expanded': String(estado.perfilAberto),
          title: 'Sua conta',
          onclick: (evento) => {
            evento.stopPropagation();
            estado.perfilAberto = !estado.perfilAberto;
            estado.sinoAberto = false;
            desenhar();
          }
        },
        avatar({ id: estado.usuario.id, nome: nomeDoUsuario(), url: fotoDoUsuario() }),
        el('span', { class: 'usuario-texto' },
          el('strong', null, nomeDoUsuario()),
          el('span', null, papelDoUsuario(papeis))),
        icone('seta-baixo')),
        estado.perfilAberto && menuDoPerfil(papeis, claro)))
  );
}

export function menuLateral() {
  const rota = rotaAtual();

  const item = ({ rotulo, nomeIcone, ativo, contagem, aoClicar }) => el('button', {
    class: 'menu-item',
    type: 'button',
    'aria-current': ativo ? 'page' : null,
    onclick: aoClicar
  },
  icone(nomeIcone),
  el('span', null, rotulo),
  typeof contagem === 'number' && contagem > 0 && el('span', { class: 'menu-contagem' }, String(contagem)));

  const itemDaVista = (vista) => item({
    rotulo: VISTAS[vista].menu,
    nomeIcone: VISTAS[vista].icone,
    ativo: rota.tipo !== 'nova' && !ROTAS_PROPRIAS.includes(rota.tipo) && estado.vista === vista,
    contagem: vista === 'admin' ? estado.totalAdmin : casosDaVista(vista).length,
    aoClicar: () => abrirVista(vista)
  });

  const itemDeRota = (rotulo, nomeIcone, tipo, contagem) => item({ rotulo, nomeIcone, contagem, ativo: rota.tipo === tipo, aoClicar: () => ir(`#/${tipo}`) });
  // Mensagens que chegaram no chat desde a última leitura.
  const itemDoChat = () => itemDeRota(estado.chatNovas.mencoes ? 'Chat (marcaram você)' : 'Chat do servidor', 'balao', 'chat', estado.chatNovas.total);

  // O menu é dividido em grupos, para cada coisa ter o seu lugar.
  const grupo = (titulo) => el('p', { class: 'menu-grupo' }, titulo);

  const itens = estado.area === 'admin'
    ? [
      itemDeRota('Visão geral', 'casa', 'geral'),
      itemDaVista('admin'),
      itemDeRota('Números', 'grafico', 'numeros'),
      itemDeRota('Perfil do jogador', 'usuario', 'jogador'),
      grupo('Equipe'),
      itemDeRota('Ranking', 'trofeu', 'ranking'),
      itemDeRota('Metas', 'visto', 'metas'),
      itemDeRota('Testes da staff', 'nota', 'teste-admin'),
      itemDeRota('Auditoria', 'olho', 'auditoria'),
      itemDeRota('Logins', 'cadeado', 'logins'),
      grupo('Comunidade'),
      itemDeRota('Avisos', 'sino', 'avisos'),
      itemDoChat(),
      itemDeRota('Sugestões', 'lampada', 'sugestoes'),
      grupo('Ajustes'),
      itemDeRota('Configurações do site', 'ajustes', 'config'),
      itemDeRota('Painel do bot', 'escudo', 'bot'),
      itemDeRota('Saúde do bot', 'grafico', 'saude')
    ]
    : estado.area === 'staff'
      ? [
        itemDaVista('fila'),
        itemDaVista('atendimentos'),
        grupo('Ferramentas'),
        itemDeRota('Perfil do jogador', 'usuario', 'jogador'),
        itemDeRota('Ranking', 'trofeu', 'ranking'),
        itemDeRota(estado.testesPendentes.obrigatorios ? 'Testes (obrigatório)' : 'Testes', 'nota', 'teste', estado.testesPendentes.total),
        grupo('Comunidade'),
        itemDoChat()
      ]
      : [
        itemDaVista('minhas'),
        podeAbrir() && item({ rotulo: 'Fazer denúncia', nomeIcone: 'alerta', ativo: rota.tipo === 'nova', aoClicar: () => ir('#/nova') }),
        itemDeRota('Denúncias abertas', 'busca', 'identificar'),
        grupo('Comunidade'),
        itemDoChat(),
        itemDeRota('Sugestões', 'lampada', 'sugestoes')
      ];

  return el('nav', { class: 'menu', 'aria-label': 'Navegação principal' },
    estado.servidores.length > 1 && el('select', {
      class: 'menu-servidor',
      'aria-label': 'Servidor',
      onchange: (evento) => entrarNoServidor(evento.target.value)
    }, estado.servidores.map(opcao => el('option', { value: opcao.id, selected: opcao.id === estado.guildId }, opcao.nome))),

    el('p', { class: 'menu-titulo' }, estado.area === 'admin' ? 'Painel do responsável' : estado.area === 'staff' ? 'Painel da staff' : 'Área do jogador'),
    el('div', { class: 'menu-itens' }, itens),

    el('div', { class: 'menu-rodape' },
      el('p', { class: 'politicas' }, el('a', { href: '/termos.html' }, 'Termos'), el('a', { href: '/privacidade.html' }, 'Privacidade'), el('a', { href: '/cookies.html' }, 'Cookies')))
  );
}

export function blocoAviso() {
  return estado.aviso && el('div', {
    class: `aviso ${estado.aviso.tipo}`,
    role: estado.aviso.tipo === 'erro' ? 'alert' : 'status'
  },
  el('span', null, estado.aviso.texto),
  el('button', {
    class: 'so-icone',
    type: 'button',
    'aria-label': 'Fechar aviso',
    onclick: () => {
      estado.aviso = null;
      desenhar();
    }
  }, icone('fechar')));
}
