// Ferramentas do responsável: saúde do bot (com os tópicos do Discord),
// registro de logins, metas da staff e backup das configurações.
import { executar } from './acoes.js';
import { confirmar } from './confirmacao.js';
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { blocoAviso } from './navegacao.js';
import { rotaAtual } from './rotas.js';
import { api, avisar, el, enviarJson, formatarData, icone } from './util.js';

const comServidor = (caminho, extra = {}) => `${caminho}?${new URLSearchParams({ guildId: estado.guildId, ...extra })}`;
const esqueleto = (rotulo) => el('div', { class: 'caso esqueleto-detalhe', 'aria-busy': 'true', 'aria-label': rotulo }, el('span'), el('span'), el('span'), el('span'));

function duracao(ms) {
  const minutos = Math.floor(ms / 60000);
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  if (dias) return `${dias} d ${horas} h`;
  if (horas) return `${horas} h ${minutos % 60} min`;
  return `${Math.max(1, minutos)} min`;
}

// ---------------------------------------------------------------- saúde do bot
let acompanhando = null;

export async function carregarSaude({ atualizarTopicos = false } = {}) {
  const guildId = estado.guildId;
  const [saude, erros, topicos] = await Promise.all([
    api(comServidor('/api/saude')).catch((erro) => { avisar('erro', erro.message); return null; }),
    api(comServidor('/api/erros')).catch(() => null),
    api(comServidor('/api/topicos', atualizarTopicos ? { atualizar: '1' } : {})).catch(() => null)
  ]);
  if (estado.guildId !== guildId) return;
  estado.saude = saude;
  estado.erros = erros;
  estado.topicos = topicos;
  desenhar();

  // Com a limpeza rodando, a tela acompanha o andamento sozinha.
  clearTimeout(acompanhando);
  if (topicos?.limpeza.rodando && rotaAtual().tipo === 'saude') acompanhando = setTimeout(() => carregarSaude({ atualizarTopicos: false }), 5000);
}

async function limparTopicos(botao, antigos) {
  const confirmado = await confirmar({
    titulo: 'Fechar os tópicos antigos?',
    texto: `Serão trancados e arquivados ${antigos} tópico(s) de denúncia e de espelho abertos há 7 dias ou mais. Tópicos mais novos e os de denúncias ainda abertas não são mexidos. O bot fecha cerca de um por segundo.`,
    rotulo: 'Limpar agora'
  });
  if (!confirmado) return;
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/topicos/limpar', { guildId: estado.guildId });
    avisar('ok', resposta.mensagem);
    await carregarSaude();
  });
}

// Barra de progresso. A largura entra por JavaScript: a política de segurança
// do site não aceita style escrito no HTML.
function barra(parte, rotulo) {
  const cheio = el('span');
  cheio.style.width = `${parte}%`;
  return el('div', { class: 'topicos-barra', role: 'img', 'aria-label': rotulo }, cheio);
}

function indicador(rotulo, valor, detalhe, tom) {
  return el('div', { class: `saude-item ${tom || ''}` }, el('span', null, rotulo), el('strong', null, valor), detalhe && el('small', null, detalhe));
}

function blocoDeTopicos() {
  const dados = estado.topicos;
  if (!dados) return el('section', { class: 'cartao' }, el('h2', null, 'Tópicos do Discord'), el('p', { class: 'sub' }, 'Não foi possível consultar os tópicos agora.'));

  const antigos = dados.servidores.reduce((soma, servidor) => soma + servidor.antigos, 0);
  const { limpeza } = dados;

  return el('section', { class: 'cartao' },
    el('header', { class: 'saude-cabecalho' },
      el('div', null,
        el('h2', null, 'Tópicos do Discord'),
        el('p', { class: 'sub' }, 'O Discord aceita no máximo 1000 tópicos ativos por servidor. Chegando lá, o bot não consegue criar o tópico de uma denúncia nova nem o espelho dela.')),
      el('div', { class: 'acoes' },
        el('button', { type: 'button', onclick: (evento) => executar(evento.currentTarget, () => carregarSaude({ atualizarTopicos: true })) }, 'Atualizar'),
        el('button', { class: 'primario', type: 'button', disabled: limpeza.rodando || !antigos, onclick: (evento) => limparTopicos(evento.currentTarget, antigos) }, 'Limpar agora'))),

    limpeza.rodando
      ? el('p', { class: 'saude-andamento', role: 'status' }, `Limpeza em andamento: ${limpeza.fechados} de ${limpeza.previstos} tópico(s) fechado(s).`)
      : el('p', { class: 'sub' }, antigos
        ? `"Limpar agora" fecha ${antigos} tópico(s) de denúncia e de espelho abertos há 7 dias ou mais.`
        : 'Nenhum tópico de denúncia ou de espelho aberto há 7 dias ou mais.'),

    el('ul', { class: 'topicos-lista' }, dados.servidores.map((servidor) => {
      const parte = Math.min(100, Math.round(servidor.ativos / servidor.limite * 100));
      const tom = parte >= 90 ? 'critico' : parte >= 70 ? 'atencao' : 'ok';
      return el('li', { class: tom },
        el('div', { class: 'topicos-linha' },
          el('strong', null, servidor.nome),
          el('span', null, `${servidor.ativos} de ${servidor.limite}`)),
        barra(parte, `${parte}% do limite`),
        el('small', null, `${servidor.deDenuncias} de denúncias e espelhos, ${servidor.antigos} com 7 dias ou mais.`));
    })),
    dados.conferidoEm && el('p', { class: 'sub saude-rodape' }, `Conferido em ${formatarData(dados.conferidoEm)}.`));
}

