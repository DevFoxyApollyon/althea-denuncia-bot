// Testes da staff. São vários por servidor, cada um com título próprio: a
// staff escolhe qual fazer e envia cada um em separado; o responsável cria,
// edita e apaga os testes e vê os resultados de cada um. Além do vídeo de
// abertura, cada pergunta pode ter o seu próprio vídeo.
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { ir, rotaAtual } from './rotas.js';
import { api, avatar, avisar, el, enviarJson, formatarData, icone, nomeColorido, videoDoYoutube } from './util.js';

const parametros = () => new URLSearchParams({ guildId: estado.guildId });
const carregador = (rotulo) => el('div', { class: 'carregador', role: 'status', 'aria-label': rotulo }, el('span'), el('span'), el('span'));
const porcento = (item) => Math.round((item.acertos / item.total) * 100);
const linkDoVideo = (id) => (id ? `https://youtu.be/${id}` : '');
const voltar = (rotulo, destino) => el('button', { class: 'voltar discreto', type: 'button', onclick: () => ir(destino) }, icone('voltar'), rotulo);

// ---------------------------------------------------------------- staff: lista
export async function carregarTeste(id) {
  const guildId = estado.guildId;
  estado.teste = null;
  estado.respostasTeste = {};
  if (!id) estado.testes = null;
  try {
    const dados = await api(id ? `/api/teste/${encodeURIComponent(id)}?${parametros()}` : `/api/teste?${parametros()}`);
    if (rotaAtual().tipo !== 'teste' || rotaAtual().id !== id || estado.guildId !== guildId) return;
    if (id) estado.teste = dados;
    else estado.testes = dados.testes;
  } catch (erro) {
    avisar('erro', erro.message);
    if (id) return ir('#/teste');
    estado.testes = [];
  }
  desenhar();
}

function listaDeTestes() {
  const testes = estado.testes;
  if (!testes) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso() || carregador('Carregando os testes')));

  const feitos = testes.filter(teste => teste.ultima?.aprovado).length;
  return el('main', { class: 'principal' },
    el('div', { class: 'teste' },
      el('header', null,
        el('h1', null, 'Testes da staff'),
        el('p', { class: 'sub' }, testes.length
          ? `Escolha um teste para fazer. Cada um é enviado e corrigido em separado. Você foi aprovado em ${feitos} de ${testes.length}.`
          : 'Os testes que o responsável montar aparecem aqui.')),
      blocoAviso(),
      !testes.length
        ? el('div', { class: 'vazio alto' }, el('h3', null, 'Ainda não há teste'), el('p', null, 'O responsável deste servidor ainda não publicou nenhum teste.'))
        : el('ul', { class: 'testes-lista' }, testes.map((teste) => {
          const situacao = !teste.ultima ? 'novo' : teste.ultima.aprovado ? 'aprovado' : 'reprovado';
          return el('li', null, el('button', { class: `teste-cartao ${situacao}`, type: 'button', onclick: () => ir(`#/teste/${teste.id}`) },
            el('span', { class: 'teste-cartao-texto' },
              el('strong', null, teste.titulo),
              teste.instrucoes && el('span', { class: 'teste-cartao-sub' }, teste.instrucoes),
              el('small', null, [
                teste.perguntas === 1 ? '1 pergunta' : `${teste.perguntas} perguntas`,
                teste.comVideo && 'com vídeo',
                `passa com ${teste.notaMinima}%`
              ].filter(Boolean).join(', '))),
            el('span', { class: 'teste-cartao-situacao' },
              situacao === 'novo'
                ? el('span', { class: 'selo pendente' }, 'Não feito')
                : [el('strong', null, `${porcento(teste.ultima)}%`), el('span', { class: `selo ${teste.ultima.aprovado ? 'aceita' : 'recusada'}` }, teste.ultima.aprovado ? 'Aprovado' : 'Reprovado')]),
            icone('avancar')));
        }))));
}

