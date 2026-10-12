// Formulário de nova denúncia.
import { abrirDenuncia, adicionarArquivos, listaDeArquivos } from './acoes.js';
import { desenhar } from './desenho.js';
import { CHAVE_RASCUNHO, estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { ir } from './rotas.js';
import { lerPreferencia, salvarPreferencia } from './tema.js';
import { api, el, formatarData, icone, papeisAtuais, servidorAtual } from './util.js';

const CAMPOS_DO_RASCUNHO = ['platform', 'acusado', 'categoria', 'detalhes', 'provas'];
const semAcento = (texto) => String(texto || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
let consultaPendente = null;

// O que a pessoa já digitou fica guardado no navegador: se ela fechar a página
// ou anexar um arquivo (que redesenha a tela), o texto continua lá.
export function rascunhoDaDenuncia() {
  if (!estado.rascunhoDenuncia) {
    try { estado.rascunhoDenuncia = JSON.parse(lerPreferencia(CHAVE_RASCUNHO) || '{}') || {}; } catch { estado.rascunhoDenuncia = {}; }
  }
  return estado.rascunhoDenuncia;
}

export function limparRascunhoDaDenuncia() {
  estado.rascunhoDenuncia = {};
  estado.duplicadas = null;
  estado.filtroCategoria = '';
  estado.rascunhoDaConta = null;
  salvarPreferencia(CHAVE_RASCUNHO, '{}');
  clearTimeout(esperaDoRascunho);
  // Na conta também: o rascunho some em todos os aparelhos.
  if (estado.guildId) api(`/api/rascunho?${new URLSearchParams({ guildId: estado.guildId })}`, { method: 'DELETE' }).catch(() => {});
}

// O rascunho também fica na conta, para continuar em outro aparelho. A cópia do
// navegador é gravada na hora; a da conta, um pouco depois de a pessoa parar de digitar.
let esperaDoRascunho = null;
function guardarRascunho(formulario) {
  const dados = Object.fromEntries(new FormData(formulario));
  estado.rascunhoDenuncia = Object.fromEntries(CAMPOS_DO_RASCUNHO.map(campo => [campo, String(dados[campo] || '')]));
  salvarPreferencia(CHAVE_RASCUNHO, JSON.stringify(estado.rascunhoDenuncia));

  const guildId = estado.guildId;
  const rascunho = { ...estado.rascunhoDenuncia };
  clearTimeout(esperaDoRascunho);
  esperaDoRascunho = setTimeout(() => {
    api('/api/rascunho', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId, rascunho }) }).catch(() => {});
  }, 1500);
}

const temTexto = (rascunho) => ['acusado', 'detalhes', 'provas'].some(campo => String(rascunho?.[campo] || '').trim());

// Ao abrir o formulário: se há um rascunho na conta (feito em outro aparelho) e
// este navegador está vazio, ele é carregado direto; se os dois têm texto
// diferente, a pessoa escolhe.
export async function carregarRascunhoDaConta() {
  if (!estado.guildId) return;
  const guildId = estado.guildId;
  const dados = await api(`/api/rascunho?${new URLSearchParams({ guildId })}`).catch(() => null);
  if (!dados?.rascunho || estado.guildId !== guildId) return;

  const daConta = dados.rascunho;
  const local = rascunhoDaDenuncia();
  const igual = CAMPOS_DO_RASCUNHO.every(campo => String(local[campo] || '') === String(daConta[campo] || ''));
  if (igual) return;

  if (!temTexto(local)) usarRascunhoDaConta(daConta);
  else estado.rascunhoDaConta = daConta;
  desenhar();
}

function usarRascunhoDaConta(daConta) {
  estado.rascunhoDenuncia = Object.fromEntries(CAMPOS_DO_RASCUNHO.map(campo => [campo, String(daConta[campo] || '')]));
  salvarPreferencia(CHAVE_RASCUNHO, JSON.stringify(estado.rascunhoDenuncia));
  estado.rascunhoDaConta = null;
}