// Últimos erros e avisos do bot e do site (ficam na memória desde que o bot ligou).
function blocoDeErros() {
  const dados = estado.erros;
  if (!dados) return null;
  const erros = dados.registros.filter(item => item.nivel === 'erro').length;
  const visiveis = dados.registros.filter(item => estado.filtroErros === 'todos' || item.nivel === estado.filtroErros);
  const aba = (chave, rotulo) => el('button', {
    class: 'filtro', type: 'button', 'aria-pressed': String(estado.filtroErros === chave),
    onclick: () => {
      estado.filtroErros = chave;
      desenhar();
    }
  }, rotulo);

  return el('section', { class: 'cartao' },
    el('header', { class: 'saude-cabecalho' },
      el('div', null,
        el('h2', null, 'Erros e avisos recentes'),
        el('p', { class: 'sub' }, `O que o bot e o site registraram desde que ligaram, há ${duracao(dados.ligadoHaMs)}. A lista some quando o bot reinicia; senhas e tokens são escondidos.`))),
    dados.registros.length > 0 && el('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar por tipo' },
      aba('todos', `Todos (${dados.registros.length})`), aba('erro', `Erros (${erros})`), aba('aviso', `Avisos (${dados.registros.length - erros})`)),
    !visiveis.length
      ? el('p', { class: 'sub erros-vazio' }, dados.registros.length ? 'Nada neste filtro.' : 'Nenhum erro ou aviso desde que o bot ligou.')
      : el('ol', { class: 'erros-lista' }, visiveis.map(item => el('li', { class: item.nivel },
        el('span', { class: 'erros-nivel' }, item.nivel === 'erro' ? 'Erro' : 'Aviso'),
        el('code', null, item.texto),
        el('span', { class: 'erros-quando' }, el('time', { datetime: item.em }, formatarData(item.em)), item.vezes > 1 && el('small', null, `${item.vezes} vezes`))))));
}

export function telaSaude() {
  const saude = estado.saude;
  if (!saude) return el('main', { class: 'principal' }, blocoAviso() || esqueleto('Carregando a saúde do bot'));

  const bancosOk = saude.bancos.every(banco => banco.estado === 'conectado');
  const pausa = saude.dms.pausadaAte;

  return el('main', { class: 'principal' },
    el('div', { class: 'config gestao' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Saúde do bot'),
          el('p', { class: 'sub' }, `Versão ${saude.versao}, ligado há ${duracao(saude.ligadoHaMs)}. Estes números são do bot inteiro, não só deste servidor.`)),
        el('div', { class: 'acoes' }, el('button', { type: 'button', onclick: (evento) => executar(evento.currentTarget, () => carregarSaude()) }, 'Atualizar'))),
      blocoAviso(),

      el('section', { class: 'saude-grade' },
        indicador('Discord', saude.discord.conectado ? 'Conectado' : 'Desconectado', saude.discord.latenciaMs >= 0 ? `${saude.discord.latenciaMs} ms de resposta, ${saude.discord.servidores} servidor(es)` : `${saude.discord.servidores} servidor(es)`, saude.discord.conectado ? 'ok' : 'critico'),
        indicador('Bancos de dados', bancosOk ? 'Conectados' : 'Com problema', saude.bancos.map(banco => `${banco.nome}: ${banco.estado}`).join(', '), bancosOk ? 'ok' : 'critico'),
        indicador('Memória', `${saude.memoria.usadaMb} MB`, `${saude.memoria.heapMb} MB em uso pelo código`, saude.memoria.usadaMb > 2400 ? 'critico' : saude.memoria.usadaMb > 1800 ? 'atencao' : 'ok'),
        indicador('Fila do finalizador', saude.finalizador.naFila === null ? 'Sem dados' : String(saude.finalizador.naFila), 'denúncias com 7 dias ou mais esperando a finalização automática', saude.finalizador.naFila > 200 ? 'atencao' : 'ok'),
        indicador('Denúncias em aberto', saude.finalizador.abertas === null ? 'Sem dados' : String(saude.finalizador.abertas), 'pendentes, reivindicadas ou em análise, em todos os servidores'),
        indicador('Mensagens diretas', pausa ? 'Pausadas' : 'Liberadas',
          pausa ? `O Discord limitou as DMs do bot. Nova tentativa depois de ${formatarData(pausa)}.` : saude.dms.avisosExtras ? 'Avisos extras por DM ligados.' : 'Avisos extras por DM desligados (padrão).',
          pausa ? 'critico' : 'ok')),

      blocoDeTopicos(),
      blocoDeErros()));
}