// ---------------------------------------------------------------- staff: um teste
async function enviarTeste(botao) {
  const teste = estado.teste;
  const faltam = teste.perguntas.filter(pergunta => estado.respostasTeste[pergunta.id] === undefined).length;
  if (faltam) {
    avisar('erro', `Responda todas as perguntas. ${faltam === 1 ? 'Falta 1.' : `Faltam ${faltam}.`}`);
    return desenhar();
  }
  await executar(botao, async () => {
    const { resultado } = await enviarJson(`/api/teste/${teste.id}/respostas`, { guildId: estado.guildId, respostas: estado.respostasTeste });
    teste.ultima = resultado;
    teste.refazendo = false;
    estado.respostasTeste = {};
    estado.testes = null;
    desenhar();
    document.querySelector('.principal')?.scrollTo?.(0, 0);
  });
}

function resultadoDoTeste(teste) {
  const ultima = teste.ultima;
  return el('section', { class: `cartao teste-resultado ${ultima.aprovado ? 'aprovado' : 'reprovado'}` },
    el('span', { class: 'teste-nota' }, `${porcento(ultima)}%`),
    el('div', null,
      el('h2', null, ultima.aprovado ? 'Aprovado' : 'Não foi desta vez'),
      el('p', null, `Você acertou ${ultima.acertos} de ${ultima.total}. Para passar é preciso ${teste.notaMinima}%.`),
      el('p', { class: 'sub' }, `Enviado em ${formatarData(ultima.em)}.`)),
    el('button', {
      type: 'button',
      onclick: () => {
        teste.refazendo = true;
        estado.respostasTeste = {};
        desenhar();
      }
    }, 'Fazer de novo'));
}

export function telaTeste() {
  if (!rotaAtual().id) return listaDeTestes();

  const teste = estado.teste;
  if (!teste) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso() || carregador('Carregando o teste')));

  const respondendo = !teste.ultima || teste.refazendo;
  const erradas = new Set(!respondendo ? teste.ultima.erradas : []);

  return el('main', { class: 'principal' },
    el('div', { class: 'teste' },
      voltar('Todos os testes', '#/teste'),
      el('header', null,
        el('h1', null, teste.titulo),
        teste.instrucoes && el('p', { class: 'sub texto-livre' }, teste.instrucoes)),
      blocoAviso(),
      teste.ultima && !teste.refazendo && resultadoDoTeste(teste),

      teste.video && el('section', { class: 'cartao teste-video' },
        el('h2', null, respondendo ? 'Assista antes de responder' : 'Vídeo do teste'),
        videoDoYoutube(teste.video)),

      el('ol', { class: 'teste-perguntas' }, teste.perguntas.map((pergunta, indice) =>
        el('li', { class: `cartao${erradas.has(pergunta.id) ? ' errada' : !respondendo ? ' certa' : ''}` },
          el('fieldset', { disabled: !respondendo },
            el('legend', null, el('span', { class: 'teste-numero' }, String(indice + 1)), pergunta.texto),
            pergunta.video && el('div', { class: 'teste-video teste-video-pergunta' }, videoDoYoutube(pergunta.video)),
            pergunta.opcoes.map((opcao, posicao) => el('label', { class: 'teste-opcao' },
              el('input', {
                type: 'radio',
                name: `pergunta-${pergunta.id}`,
                value: String(posicao),
                checked: estado.respostasTeste[pergunta.id] === posicao,
                // Marcar não redesenha a tela, para os vídeos não recomeçarem.
                onchange: () => {
                  estado.respostasTeste[pergunta.id] = posicao;
                }
              }),
              el('span', null, opcao))),
            !respondendo && el('p', { class: 'teste-correcao' }, erradas.has(pergunta.id) ? 'Você errou esta.' : 'Você acertou esta.'))))),

      respondendo && el('div', { class: 'acoes' },
        el('button', { class: 'primario', type: 'button', onclick: (evento) => enviarTeste(evento.currentTarget) }, 'Enviar respostas'),
        teste.refazendo && el('button', {
          type: 'button',
          onclick: () => {
            teste.refazendo = false;
            desenhar();
          }
        }, 'Cancelar'))));
}

// ---------------------------------------------------------------- responsável: lista
const TESTE_NOVO = () => ({ id: null, titulo: '', instrucoes: '', video: '', notaMinima: 70, ativo: true, perguntas: [{ texto: '', video: '', opcoes: ['', '', '', ''], correta: -1 }] });

