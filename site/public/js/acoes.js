// Ações que alteram dados: enviar provas, ações da staff, abrir denúncia.
import { confirmar } from './confirmacao.js';
import { carregarArea, carregarDetalhe, carregarLista, carregarSugestoes } from './dados.js';
import { desenhar } from './desenho.js';
import { estado, raiz } from './estado.js';
import { limparRascunhoDaDenuncia } from './nova.js';
import { desativarPush } from './push.js';
import { ir, rotaAtual } from './rotas.js';
import { api, avisar, el, enviarJson, icone } from './util.js';

export async function executar(botao, fn) {
  const conteudo = [...botao.childNodes];
  botao.disabled = true;
  botao.classList.add('ocupado');
  try {
    await fn();
  } catch (erro) {
    avisar('erro', erro.message);
    desenhar();
  } finally {
    botao.disabled = false;
    botao.classList.remove('ocupado');
    botao.replaceChildren(...conteudo);
  }
}

// Envia um arquivo mostrando o progresso (o fetch não informa o andamento do envio).
export function enviarArquivo(id, arquivo, texto, aoProgredir) {
  return new Promise((resolver, rejeitar) => {
    const pedido = new XMLHttpRequest();
    pedido.open('POST', `/api/denuncias/${id}/arquivos`);
    pedido.setRequestHeader('Content-Type', 'application/octet-stream');
    pedido.setRequestHeader('X-Arquivo-Nome', encodeURIComponent(arquivo.name));
    pedido.setRequestHeader('X-Mensagem', encodeURIComponent(texto || ''));
    pedido.upload.addEventListener('progress', (evento) => {
      if (evento.lengthComputable) aoProgredir?.(evento.loaded / evento.total);
    });
    pedido.addEventListener('load', () => {
      if (pedido.status >= 200 && pedido.status < 300) return resolver();
      let mensagem = 'Não foi possível enviar o arquivo.';
      try { mensagem = JSON.parse(pedido.responseText).erro || mensagem; } catch { /* resposta sem JSON */ }
      rejeitar(new Error(`${arquivo.name}: ${mensagem}`));
    });
    pedido.addEventListener('error', () => rejeitar(new Error(`${arquivo.name}: a conexão caiu durante o envio.`)));
    pedido.send(arquivo);
  });
}

// Envia os arquivos um a um; o texto acompanha o primeiro.
export async function enviarArquivos(id, arquivos, texto) {
  for (const [indice, arquivo] of arquivos.entries()) {
    const barra = raiz.querySelector(`[data-arquivo="${indice}"] progress`);
    await enviarArquivo(id, arquivo, indice === 0 ? texto : '', (fracao) => { if (barra) barra.value = fracao; });
    if (barra) barra.value = 1;
  }
}

export function adicionarArquivos(lista, destino = 'arquivos') {
  const novos = [...(lista || [])].filter(arquivo => arquivo && arquivo.size > 0);
  if (!novos.length) return;
  estado[destino] = [...estado[destino], ...novos].slice(0, 10);
  desenhar();
}

export async function enviarProva(botao) {
  const id = estado.detalhe.denuncia.id;
  const texto = estado.rascunho.trim();
  const arquivos = estado.arquivos;
  if (!texto && !arquivos.length) {
    avisar('erro', 'Escreva uma mensagem ou escolha um arquivo.');
    return desenhar();
  }

  await executar(botao, async () => {
    if (arquivos.length) await enviarArquivos(id, arquivos, texto);
    else await enviarJson(`/api/denuncias/${id}/mensagens`, { conteudo: texto });
    estado.rascunho = '';
    estado.arquivos = [];
    estado.aviso = null;
    await carregarDetalhe(id);
    rolarConversaParaOFim();
  });
}

export async function salvarNota(botao) {
  const id = estado.detalhe.denuncia.id;
  const texto = estado.nota.trim();
  if (!texto) return;
  await executar(botao, async () => {
    await enviarJson(`/api/denuncias/${id}/notas`, { texto });
    estado.nota = '';
    await carregarDetalhe(id);
  });
}

export async function acaoStaff(botao, corpo) {
  const id = estado.detalhe.denuncia.id;
  await executar(botao, async () => {
    const resultado = await enviarJson(`/api/denuncias/${id}/acoes`, corpo);
    estado.aceitando = false;
    avisar('ok', resultado.mensagem);
    await Promise.all([carregarDetalhe(id), carregarArea()]);
  });
}

export async function finalizarDenuncia(botao, denuncia) {
  const confirmado = await confirmar({
    titulo: 'Finalizar e arquivar?',
    texto: `O histórico da denúncia contra ${denuncia.acusado} será exportado e o tópico no Discord ficará trancado. Não dá para desfazer.`,
    rotulo: 'Finalizar e arquivar',
    perigo: true
  });
  if (!confirmado) return;

  await executar(botao, async () => {
    const resultado = await enviarJson(`/api/denuncias/${denuncia.id}/finalizar`, {});
    estado.aceitando = false;
    avisar('ok', resultado.mensagem);
    await Promise.all([
      rotaAtual().tipo === 'detalhe' ? carregarDetalhe(denuncia.id) : Promise.resolve(),
      carregarArea()
    ]);
  });
}