// ---------------------------------------------------------------- registro de logins
export async function carregarLogins() {
  const guildId = estado.guildId;
  const dados = await api(comServidor('/api/logins')).catch((erro) => { avisar('erro', erro.message); return { logins: [] }; });
  if (estado.guildId !== guildId) return;
  estado.logins = dados.logins;
  desenhar();
}

// "Chrome no Windows" a partir do que o navegador informa.
function navegador(agente) {
  const texto = String(agente || '');
  const nome = /Edg\//.test(texto) ? 'Edge' : /OPR\//.test(texto) ? 'Opera' : /Firefox\//.test(texto) ? 'Firefox' : /Chrome\//.test(texto) ? 'Chrome' : /Safari\//.test(texto) ? 'Safari' : 'Navegador';
  const sistema = /Android/.test(texto) ? 'Android' : /iPhone|iPad/.test(texto) ? 'iOS' : /Windows/.test(texto) ? 'Windows' : /Mac OS/.test(texto) ? 'macOS' : /Linux/.test(texto) ? 'Linux' : '';
  return sistema ? `${nome} no ${sistema}` : nome;
}

export function telaLogins() {
  const logins = estado.logins;
  const filtro = (estado.filtroLogins || '').trim().toLowerCase();
  const visiveis = (logins || []).filter(item => !filtro || [item.nome, item.ip, item.usuarioId].some(campo => String(campo || '').toLowerCase().includes(filtro)));
  // Mesmo IP usado por contas diferentes chama atenção: pode ser conta compartilhada.
  const contasPorIp = new Map();
  for (const item of logins || []) contasPorIp.set(item.ip, (contasPorIp.get(item.ip) || new Set()).add(item.usuarioId));

  return el('main', { class: 'principal' },
    el('div', { class: 'ranking' },
      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h1', null, 'Registro de logins'),
            el('p', { class: 'sub' }, 'Cada entrada no site de membros deste servidor: quem, quando e de qual IP. Fica guardado por 30 dias. Quando alguém da staff entra de um IP que a conta nunca usou, você é avisado pelas notificações do navegador.'))),
        blocoAviso(),
        logins && logins.length > 0 && el('div', { class: 'tabela-ferramentas' },
          el('label', null, el('span', null, 'Filtrar'),
            el('input', {
              id: 'filtro-logins', type: 'search', placeholder: 'Nome, IP ou ID do Discord', value: estado.filtroLogins || '',
              oninput: (evento) => {
                estado.filtroLogins = evento.target.value;
                desenhar();
              }
            }))),
        !logins
          ? el('div', { class: 'tabela', 'aria-busy': 'true' }, [0, 1, 2].map(() => el('div', { class: 'linha esqueleto' }, el('span'), el('span'), el('span'))))
          : !visiveis.length
            ? el('div', { class: 'vazio' }, el('h3', null, logins.length ? 'Nada com esse filtro' : 'Nenhum login registrado'), el('p', null, logins.length ? 'Mude o texto do filtro.' : 'As próximas entradas no site aparecem aqui.'))
            : el('ol', { class: 'acoes-lista logins-lista' }, visiveis.map(item => el('li', null,
              el('span', { class: 'logins-quem' }, el('strong', null, item.nome || item.usuarioId), el('small', null, navegador(item.agente))),
              el('span', { class: 'logins-ip' },
                el('code', null, item.ip || 'sem IP'),
                item.ipNovo && el('small', { class: `logins-alerta${item.staff ? ' forte' : ''}`, title: 'A conta nunca tinha entrado deste IP' }, item.staff ? 'IP novo para esta conta da staff' : 'IP novo para esta conta'),
                contasPorIp.get(item.ip)?.size > 1 && el('small', { class: 'logins-alerta', title: 'Este IP foi usado por mais de uma conta' }, `${contasPorIp.get(item.ip).size} contas neste IP`)),
              el('time', { datetime: item.em }, formatarData(item.em))))))));
}