export async function carregarTesteAdmin(id) {
  const guildId = estado.guildId;
  estado.testeAdmin = null;
  if (!id) estado.testesAdmin = null;
  try {
    if (!id) {
      const dados = await api(`/api/teste/admin?${parametros()}`);
      if (estado.guildId !== guildId) return;
      estado.testesAdmin = dados;
    } else if (id === 'novo') {
      estado.testeAdmin = { teste: TESTE_NOVO(), resultados: [], pessoas: {} };
    } else {
      const dados = await api(`/api/teste/admin/${encodeURIComponent(id)}?${parametros()}`);
      if (rotaAtual().id !== id || estado.guildId !== guildId) return;
      estado.testeAdmin = {
        ...dados,
        // Os campos de vídeo mostram um link, que é o que a pessoa cola.
        teste: { ...dados.teste, video: linkDoVideo(dados.teste.video), perguntas: dados.teste.perguntas.map(pergunta => ({ ...pergunta, video: linkDoVideo(pergunta.video) })) }
      };
    }
  } catch (erro) {
    avisar('erro', erro.message);
    if (id) return ir('#/teste-admin');
    estado.testesAdmin = { testes: [], limite: 0 };
  }
  desenhar();
}

function listaDeTestesAdmin() {
  const dados = estado.testesAdmin;
  if (!dados) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso() || carregador('Carregando os testes')));
  const { testes, limite } = dados;

  return el('main', { class: 'principal' },
    el('div', { class: 'teste teste-admin' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Testes da staff'),
          el('p', { class: 'sub' }, 'Cada teste tem título, perguntas e resultados próprios. A staff escolhe qual fazer e envia um de cada vez.')),
        testes.length < limite && el('button', { class: 'primario', type: 'button', onclick: () => ir('#/teste-admin/novo') }, icone('mais'), 'Novo teste')),
      blocoAviso(),
      !testes.length
        ? el('div', { class: 'vazio alto' },
          el('h3', null, 'Nenhum teste ainda'),
          el('p', null, 'Crie o primeiro: dê um título, cole os vídeos e escreva as perguntas.'),
          el('button', { class: 'primario', type: 'button', onclick: () => ir('#/teste-admin/novo') }, icone('mais'), 'Criar teste'))
        : el('ul', { class: 'testes-lista' }, testes.map(teste => el('li', null,
          el('button', { class: `teste-cartao ${teste.ativo ? '' : 'rascunho'}`, type: 'button', onclick: () => ir(`#/teste-admin/${teste.id}`) },
            el('span', { class: 'teste-cartao-texto' },
              el('strong', null, teste.titulo),
              el('small', null, [
                teste.perguntas === 1 ? '1 pergunta' : `${teste.perguntas} perguntas`,
                teste.comVideo ? (teste.comVideo === 1 ? '1 vídeo' : `${teste.comVideo} vídeos`) : 'sem vídeo',
                `passa com ${teste.notaMinima}%`
              ].join(', '))),
            el('span', { class: 'teste-cartao-situacao' },
              el('small', null, teste.responderam ? `${teste.aprovados} de ${teste.responderam} aprovados` : 'ninguém respondeu'),
              el('span', { class: `selo ${teste.ativo ? 'aceita' : 'pendente'}` }, teste.ativo ? 'Publicado' : 'Rascunho')),
            icone('avancar')))))));
}

// ---------------------------------------------------------------- responsável: editor
async function salvarTeste(botao) {
  const { teste } = estado.testeAdmin;
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/teste/admin', { guildId: estado.guildId, id: teste.id, teste });
    estado.testesAdmin = null;
    avisar('ok', resposta.mensagem);
    // Teste novo passa a ter endereço próprio; o que já existia é recarregado.
    if (!teste.id) {
      ir(`#/teste-admin/${resposta.id}`);
      // Depois da troca de tela, que limpa os avisos.
      setTimeout(() => avisar('ok', resposta.mensagem), 400);
      return;
    }
    await carregarTesteAdmin(resposta.id);
    avisar('ok', resposta.mensagem);
  });
}

async function apagarTeste(botao) {
  const { teste, resultados } = estado.testeAdmin;
  const confirmado = await confirmar({
    titulo: 'Apagar este teste?',
    texto: `O teste "${teste.titulo}" e ${resultados.length === 1 ? 'o resultado de 1 pessoa' : `os resultados de ${resultados.length} pessoas`} serão apagados. Não dá para desfazer.`,
    rotulo: 'Apagar teste',
    perigo: true
  });
  if (!confirmado) return;
  await executar(botao, async () => {
    const resposta = await api(`/api/teste/admin/${teste.id}?${parametros()}`, { method: 'DELETE' });
    estado.testesAdmin = null;
    ir('#/teste-admin');
    setTimeout(() => avisar('ok', resposta.mensagem), 300);
  });
}

