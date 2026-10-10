// Utilitários: criação de elementos, ícones, chamadas à API, datas e texto do Discord.
import { ROTULOS_STATUS, estado } from './estado.js';

// Cria elementos sempre por textContent/atributos: nada do que vem do servidor
// é interpretado como HTML.
export function el(tag, props, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') no.className = valor;
    else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
    else if (chave === 'value') no.value = valor;
    else no.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return no;
}

export const SVG = 'http://www.w3.org/2000/svg';
export const ICONES = {
  casa: 'M4 11l8-7 8 7 M6 10v9h4v-5h4v5h4v-9',
  documento: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h4',
  caixa: 'M4 13l2.5-8h11L20 13 M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5 M4 13h4.5l1 2h5l1-2H20',
  grade: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  escudo: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2.2 2.2L15 10.5',
  alerta: 'M12 4l9 15H3z M12 10v4 M12 17v.5',
  relogio: 'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z M12 8v4.5l3 1.8',
  usuario: 'M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M5 20c.6-3.5 3.4-5.5 7-5.5s6.4 2 7 5.5',
  lampada: 'M9 17h6 M10 20h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  mais: 'M12 5v14 M5 12h14',
  sair: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 16l-4-4 4-4 M6 12h10',
  busca: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-3.6-3.6',
  clipe: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  enviar: 'M4 12l16-8-6 16-3-7z',
  externo: 'M14 4h6v6 M20 4l-9 9 M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  voltar: 'M15 5l-7 7 7 7',
  avancar: 'M9 5l7 7-7 7',
  sol: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
  lua: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  visto: 'M5 12.5l4.5 4.5L19 7.5',
  sino: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0',
  'seta-baixo': 'M6 9l6 6l6-6',
  som: 'M4 10v4h3l4 3V7l-4 3z M15 9.5a3.5 3.5 0 0 1 0 5 M17.5 7a7 7 0 0 1 0 10',
  mudo: 'M4 10v4h3l4 3V7l-4 3z M15.5 9.5l5 5 M20.5 9.5l-5 5',
  responder: 'M10 7L5 12l5 5 M5 12h9a5 5 0 0 1 5 5v1',
  sorriso: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8 M9 10h.01 M15 10h.01',
  bandeira: 'M6 21V4 M6 5h11l-2 4l2 4H6',
  lixeira: 'M5 7h14 M9 7V5h6v2 M7 7l1 12h8l1-12 M10 11v5 M14 11v5',
  balao: 'M4 5h16v11H10l-5 4v-4H4z',
  ajustes: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4.5v5 M9 14.5v5',
  grafico: 'M4 20V5 M4 20h16 M8 17v-5 M12 17V8 M16 17v-7',
  estrela: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z',
  trofeu: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M9 20h6',
  nota: 'M5 4h14v11l-5 5H5z M14 20v-5h5 M8 9h8 M8 13h4',
  olho: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z',
  tocar: 'M8 5.5v13l11-6.5z',
  fechar: 'M6 6l12 12 M18 6L6 18',
  arquivo: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  cadeado: 'M7 11V8a5 5 0 0 1 10 0v3 M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  monitor: 'M4 5h16v11H4z M9 20h6 M12 16v4',
  celular: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2'
};

export function icone(nome) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  const caminho = document.createElementNS(SVG, 'path');
  caminho.setAttribute('d', ICONES[nome]);
  svg.append(caminho);
  return svg;
}

export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, { credentials: 'same-origin', ...opcoes });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.erro || dados.mensagem || 'Não foi possível completar a ação.');
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

export const enviarJson = (caminho, corpo) => api(caminho, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo)
});

export const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
export const formatoDia = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
export const formatoRelativo = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export const formatarData = (valor) => (valor ? formatoData.format(new Date(valor)).replace(',', ' às') : '');

// "há 2 horas", "ontem"; depois de uma semana, a data.
export function tempoRelativo(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  const minutos = Math.round((data - Date.now()) / 60000);
  if (Math.abs(minutos) < 1) return 'agora';
  if (Math.abs(minutos) < 60) return formatoRelativo.format(minutos, 'minute');
  const horas = Math.round(minutos / 60);
  if (Math.abs(horas) < 24) return formatoRelativo.format(horas, 'hour');
  const dias = Math.round(horas / 24);
  if (Math.abs(dias) < 7) return formatoRelativo.format(dias, 'day');
  return formatoData.format(data).split(',')[0];
}