// ---------------------------------------------------------------- metas da staff
export async function carregarMetas() {
  const guildId = estado.guildId;
  const dados = await api(comServidor('/api/metas')).catch((erro) => { avisar('erro', erro.message); return null; });
  if (estado.guildId !== guildId) return;
  estado.metas = dados && { ...dados, edicao: String(dados.minimoSemanal) };
  desenhar();
}

async function salvarMeta(botao) {
  const minimo = Number(estado.metas.edicao);
  if (!Number.isInteger(minimo) || minimo < 0 || minimo > 1000) return avisar('erro', 'A meta precisa ser um número inteiro entre 0 e 1000.');
  await executar(botao, async () => {
    const resposta = await enviarJson('/api/metas', { guildId: estado.guildId, minimoSemanal: minimo });
    estado.metas = { ...resposta, edicao: String(resposta.minimoSemanal) };
    avisar('ok', resposta.mensagem);
    desenhar();
  });
}

export function telaMetas() {
  const metas = estado.metas;
  if (!metas) return el('main', { class: 'principal' }, blocoAviso() || esqueleto('Carregando as metas'));
  const temMeta = metas.minimoSemanal > 0;

  return el('main', { class: 'principal' },
    el('div', { class: 'config gestao' },
      el('header', { class: 'config-topo' },
        el('div', null,
          el('h1', null, 'Metas da staff'),
          el('p', { class: 'sub' }, 'Atendimento é cada denúncia diferente em que a pessoa reivindicou, analisou, aceitou ou recusou. A conta é dos últimos 7 dias.'))),
      blocoAviso(),

      el('section', { class: 'cartao' },
        el('h2', null, 'Meta semanal'),
        el('p', { class: 'sub' }, 'Mínimo de atendimentos por pessoa a cada 7 dias. Use 0 para não ter meta.'),
        el('div', { class: 'metas-form' },
          el('input', {
            id: 'meta-minimo', type: 'number', min: '0', max: '1000', step: '1', 'aria-label': 'Mínimo de atendimentos por semana', value: metas.edicao,
            oninput: (evento) => { metas.edicao = evento.target.value; }
          }),
          el('button', { class: 'primario', type: 'button', onclick: (evento) => salvarMeta(evento.currentTarget) }, 'Salvar meta'))),

      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, temMeta ? (metas.abaixo ? `${metas.abaixo} abaixo da meta` : 'Todos dentro da meta') : 'Atendimentos da semana'),
            el('p', { class: 'sub' }, temMeta ? `Meta: ${metas.minimoSemanal} por semana. Quem atendeu menos aparece primeiro.` : 'Sem meta definida. Quem atendeu menos aparece primeiro.'))),
        !metas.linhas.length
          ? el('div', { class: 'vazio' }, el('h3', null, 'Ninguém na equipe'), el('p', null, 'Defina os cargos de staff e de responsável no painel do bot.'))
          : el('ol', { class: 'metas-lista' }, metas.linhas.map((linha) => {
            const abaixo = temMeta && linha.naEquipe && linha.faltam > 0;
            const parte = temMeta ? Math.min(100, Math.round(linha.atendimentos / metas.minimoSemanal * 100)) : 100;
            return el('li', { class: abaixo ? 'abaixo' : 'ok' },
              el('span', { class: 'metas-quem' },
                el('strong', null, linha.nome),
                !linha.naEquipe && el('small', null, 'não está mais na equipe')),
              temMeta && barra(parte, `${parte}% da meta`),
              el('span', { class: 'metas-numero' },
                el('strong', null, String(linha.atendimentos)),
                el('small', null, abaixo ? (linha.faltam === 1 ? 'falta 1' : `faltam ${linha.faltam}`) : temMeta && linha.naEquipe ? 'meta batida' : linha.atendimentos === 1 ? 'atendimento' : 'atendimentos')));
          }))),

      el('section', { class: 'cartao cartao-tabela' },
        el('header', { class: 'cartao-cabecalho' },
          el('div', null,
            el('h2', null, 'Qualidade das decisões'),
            el('p', { class: 'sub' }, 'Últimos 30 dias. Uma decisão conta como revertida quando, depois dela, a mesma denúncia recebeu a decisão contrária (aceita virou recusada, ou o inverso). A nota é a média das avaliações dos jogadores.'))),
        !(metas.qualidade || []).length
          ? el('div', { class: 'vazio' }, el('h3', null, 'Sem decisões no período'), el('p', null, 'Quando a staff aceitar ou recusar denúncias, os números aparecem aqui.'))
          : el('ol', { class: 'metas-lista qualidade-lista' }, metas.qualidade.map((linha) => {
            const parte = Math.round(linha.taxa * 100);
            return el('li', { class: linha.revertidas ? (parte >= 20 ? 'abaixo' : 'atencao') : 'ok' },
              el('span', { class: 'metas-quem' },
                el('strong', null, linha.nome),
                el('small', null, `${linha.decisoes} ${linha.decisoes === 1 ? 'decisão' : 'decisões'}${linha.nota ? `, nota ${linha.nota.toFixed(1)} em ${linha.avaliacoes} avaliação(ões)` : ', sem avaliações'}`)),
              barra(Math.min(100, parte), `${parte}% revertidas`),
              el('span', { class: 'metas-numero' },
                el('strong', null, `${parte}%`),
                el('small', null, linha.revertidas === 1 ? '1 revertida' : `${linha.revertidas} revertidas`)));
          })))));
}