// Campo ligado direto ao objeto em edição: digitar não redesenha a tela.
function campo(objeto, chave, props) {
  return el(props.linhas ? 'textarea' : 'input', {
    type: props.linhas ? null : (props.tipo || 'text'),
    id: props.id,
    'aria-label': props.rotulo,
    placeholder: props.exemplo,
    maxlength: props.limite ? String(props.limite) : null,
    min: props.min,
    max: props.max,
    rows: props.linhas ? String(props.linhas) : null,
    value: objeto[chave],
    oninput: (evento) => { objeto[chave] = evento.target.value; }
  });
}

function editorDePergunta(pergunta, indice, perguntas) {
  const mover = (para) => {
    perguntas.splice(para, 0, perguntas.splice(indice, 1)[0]);
    desenhar();
  };

  return el('li', { class: 'cartao teste-editor-pergunta' },
    el('header', null,
      el('span', { class: 'teste-numero' }, String(indice + 1)),
      campo(pergunta, 'texto', { rotulo: `Texto da pergunta ${indice + 1}`, exemplo: 'Escreva a pergunta', limite: 300 }),
      el('button', { class: 'so-icone', type: 'button', disabled: indice === 0, 'aria-label': 'Subir a pergunta', title: 'Subir', onclick: () => mover(indice - 1) }, icone('voltar')),
      el('button', { class: 'so-icone', type: 'button', disabled: indice === perguntas.length - 1, 'aria-label': 'Descer a pergunta', title: 'Descer', onclick: () => mover(indice + 1) }, icone('avancar')),
      el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': `Remover a pergunta ${indice + 1}`,
        title: 'Remover pergunta',
        onclick: () => {
          perguntas.splice(indice, 1);
          desenhar();
        }
      }, icone('lixeira'))),
    el('div', { class: 'teste-editor-video' },
      icone('tocar'),
      campo(pergunta, 'video', { rotulo: `Vídeo da pergunta ${indice + 1}`, exemplo: 'Vídeo desta pergunta (opcional): cole o link do YouTube', limite: 300 })),
    el('p', { class: 'dica' }, 'Marque a bolinha da alternativa certa.'),
    el('div', { class: 'teste-editor-opcoes' }, pergunta.opcoes.map((_, posicao) => el('div', null,
      el('input', {
        type: 'radio',
        name: `certa-${indice}`,
        'aria-label': `Alternativa ${posicao + 1} é a certa`,
        checked: pergunta.correta === posicao,
        onchange: () => { pergunta.correta = posicao; }
      }),
      campo(pergunta.opcoes, posicao, { rotulo: `Alternativa ${posicao + 1} da pergunta ${indice + 1}`, exemplo: `Alternativa ${posicao + 1}`, limite: 200 }),
      pergunta.opcoes.length > 2 && el('button', {
        class: 'so-icone',
        type: 'button',
        'aria-label': `Remover a alternativa ${posicao + 1}`,
        onclick: () => {
          pergunta.opcoes.splice(posicao, 1);
          // A marcação da certa acompanha a alternativa, ou fica sem marcar se era a removida.
          pergunta.correta = pergunta.correta === posicao ? -1 : pergunta.correta > posicao ? pergunta.correta - 1 : pergunta.correta;
          desenhar();
        }
      }, icone('fechar'))))),
    pergunta.opcoes.length < 6 && el('button', {
      class: 'discreto',
      type: 'button',
      onclick: () => {
        pergunta.opcoes.push('');
        desenhar();
      }
    }, icone('mais'), 'Adicionar alternativa'));
}