// Meio segundo depois de a pessoa parar de digitar o ID, confere se já existe
// denúncia em andamento contra ele.
function conferirDuplicadas(acusado) {
  clearTimeout(consultaPendente);
  const valor = acusado.trim();
  if (!valor) {
    estado.duplicadas = null;
    return;
  }
  consultaPendente = setTimeout(async () => {
    const resultado = await api(`/api/duplicadas?${new URLSearchParams({ guildId: estado.guildId, acusado: valor })}`).catch(() => null);
    if (rascunhoDaDenuncia().acusado?.trim() !== valor) return;
    const mudou = (estado.duplicadas?.total || 0) !== (resultado?.total || 0);
    estado.duplicadas = resultado;
    if (mudou) desenhar();
  }, 500);
}

function avisoDeDuplicada() {
  const dup = estado.duplicadas;
  if (!dup?.total) return null;
  const quantas = dup.total === 1 ? 'Já existe 1 denúncia em análise' : `Já existem ${dup.total} denúncias em análise`;
  return el('div', { class: 'aviso info', role: 'status' },
    el('span', null,
      `${quantas} contra esse ID`,
      dup.categorias.length ? ` (${dup.categorias.join(', ')})` : '',
      dup.suas ? '. Uma delas foi aberta por você: envie as novas provas nela em vez de abrir outra.' : '. Abra outra só se for um fato diferente.'));
}

// Categorias que combinam com o que foi digitado no filtro: pelo nome, pelo
// grupo ou por uma sigla ("pg" acha Power gaming).
function categoriasFiltradas(categorias) {
  const termo = semAcento(estado.filtroCategoria).trim();
  if (!termo) return categorias;
  return categorias.filter(item => [item.nome, item.grupo, ...(item.termos || [])].some(texto => semAcento(texto).includes(termo)));
}

// Lista de categorias separada por grupo, com um filtro em cima. "Outros" é a
// opção livre: a pessoa escreve o motivo com as próprias palavras.
function campoDeCategoria(categorias, rascunho) {
  const visiveis = categoriasFiltradas(categorias);
  const grupos = new Map();
  for (const item of visiveis) {
    const grupo = item.grupo || 'Categorias';
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push(item);
  }
  const graves = categorias.filter(item => item.prioridade === 'alta').map(item => item.nome);
  const opcao = (nome, rotulo = nome) => el('option', { value: nome, selected: nome === rascunho.categoria }, rotulo);

  return el('div', { class: 'campo' },
    el('label', { for: 'categoria' }, 'Categoria'),
    el('div', { class: 'categoria-escolha' },
      categorias.length > 8 && el('label', { class: 'busca' },
        icone('busca'),
        el('input', {
          type: 'search',
          id: 'filtro-categoria-nova',
          'aria-label': 'Filtrar categorias',
          placeholder: 'Filtrar: rdm, pg, safe…',
          value: estado.filtroCategoria,
          oninput: (evento) => {
            // O filtro não faz parte do rascunho; só escolhe a categoria.
            evento.stopPropagation();
            estado.filtroCategoria = evento.target.value;
            const achadas = categoriasFiltradas(categorias);
            if (estado.filtroCategoria.trim() && !achadas.some(item => item.nome === rascunho.categoria)) {
              rascunho.categoria = achadas[0]?.nome || 'Outros';
              salvarPreferencia(CHAVE_RASCUNHO, JSON.stringify(rascunho));
            }
            desenhar();
          }
        })),
      el('select', { id: 'categoria', name: 'categoria', required: true },
        el('option', { value: '' }, 'Escolha a infração…'),
        [...grupos].map(([grupo, itens]) => el('optgroup', { label: grupo }, itens.map(item => opcao(item.nome)))),
        el('optgroup', { label: 'Não está na lista' }, opcao('Outros', 'Outros (escrever o motivo)')))),
    estado.filtroCategoria.trim() && !visiveis.length
      ? el('p', { class: 'dica' }, 'Nenhuma categoria com esse nome. Fica em "Outros": escreva o motivo abaixo.')
      : graves.length > 0 && el('p', { class: 'dica' }, `Entram na fila como alta prioridade: ${graves.join(', ')}.`));
}