// ---------------------------------------------------------------- backup (cartão do painel do bot)
async function baixarBackup(botao) {
  await executar(botao, async () => {
    const backup = await api(comServidor('/api/backup'));
    const endereco = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: endereco, download: `althea-backup-${backup.servidor.id}-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), 5000);
    avisar('ok', 'Backup baixado. Guarde o arquivo em local seguro.');
  });
}

async function restaurarBackup(arquivo, aoTerminar) {
  let backup;
  try {
    backup = JSON.parse(await arquivo.text());
  } catch {
    return avisar('erro', 'Este arquivo não é um backup válido.');
  }
  const origem = backup?.servidor?.nome ? ` de "${backup.servidor.nome}"` : '';
  const quando = backup?.geradoEm ? `, feito em ${formatarData(backup.geradoEm)}` : '';
  const confirmado = await confirmar({
    titulo: 'Restaurar este backup?',
    texto: `O painel do bot (canais, cargos, manutenção e bloqueio), as configurações do site (categorias, prazos e respostas prontas) e a meta da staff deste servidor serão trocados pelos do backup${origem}${quando}. A lista de usuários isentos não muda.`,
    rotulo: 'Restaurar backup',
    perigo: true
  });
  if (!confirmado) return;

  try {
    const resposta = await enviarJson('/api/backup', { guildId: estado.guildId, backup });
    estado.configSite = null;
    avisar('ok', resposta.mensagem);
    await aoTerminar();
  } catch (erro) {
    avisar('erro', erro.message);
  }
}

export function cartaoDeBackup(aoRestaurar) {
  const seletor = el('input', {
    type: 'file', accept: 'application/json,.json', class: 'so-leitor', 'aria-label': 'Arquivo de backup',
    onchange: (evento) => {
      const arquivo = evento.target.files?.[0];
      evento.target.value = '';
      if (arquivo) restaurarBackup(arquivo, aoRestaurar);
    }
  });

  return el('section', { class: 'cartao backup' },
    el('header', { class: 'bot-cabecalho' },
      el('span', { class: 'bot-icone', 'aria-hidden': 'true' }, icone('arquivo')),
      el('div', null,
        el('h2', null, 'Backup das configurações'),
        el('p', null, 'Um arquivo com o painel do bot, as configurações do site e a meta da staff deste servidor. Serve para voltar atrás depois de uma mudança errada ou copiar para outro servidor.'))),
    el('div', { class: 'backup-acoes' },
      el('button', { type: 'button', onclick: (evento) => baixarBackup(evento.currentTarget) }, 'Baixar backup'),
      el('button', { type: 'button', onclick: () => seletor.click() }, 'Restaurar de um arquivo'),
      seletor,
      el('p', { class: 'sub' }, 'Ao restaurar, o site confere tudo como se você tivesse salvo pela tela: canal ou cargo que não existe mais é recusado.')));
}