export function hoje() {
  const agora = new Date();
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(agora.getDate())}/${dois(agora.getMonth() + 1)}/${agora.getFullYear()}`;
}

export const numeroDoCaso = (id) => `#${String(id).slice(-6).toUpperCase()}`;

export function iniciais(nome) {
  // O apelido do servidor termina com o ID da conta ("Fulano 1039"): ele não entra nas iniciais.
  const partes = String(nome || '?').trim().split(/\s+/).filter(parte => parte && !/^\d+$/.test(parte));
  return ((partes[0]?.[0] || '?') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

// Cor estável por pessoa, usada quando ela não tem foto.
export function tomDe(id) {
  let soma = 0;
  for (const caractere of String(id || '')) soma = (soma * 31 + caractere.charCodeAt(0)) % 997;
  return `tom-${soma % 5}`;
}

// Foto do Discord; se não houver (ou não carregar), as iniciais.
export function avatar({ id, nome, url, classe = '' }) {
  const reserva = () => el('span', { class: `avatar ${tomDe(id)} ${classe}`, 'aria-hidden': 'true' }, iniciais(nome));
  if (!url) return reserva();
  const imagem = el('img', { class: `avatar ${classe}`, src: url, alt: '', loading: 'lazy' });
  imagem.addEventListener('error', () => imagem.replaceWith(reserva()), { once: true });
  return imagem;
}

// Nome pintado com a cor do cargo da pessoa no servidor, quando houver.
export function nomeColorido(nome, cor) {
  const no = el('strong', null, nome);
  if (/^#[0-9a-f]{6}$/i.test(cor || '')) no.style.color = cor;
  return no;
}

// ID de um vídeo do YouTube a partir do link (watch, youtu.be, shorts, live).
export function idDoYoutube(link) {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^(www|m)\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1] || null;
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

export function linksDoYoutube(texto) {
  const ids = (String(texto || '').match(/https?:\/\/[^\s<>]+/g) || []).map(idDoYoutube).filter(Boolean);
  return [...new Set(ids)];
}

// Miniatura com botão de tocar; o player só é carregado quando a pessoa clica.
export function videoDoYoutube(id) {
  const cartao = el('button', { class: 'youtube', type: 'button', 'aria-label': 'Tocar vídeo do YouTube' },
    el('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
    el('span', { class: 'youtube-tocar' }, icone('tocar')));
  cartao.addEventListener('click', () => {
    cartao.replaceWith(el('iframe', {
      class: 'youtube-player',
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      title: 'Vídeo do YouTube',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin'
    }));
  });
  return cartao;
}

// Abre a imagem ampliada por cima da página.
export function ampliarImagem(url, nome) {
  const dialogo = el('dialog', { class: 'ampliada' },
    el('img', { src: url, alt: nome || '' }),
    el('div', { class: 'ampliada-barra' },
      el('span', null, nome || 'Imagem'),
      el('a', { class: 'botao', href: url, target: '_blank', rel: 'noopener' }, 'Abrir original', icone('externo')),
      el('button', { class: 'so-icone', type: 'button', 'aria-label': 'Fechar', onclick: () => dialogo.close() }, icone('fechar'))));
  dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) dialogo.close(); });
  dialogo.addEventListener('close', () => dialogo.remove());
  document.body.append(dialogo);
  dialogo.showModal();
}

// Mensagem só com emojis: o Discord mostra os emojis grandes.
export const soEmojis = (texto) => /^(?:\s*<a?:\w{2,32}:\d{15,21}>\s*){1,6}$/.test(String(texto || ''));

// Converte o texto do Discord em elementos: links, **negrito**, `código`,
// menções (<@id>, <@&id>, <#id>) e emojis do servidor (<:nome:id>).
export const TRECHO = /(https?:\/\/[^\s<>]+)|<@!?(\d{15,21})>|<@&(\d{15,21})>|<#(\d{15,21})>|<(a?):(\w{2,32}):(\d{15,21})>|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

export function rico(texto, contexto = estado.detalhe || {}) {
  const fonte = String(texto || '');
  const nos = [];
  let fim = 0;

  for (const achado of fonte.matchAll(TRECHO)) {
    if (achado.index > fim) nos.push(fonte.slice(fim, achado.index));
    fim = achado.index + achado[0].length;
    const [bruto, link, usuario, cargo, canal, animado, nomeEmoji, idEmoji, negrito, codigo] = achado;

    if (link) {
      try {
        const url = new URL(link);
        nos.push(['https:', 'http:'].includes(url.protocol)
          ? el('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, link)
          : link);
      } catch {
        nos.push(link);
      }
    } else if (usuario) {
      nos.push(el('span', { class: 'mencao' }, `@${contexto.pessoas?.[usuario]?.nome || 'usuário'}`));
    } else if (cargo) {
      nos.push(el('span', { class: 'mencao' }, `@${contexto.cargos?.[cargo] || 'cargo'}`));
    } else if (canal) {
      nos.push(el('span', { class: 'mencao' }, `#${contexto.canais?.[canal] || 'canal'}`));
    } else if (idEmoji) {
      const emoji = el('img', {
        class: 'emoji',
        src: `https://cdn.discordapp.com/emojis/${idEmoji}.${animado ? 'gif' : 'webp'}?size=48`,
        alt: `:${nomeEmoji}:`,
        title: `:${nomeEmoji}:`,
        loading: 'lazy'
      });
      emoji.addEventListener('error', () => emoji.replaceWith(`:${nomeEmoji}:`), { once: true });
      nos.push(emoji);
    } else if (negrito) {
      nos.push(el('strong', null, negrito));
    } else if (codigo) {
      nos.push(el('code', null, codigo));
    } else {
      nos.push(bruto);
    }
  }

  if (fim < fonte.length) nos.push(fonte.slice(fim));
  return nos;
}

export function duracaoCurta(ms) {
  const minutos = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h${minutos % 60 ? ` ${minutos % 60} min` : ''}`;
  return `${Math.floor(horas / 24)} dias`;
}

// Prazo de atendimento (SLA): vale enquanto a denúncia espera alguém reivindicar.
export function slaDe(denuncia) {
  if (!denuncia.prazoSla || denuncia.status !== 'pendente') return null;
  const resta = new Date(denuncia.prazoSla).getTime() - Date.now();
  if (resta < 0) return { classe: 'estourado', texto: `Atrasada há ${duracaoCurta(resta)}` };
  const total = new Date(denuncia.prazoSla).getTime() - new Date(denuncia.dataCriacao).getTime();
  return { classe: resta < total * 0.25 ? 'perto' : 'no-prazo', texto: `Vence em ${duracaoCurta(resta)}` };
}

export const seloSla = (denuncia) => {
  const sla = slaDe(denuncia);
  return sla && el('span', { class: `sla ${sla.classe}` }, icone('relogio'), sla.texto);
};

export const selo = (status) => el('span', { class: `selo ${status}` }, ROTULOS_STATUS[status] || status);

// "Equipe" cobre o painel da staff e o painel do responsável: nos dois a
// pessoa atende casos; só a área do jogador esconde as ações de atendimento.
export const areaDaEquipe = () => estado.area !== 'jogador';

export const servidorAtual = () => estado.servidores.find(servidor => servidor.id === estado.guildId) || null;
export const papeisAtuais = () => servidorAtual()?.papeis || {};
export const podeAbrir = () => Boolean(papeisAtuais().podeDenunciarPC || papeisAtuais().podeDenunciarMobile);
export const nomeDoUsuario = () => servidorAtual()?.apelido || estado.usuario.nome;
export const fotoDoUsuario = () => servidorAtual()?.avatar || estado.usuario.avatar;
export const nomeDoSite = () => servidorAtual()?.nome || estado.site.nome;

export function avisar(tipo, texto) {
  estado.aviso = texto ? { tipo, texto } : null;
}