export function telaNova() {
  const papeis = papeisAtuais();
  const servidor = servidorAtual();
  const voltar = el('button', { class: 'voltar', type: 'button', onclick: () => ir('#/') }, icone('voltar'), 'Início');
  const plataformas = [papeis.podeDenunciarPC && 'PC', papeis.podeDenunciarMobile && 'Mobile'].filter(Boolean);

  if (servidor?.manutencao) {
    return el('main', { class: 'principal' }, voltar, el('div', { class: 'vazio alto' },
      el('h3', null, 'Denúncias em manutenção'),
      el('p', null, 'Novas denúncias estão pausadas no momento. As que já estão abertas continuam preservadas.')));
  }

  if (!plataformas.length) {
    return el('main', { class: 'principal' }, voltar, el('div', { class: 'vazio alto' },
      el('h3', null, 'Você ainda não pode abrir denúncias'),
      el('p', null, 'É preciso ter o cargo de PC ou Mobile neste servidor. Peça a um administrador.')));
  }

  const rascunho = rascunhoDaDenuncia();
  const categorias = servidor?.categorias || [];
  const plataformaMarcada = plataformas.includes(rascunho.platform) ? rascunho.platform : plataformas[0];
  const temRascunho = CAMPOS_DO_RASCUNHO.some(campo => campo !== 'platform' && rascunho[campo]);

  const formulario = el('form', {
    class: 'formulario cartao',
    onsubmit: (evento) => evento.preventDefault(),
    oninput: () => guardarRascunho(formulario)
  },
  el('fieldset', { class: 'campo' },
    el('legend', null, 'Plataforma'),
    el('div', { class: 'opcoes' }, plataformas.map(nome => el('label', { class: 'opcao' },
      el('input', { type: 'radio', name: 'platform', value: nome, checked: nome === plataformaMarcada }),
      el('span', null, icone(nome === 'Mobile' ? 'celular' : 'monitor'), nome))))),
  el('div', { class: 'campo' },
    el('label', { for: 'acusado' }, 'ID do acusado'),
    el('input', {
      type: 'text', id: 'acusado', name: 'acusado', placeholder: '1039', maxlength: '120', required: true,
      value: rascunho.acusado || '',
      oninput: (evento) => conferirDuplicadas(evento.target.value)
    }),
    el('p', { class: 'dica' }, 'Para mais de um acusado, separe os IDs com +, como em 1039+2471.'),
    avisoDeDuplicada()),
  campoDeCategoria(categorias, rascunho),
  el('div', { class: 'campo' },
    el('label', { for: 'detalhes' }, 'Motivo'),
    el('input', { type: 'text', id: 'detalhes', name: 'detalhes', placeholder: 'Motivo da denúncia', maxlength: '75', value: rascunho.detalhes || '' }),
    el('p', { class: 'dica' }, 'Obrigatório quando a categoria é "Outros".')),
  el('div', { class: 'campo' },
    el('label', { for: 'provas' }, 'Links das provas'),
    el('textarea', { id: 'provas', name: 'provas', placeholder: 'https://youtu.be/…', maxlength: '1000', value: rascunho.provas || '' }),
    el('p', { class: 'dica' }, 'Opcional. Cole aqui links do YouTube ou de outras provas.')),
  el('div', { class: 'campo' },
    el('label', { for: 'anexos' }, 'Imagens e vídeos'),
    el('label', {
      class: 'soltar',
      for: 'anexos',
      ondragover: (evento) => evento.preventDefault(),
      ondrop: (evento) => {
        evento.preventDefault();
        adicionarArquivos(evento.dataTransfer.files, 'anexosNovos');
      }
    },
    el('input', {
      type: 'file',
      id: 'anexos',
      class: 'oculto-visualmente',
      multiple: true,
      onchange: (evento) => adicionarArquivos(evento.target.files, 'anexosNovos')
    }),
    icone('clipe'), 'Arraste arquivos aqui ou clique para escolher'),
    listaDeArquivos('anexosNovos'),
    el('p', { class: 'dica' }, 'Opcional. Os arquivos são enviados para o tópico logo depois que a denúncia é criada. Eles não ficam guardados no rascunho.')),
  blocoAviso(),
  el('div', { class: 'acoes' },
    el('button', {
      class: 'primario',
      type: 'submit',
      onclick: (evento) => {
        if (formulario.reportValidity()) abrirDenuncia(evento.currentTarget, formulario);
      }
    }, 'Criar denúncia'),
    el('button', { type: 'button', onclick: () => ir('#/') }, 'Cancelar'),
    temRascunho && el('button', {
      class: 'discreto',
      type: 'button',
      onclick: () => {
        limparRascunhoDaDenuncia();
        estado.anexosNovos = [];
        desenhar();
      }
    }, 'Limpar rascunho'))
  );

  return el('main', { class: 'principal' },
    voltar,
    el('div', { class: 'nova' },
      el('header', null,
        el('h1', null, 'Fazer denúncia'),
        el('p', { class: 'sub' }, temRascunho
          ? 'Continuando de onde você parou. O ID do denunciante é lido do seu apelido no servidor.'
          : 'O ID do denunciante é lido do seu apelido no servidor.')),
      estado.rascunhoDaConta && el('div', { class: 'aviso rascunho-da-conta', role: 'status' },
        el('span', null, `Há um rascunho diferente salvo na sua conta${estado.rascunhoDaConta.atualizadoEm ? `, de ${formatarData(estado.rascunhoDaConta.atualizadoEm)}` : ''}, feito em outro aparelho. Contra: ${estado.rascunhoDaConta.acusado || 'sem ID'}.`),
        el('div', { class: 'acoes' },
          el('button', {
            type: 'button',
            onclick: () => {
              usarRascunhoDaConta(estado.rascunhoDaConta);
              desenhar();
            }
          }, 'Usar o da conta'),
          el('button', {
            class: 'discreto', type: 'button',
            onclick: () => {
              estado.rascunhoDaConta = null;
              desenhar();
            }
          }, 'Ficar com o deste aparelho'))),
      formulario,
      el('aside', { class: 'cartao nova-regras' },
        el('h2', null, 'Antes de enviar'),
        el('ul', null,
          el('li', null, 'É obrigatório estar com o Discord autenticado com o jogo.'),
          el('li', null, 'Após o envio da denúncia, você NÃO poderá apagar.'),
          el('li', null, 'O mau uso das denúncias resultará em punição.'),
          el('li', null, 'Apagar provas ou mensagens do tópico gera punição.')),

        el('h2', null, 'Provas em vídeo'),
        el('ul', null,
          el('li', null, 'É recomendado enviar vídeos pelo YouTube.'),
          el('li', null, 'O vídeo deve mostrar claramente a infração.'),
          el('li', null, 'Você pode deixar o vídeo como "não listado".'),
          el('li', null, 'Links de outros sites podem não funcionar.')),

        el('h2', null, 'Como enviar pelo formulário'),
        el('ol', null,
          el('li', null, 'Faça upload do vídeo no YouTube.'),
          el('li', null, 'Copie o link do vídeo.'),
          el('li', null, 'Cole o link no campo "Links das provas" da denúncia.')),

        el('h2', { class: 'recusa' }, 'Sua denúncia será recusada se contiver'),
        el('ul', { class: 'recusa' },
          el('li', null, 'Vídeos com menos de 10 segundos (sem contexto da situação).'),
          el('li', null, 'Arquivos que exijam download externo (.rar, .zip, .mp4 anexado).'),
          el('li', null, 'Links de sites de hospedagem de arquivos desconhecidos.'),
          el('li', null, 'Vídeos com mais de 48 horas após o ocorrido.'))))
  );
}
