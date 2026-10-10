// Teste da staff: a staff assiste ao vídeo e responde; o responsável monta o
// teste (vídeo, perguntas e respostas) e vê os resultados.
import { executar } from './acoes.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { rotaAtual } from './rotas.js';
import { api, avatar, avisar, el, enviarJson, formatarData, icone, nomeColorido, videoDoYoutube } from './util.js';

const parametros = () => new URLSearchParams({ guildId: estado.guildId });
const carregador = (rotulo) => el('div', { class: 'carregador', role: 'status', 'aria-label': rotulo }, el('span'), el('span'), el('span'));
const porcento = (item) => Math.round((item.acertos / item.total) * 100);

// ---------------------------------------------------------------- staff
export async function carregarTeste() {
  const guildId = estado.guildId;
  estado.teste = null;
  estado.respostasTeste = {};
  try {
    const dados = await api(`/api/teste?${parametros()}`);
    if (rotaAtual().tipo !== 'teste' || estado.guildId !== guildId) return;
    estado.teste = dados;
  } catch (erro) {
    estado.teste = { configurado: false };
    avisar('erro', erro.message);
  }
  desenhar();
}

async function enviarTeste(botao) {
  const teste = estado.teste;
  const faltam = teste.perguntas.filter(pergunta => estado.respostasTeste[pergunta.id] === undefined).length;
  if (faltam) {
    avisar('erro', `Responda todas as perguntas. ${faltam === 1 ? 'Falta 1.' : `Faltam ${faltam}.`}`);
    return desenhar();
  }
  await executar(botao, async () => {
    const { resultado } = await enviarJson('/api/teste/respostas', { guildId: estado.guildId, respostas: estado.respostasTeste });
    estado.teste.ultima = resultado;
    estado.teste.refazendo = false;
    estado.respostasTeste = {};
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
  const teste = estado.teste;
  if (!teste) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, carregador('Carregando o teste')));

  if (!teste.configurado) {
    return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso(), el('div', { class: 'vazio alto' },
      el('h3', null, 'Ainda não há teste'),
      el('p', null, 'O responsável deste servidor ainda não montou o teste da staff.'))));
  }

  const respondendo = !teste.ultima || teste.refazendo;
  const erradas = new Set(!respondendo ? teste.ultima.erradas : []);

  return el('main', { class: 'principal' },
    el('div', { class: 'teste' },
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
            pergunta.opcoes.map((opcao, posicao) => el('label', { class: 'teste-opcao' },
              el('input', {
                type: 'radio',
                name: `pergunta-${pergunta.id}`,
                value: String(posicao),
                checked: estado.respostasTeste[pergunta.id] === posicao,
                // Marcar não redesenha a tela, para o vídeo não recomeçar.
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

// ---------------------------------------------------------------- responsável
export async function carregarTesteAdmin() {
  estado.testeAdmin = null;
  try {
    const dados = await api(`/api/teste/admin?${parametros()}`);
    estado.testeAdmin = {
      ...dados,
      // O campo de vídeo mostra um link, que é o que a pessoa cola.
      teste: { ...dados.teste, video: dados.teste.video ? `https://youtu.be/${dados.teste.video}` : '' }
    };
  } catch (erro) {
    avisar('erro', erro.message);
  }
  desenhar();
}

async function salvarTeste(botao) {
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/teste/admin', { guildId: estado.guildId, teste: estado.testeAdmin.teste });
    await carregarTesteAdmin();
    avisar('ok', resposta.mensagem);
    desenhar();
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
  const dados = estado.testeAdmin;
  if (!dados) return el('main', { class: 'principal' }, el('div', { class: 'teste' }, blocoAviso() || carregador('Carregando o teste')));

  const { teste, resultados, pessoas } = dados;
  const aprovados = resultados.filter(item => item.aprovado).length;

  return el('main', { class: 'principal' },
    el('div', { class: 'teste teste-admin' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Teste da staff'),
          el('p', { class: 'sub' }, 'Monte o teste deste servidor. A staff vê o vídeo e as perguntas; a alternativa certa só fica aqui.')),
        el('button', { class: 'primario', type: 'button', onclick: (evento) => salvarTeste(evento.currentTarget) }, 'Salvar teste')),
      blocoAviso(),

      el('section', { class: 'cartao teste-editor-geral' },
        el('div', { class: 'campo' }, el('label', { for: 'teste-titulo' }, 'Título'),
          campo(teste, 'titulo', { id: 'teste-titulo', rotulo: 'Título do teste', limite: 80 })),
        el('div', { class: 'campo' }, el('label', { for: 'teste-video' }, 'Vídeo do YouTube'),
          campo(teste, 'video', { id: 'teste-video', rotulo: 'Link do vídeo', exemplo: 'https://youtu.be/…', limite: 300 }),
          el('p', { class: 'dica' }, 'Opcional. Cole o link do vídeo que a staff deve assistir antes de responder.')),
        el('div', { class: 'campo' }, el('label', { for: 'teste-nota' }, 'Nota mínima para passar (%)'),
          campo(teste, 'notaMinima', { id: 'teste-nota', rotulo: 'Nota mínima', tipo: 'number', min: '1', max: '100' })),
        el('div', { class: 'campo' }, el('label', { for: 'teste-instrucoes' }, 'Instruções'),
          campo(teste, 'instrucoes', { id: 'teste-instrucoes', rotulo: 'Instruções', exemplo: 'O que a staff precisa saber antes de começar', limite: 600, linhas: 3 }))),

      el('h2', { class: 'teste-secao' }, `Perguntas (${teste.perguntas.length})`),
      el('ol', { class: 'teste-perguntas' }, teste.perguntas.map((pergunta, indice) => editorDePergunta(pergunta, indice, teste.perguntas))),
      el('div', { class: 'acoes' },
        teste.perguntas.length < 40 && el('button', {
          type: 'button',
          onclick: () => {
            teste.perguntas.push({ texto: '', opcoes: ['', '', '', ''], correta: -1 });
            desenhar();
          }
        }, icone('mais'), 'Adicionar pergunta'),
        el('button', { class: 'primario', type: 'button', onclick: (evento) => salvarTeste(evento.currentTarget) }, 'Salvar teste')),

      el('section', { class: 'cartao' },
        el('h2', null, `Resultados (${aprovados} de ${resultados.length} aprovados)`),
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
