// Sessões da conta: onde a pessoa está logada e o botão para encerrar as
// outras. Vale para qualquer pessoa, não só para a staff.
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { api, avisar, el, enviarJson, formatarData } from './util.js';

export async function carregarSessoes() {
  estado.sessoes = null;
  try {
    estado.sessoes = await api('/api/sessoes');
  } catch (erro) {
    avisar('erro', erro.message);
    estado.sessoes = { sessoes: [], semIdentificador: false };
  }
  desenhar();
}

// "Chrome no Windows" a partir do que o navegador informa.
export function navegador(agente) {
  const texto = String(agente || '');
  const nome = /Edg\//.test(texto) ? 'Edge' : /OPR\//.test(texto) ? 'Opera' : /Firefox\//.test(texto) ? 'Firefox' : /Chrome\//.test(texto) ? 'Chrome' : /Safari\//.test(texto) ? 'Safari' : 'Navegador';
  const sistema = /Android/.test(texto) ? 'Android' : /iPhone|iPad/.test(texto) ? 'iOS' : /Windows/.test(texto) ? 'Windows' : /Mac OS/.test(texto) ? 'macOS' : /Linux/.test(texto) ? 'Linux' : '';
  return sistema ? `${nome} no ${sistema}` : nome;
}

async function encerrar(botao, corpo, pergunta) {
  if (pergunta && !await confirmar(pergunta)) return;
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/sessoes/encerrar', corpo);
    await carregarSessoes();
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

export function telaSessoes() {
  const dados = estado.sessoes;
  const outras = (dados?.sessoes || []).filter(item => !item.atual);

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h1', null, 'Sessões da conta'),
            el('p', { class: 'sub' }, 'Aparelhos em que você entrou no site nos últimos 7 dias. Se não reconhecer algum, encerre a sessão dele.')),
          outras.length > 0 && el('button', {
            class: 'perigo', type: 'button',
            onclick: (evento) => encerrar(evento.currentTarget, { outras: true }, {
              titulo: 'Encerrar as outras sessões?',
              texto: `${outras.length === 1 ? 'O outro aparelho será desconectado' : `Os outros ${outras.length} aparelhos serão desconectados`} e vai precisar entrar de novo. Este aparelho continua logado.`,
              rotulo: 'Encerrar as outras',
              perigo: true
            })
          }, 'Encerrar as outras')),
        blocoAviso(),
        !dados
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : [
            dados.semIdentificador && el('p', { class: 'sub sessoes-nota' }, 'Você entrou neste aparelho antes de esta tela existir, por isso ele não aparece na lista. Saia da conta e entre de novo para ele passar a aparecer.'),
            !dados.sessoes.length
              ? el('div', { class: 'vazio' }, el('h3', null, 'Nenhuma sessão registrada'), el('p', null, 'As próximas entradas no site aparecem aqui.'))
              : el('ol', { class: 'acoes-lista logins-lista' }, dados.sessoes.map(item => el('li', { class: item.atual ? 'sessao-atual' : '' },
                el('span', { class: 'logins-quem' },
                  el('strong', null, navegador(item.agente), item.atual && el('span', { class: 'teste-etiqueta sessao-etiqueta' }, 'Este aparelho')),
                  el('small', null, `Entrou em ${formatarData(item.em)}. Último uso em ${formatarData(item.vistaEm)}.`)),
                el('span', { class: 'logins-ip' }, el('code', null, item.ip || 'sem IP')),
                item.atual
                  ? el('span', { class: 'sub' }, 'em uso')
                  : el('button', { type: 'button', onclick: (evento) => encerrar(evento.currentTarget, { id: item.id }) }, 'Encerrar'))))
          ])));
}
