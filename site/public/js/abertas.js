// Denúncias abertas a todos, em que o acusado pode se identificar.
import { identificarSe } from './acoes.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { ir } from './rotas.js';
import { el, formatarData, icone, numeroDoCaso, selo } from './util.js';

export function telaIdentificar() {
  const dados = estado.naoIdentificadas;
  const lista = dados?.denuncias || [];
  // As que batem com o ID da pessoa sobem para o topo.
  const ordenada = [...lista].sort((a, b) => Number(b.ehVoce) - Number(a.ehVoce));

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Denúncias abertas'),
            el('p', { class: 'sub' }, 'Denúncias em andamento em que nem todos os acusados estão ligados a uma conta do Discord. Qualquer membro pode abrir e falar, como no tópico. Se o ID acusado for o seu, identifique-se.'))),
        dados && el('p', { class: `identidade${dados.minhaConta ? '' : ' sem-id'}` },
          icone('usuario'),
          dados.minhaConta
            ? el('span', null, 'Seu ID no servidor: ', el('strong', null, dados.minhaConta), '. O botão "Sou eu" aparece nas denúncias contra esse ID.')
            : el('span', null, 'Seu apelido no servidor não tem o ID da conta. Use /menu dentro do jogo para corrigir; sem ele não dá para se identificar como acusado.')),
        blocoAviso(),
        !dados
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1, 2].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : !ordenada.length
            ? el('div', { class: 'vazio' }, el('h3', null, 'Nenhuma denúncia aberta'),
              el('p', null, 'Todas as denúncias em andamento já têm os acusados identificados.'))
            : el('div', { class: 'tabela', role: 'list' }, ordenada.map(denuncia =>
              el('div', { class: `linha identificar${denuncia.ehVoce ? ' voce' : ''}`, role: 'listitem' },
                el('span', { class: 'celula caso-ref' },
                  el('strong', null, numeroDoCaso(denuncia.id)),
                  el('span', null, formatarData(denuncia.dataCriacao))),
                el('span', { class: 'celula caso-motivo' },
                  el('span', { class: 'plataforma' }, icone(denuncia.platform === 'Mobile' ? 'celular' : 'monitor')),
                  el('span', { class: 'celula-texto' },
                    el('strong', null, `Acusado ${denuncia.acusado}`),
                    el('span', null, `${denuncia.motivo || denuncia.categoria}, ${denuncia.platform}`))),
                el('span', { class: 'celula caso-status' }, selo(denuncia.status)),
                el('span', { class: 'identificar-acoes' },
                  denuncia.ehVoce && el('button', { class: 'primario', type: 'button', onclick: (evento) => identificarSe(evento.currentTarget, denuncia) }, 'Sou eu'),
                  el('button', { type: 'button', onclick: () => ir(`#/d/${denuncia.id}`) }, 'Abrir'))))))));
}