export function telaTesteAdmin() {
  if (!rotaAtual().id) return listaDeTestesAdmin();

  const dados = estado.testeAdmin;
  if (!dados) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso() || carregador('Carregando o teste')));

  const { teste, resultados, pessoas } = dados;
  const aprovados = resultados.filter(item => item.aprovado).length;
  const novo = !teste.id;

  return el('main', { class: 'principal' },
    el('div', { class: 'teste teste-admin' },
      voltar('Todos os testes', '#/teste-admin'),
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, novo ? 'Novo teste' : 'Editar teste'),
          el('p', { class: 'sub' }, 'A staff vê os vídeos e as perguntas; a alternativa certa só fica aqui.')),
        el('div', { class: 'acoes' },
          !novo && el('button', { class: 'perigo', type: 'button', onclick: (evento) => apagarTeste(evento.currentTarget) }, 'Apagar'),
          el('button', { class: 'primario', type: 'button', onclick: (evento) => salvarTeste(evento.currentTarget) }, novo ? 'Criar teste' : 'Salvar teste'))),
      blocoAviso(),

      el('section', { class: 'cartao teste-editor-geral' },
        el('div', { class: 'campo' }, el('label', { for: 'teste-titulo' }, 'Título'),
          campo(teste, 'titulo', { id: 'teste-titulo', rotulo: 'Título do teste', exemplo: 'Ex.: Regras de abordagem', limite: 80 })),
        el('div', { class: 'campo' }, el('label', { for: 'teste-video' }, 'Vídeo de abertura'),
          campo(teste, 'video', { id: 'teste-video', rotulo: 'Link do vídeo de abertura', exemplo: 'https://youtu.be/…', limite: 300 }),
          el('p', { class: 'dica' }, 'Opcional. Aparece antes das perguntas. Cada pergunta também pode ter o seu vídeo.')),
        el('div', { class: 'campo' }, el('label', { for: 'teste-nota' }, 'Nota mínima para passar (%)'),
          campo(teste, 'notaMinima', { id: 'teste-nota', rotulo: 'Nota mínima', tipo: 'number', min: '1', max: '100' })),
        el('div', { class: 'campo' }, el('label', { for: 'teste-instrucoes' }, 'Instruções'),
          campo(teste, 'instrucoes', { id: 'teste-instrucoes', rotulo: 'Instruções', exemplo: 'O que a staff precisa saber antes de começar', limite: 600, linhas: 3 })),
        el('label', { class: 'teste-publicado' },
          el('input', {
            type: 'checkbox', id: 'teste-ativo', checked: teste.ativo,
            onchange: (evento) => { teste.ativo = evento.target.checked; }
          }),
          el('span', null, el('strong', null, 'Publicado'), el('small', null, 'Desmarcado, o teste fica como rascunho e a staff não vê.')))),

      el('h2', { class: 'teste-secao' }, `Perguntas (${teste.perguntas.length})`),
      el('ol', { class: 'teste-perguntas' }, teste.perguntas.map((pergunta, indice) => editorDePergunta(pergunta, indice, teste.perguntas))),
      el('div', { class: 'acoes' },
        teste.perguntas.length < 40 && el('button', {
          type: 'button',
          onclick: () => {
            teste.perguntas.push({ texto: '', video: '', opcoes: ['', '', '', ''], correta: -1 });
            desenhar();
          }
        }, icone('mais'), 'Adicionar pergunta'),
        el('button', { class: 'primario', type: 'button', onclick: (evento) => salvarTeste(evento.currentTarget) }, novo ? 'Criar teste' : 'Salvar teste')),

      !novo && el('section', { class: 'cartao' },
        el('h2', null, `Resultados deste teste (${aprovados} de ${resultados.length} aprovados)`),
        resultados.length
          ? el('ul', { class: 'teste-resultados' }, resultados.map(item => {
            const pessoa = pessoas[item.usuarioId];
            return el('li', null,
              avatar({ id: item.usuarioId, nome: pessoa?.nome || 'Staff', url: pessoa?.avatar }),
              el('span', null,
                nomeColorido(pessoa?.nome || 'Staff', pessoa?.cor),
                el('small', null, `${item.acertos} de ${item.total}, ${formatarData(item.em)}${item.tentativas > 1 ? `, ${item.tentativas} tentativas` : ''}`)),
              el('strong', null, `${porcento(item)}%`),
              el('span', { class: `selo ${item.aprovado ? 'aceita' : 'recusada'}` }, item.aprovado ? 'Aprovado' : 'Reprovado'));
          }))
          : el('p', { class: 'sub' }, 'Ninguém respondeu ainda.'))));
}