export async function abrirDenuncia(botao, formulario) {
  const { categoria, detalhes = '', ...dados } = Object.fromEntries(new FormData(formulario));
  const descricao = detalhes.trim();
  if (categoria === 'Outros' && !descricao) {
    avisar('erro', 'Na categoria "Outros", escreva o motivo.');
    return desenhar();
  }
  // O motivo que vai para o Discord é "Categoria: motivo".
  const motivo = [categoria !== 'Outros' && categoria, descricao].filter(Boolean).join(': ');
  const anexos = estado.anexosNovos;
  await executar(botao, async () => {
    const resultado = await enviarJson('/api/denuncias', { ...dados, motivo, guildId: estado.guildId });
    estado.area = 'jogador';
    estado.vista = 'minhas';
    estado.anexosNovos = [];
    limparRascunhoDaDenuncia();

    // A denúncia já existe: se um anexo falhar, a pessoa reenvia pela conversa.
    let falha = null;
    if (anexos.length) await enviarArquivos(resultado.id, anexos, '').catch((erro) => { falha = erro; });

    await carregarLista('minhas');
    ir(`#/d/${resultado.id}`);
    // A troca de tela limpa os avisos; este precisa aparecer depois dela.
    if (falha) {
      setTimeout(() => {
        avisar('erro', `Denúncia criada, mas um anexo não foi enviado. ${falha.message}`);
        desenhar();
      }, 800);
    }
  });
}

export async function sair() {
  await desativarPush().catch(() => {});
  await api('/auth/sair', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

export function rolarConversaParaOFim() {
  const conversa = raiz.querySelector('.conversa');
  if (conversa) conversa.scrollTop = conversa.scrollHeight;
}

export function conversaNoFim() {
  const conversa = raiz.querySelector('.conversa');
  return !conversa || conversa.scrollHeight - conversa.scrollTop - conversa.clientHeight < 80;
}

// Endereço local (blob:) de cada arquivo escolhido, para mostrar a prévia antes
// do envio. O WeakMap solta o endereço junto com o arquivo.
const previas = new WeakMap();

function previaDoArquivo(arquivo) {
  const tipo = arquivo.type || '';
  if (!tipo.startsWith('image/') && !tipo.startsWith('video/')) return icone('arquivo');
  if (!previas.has(arquivo)) previas.set(arquivo, URL.createObjectURL(arquivo));
  const url = previas.get(arquivo);

  if (tipo.startsWith('image/')) return el('img', { class: 'previa', src: url, alt: '' });
  const video = el('video', { class: 'previa', src: url, preload: 'metadata', playsinline: true, 'aria-hidden': 'true' });
  video.muted = true;
  return video;
}

// Lista de arquivos escolhidos: prévia, tamanho e a barra de progresso de cada um.
export function listaDeArquivos(destino) {
  return estado[destino].length > 0 && el('ul', { class: 'arquivos-escolhidos' }, estado[destino].map((arquivo, indice) =>
    el('li', { 'data-arquivo': String(indice) },
      previaDoArquivo(arquivo),
      el('span', null, arquivo.name),
      el('small', null, `${(arquivo.size / 1024 / 1024).toFixed(1)} MB`),
      el('progress', { max: '1', value: '0', 'aria-label': `Envio de ${arquivo.name}` }),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': `Remover ${arquivo.name}`,
        onclick: () => {
          estado[destino] = estado[destino].filter((_, posicao) => posicao !== indice);
          desenhar();
        }
      }, icone('fechar')))));
}

export async function identificarSe(botao, denuncia) {
  const confirmado = await confirmar({
    titulo: 'Confirmar que é você?',
    texto: `Você passa a constar como acusado na denúncia contra ${denuncia.acusado} e ela entra em "Minhas denúncias". A staff é avisada no Discord.`,
    rotulo: 'Sou eu'
  });
  if (!confirmado) return;

  await executar(botao, async () => {
    const resultado = await enviarJson(`/api/denuncias/${denuncia.id}/identificar`, {});
    estado.area = 'jogador';
    estado.vista = 'minhas';
    await carregarLista('minhas');
    ir(`#/d/${resultado.id}`);
  });
}

export async function enviarSugestao(botao) {
  const texto = estado.textoSugestao.trim();
  if (texto.length < 10) {
    avisar('erro', 'Descreva a sugestão com pelo menos 10 caracteres.');
    return desenhar();
  }
  await executar(botao, async () => {
    const resultado = await enviarJson('/api/sugestoes', { guildId: estado.guildId, texto });
    estado.textoSugestao = '';
    avisar('ok', resultado.mensagem);
    await carregarSugestoes();
  });
}

export async function responderSugestao(botao, id, formulario) {
  await executar(botao, async () => {
    const resultado = await enviarJson(`/api/sugestoes/${id}/resposta`, Object.fromEntries(new FormData(formulario)));
    avisar('ok', resultado.mensagem);
    await carregarSugestoes();
  });
}

export async function enviarAvaliacao(botao) {
  const id = estado.detalhe.denuncia.id;
  if (!estado.notaAvaliacao) {
    avisar('erro', 'Escolha uma nota de 1 a 10.');
    return desenhar();
  }
  await executar(botao, async () => {
    const resultado = await enviarJson(`/api/denuncias/${id}/avaliacao`, {
      nota: estado.notaAvaliacao,
      comentario: estado.comentarioAvaliacao
    });
    estado.notaAvaliacao = null;
    estado.comentarioAvaliacao = '';
    avisar('ok', resultado.mensagem);
    await carregarDetalhe(id);
  });
}
