// Constantes e o estado da tela, compartilhados por todos os módulos.

export const raiz = document.getElementById('app');
export const INTERVALO_ATUALIZACAO_MS = 20000;
export const CHAVE_TEMA = 'althea-tema';
export const CHAVE_AREA = 'althea-area';
export const CHAVE_VISTOS = 'althea-vistos';
export const CHAVE_RASCUNHO = 'althea-rascunho-denuncia';
export const CHAVE_CHAT = 'althea-chat';
export const CHAVE_SERVIDOR = 'althea-servidor';
// Telas que não são uma lista de casos.
export const ROTAS_PROPRIAS = ['ranking', 'numeros', 'sugestoes', 'geral', 'auditoria', 'identificar', 'config', 'jogador', 'chat', 'home', 'teste', 'teste-admin'];
export const ROTULOS_ACAO = { reivindicacao: 'Reivindicou', analise: 'Colocou em análise', aceita: 'Aceitou', recusada: 'Recusou' };
export const PERIODOS = { hoje: 'Hoje', semana: 'Semana', mes: 'Mês' };
export const ROTULOS_STATUS = {
  pendente: 'Pendente',
  reivindicacao: 'Reivindicada',
  analise: 'Em análise',
  aceita: 'Aceita',
  recusada: 'Recusada',
  finalizada: 'Finalizada'
};
// Etapas do andamento de um caso; a última leva o nome da decisão.
export const ETAPAS = ['Aberta', 'Reivindicada', 'Em análise', 'Decisão'];
export const ETAPA_DO_STATUS = { pendente: 0, reivindicacao: 1, analise: 2, aceita: 3, recusada: 3, finalizada: 3 };
export const EM_ANDAMENTO = ['pendente', 'reivindicacao', 'analise'];

// Cada vista é uma lista de casos. As do jogador e as da staff ficam em
// áreas separadas do site.
export const VISTAS = {
  minhas: { area: 'jogador', escopo: 'minhas', titulo: 'Minhas denúncias', menu: 'Início', icone: 'casa',
    descricao: 'Acompanhe o andamento das denúncias que você abriu ou em que foi citado.' },
  fila: { area: 'staff', escopo: 'fila', titulo: 'Fila de atendimento', menu: 'Fila', icone: 'caixa',
    descricao: 'Denúncias pendentes, da mais antiga para a mais nova.' },
  atendimentos: { area: 'staff', escopo: 'minhas', titulo: 'Meus atendimentos', menu: 'Meus atendimentos', icone: 'escudo',
    descricao: 'Casos que você reivindicou.' },
  admin: { area: 'admin', escopo: 'admin', titulo: 'Todas as denúncias', menu: 'Todas as denúncias', icone: 'grade',
    descricao: 'Todos os casos deste servidor, dos mais novos para os mais antigos.' }
};
export const FILTROS = {
  todos: { rotulo: 'Todas', status: null },
  andamento: { rotulo: 'Em andamento', status: EM_ANDAMENTO },
  aceita: { rotulo: 'Aceitas', status: ['aceita'] },
  recusada: { rotulo: 'Recusadas', status: ['recusada'] },
  finalizada: { rotulo: 'Finalizadas', status: ['finalizada'] }
};

export const estado = {
  site: { nome: 'Portal de denúncias', icone: null },
  usuario: null,
  servidores: [],
  visaoAdmin: false,
  categoria: 'todas',
  guildId: null,
  area: 'jogador',
  vista: 'minhas',
  listas: { minhas: [], fila: [], admin: [] },
  carregando: { minhas: false, fila: false, admin: false },
  paginaAdmin: 1,
  totalPaginasAdmin: 1,
  totalAdmin: 0,
  detalhe: null,
  aviso: null,
  arquivos: [],
  anexosNovos: [],
  rascunho: '',
  nota: '',
  aceitando: false,
  busca: '',
  filtro: 'todos',
  plataforma: 'todas',
  ordem: 'padrao',
  soNovidades: false,
  presenca: [],
  ranking: null,
  periodoRanking: 'mes',
  numeros: null,
  diasNumeros: 30,
  sugestoes: null,
  textoSugestao: '',
  auditoria: null,
  geral: null,
  naoIdentificadas: null,
  configSite: null,
  rascunhoDenuncia: null,
  duplicadas: null,
  filtroCategoria: '',
  jogador: null,
  chat: null,
  textoChat: '',
  arquivoChat: null,
  chatLidaAte: null,
  canalChat: 'geral',
  respostaChat: null,
  reagindoChat: null,
  sinalizadasChat: null,
  gerirChat: false,
  teste: null,
  respostasTeste: {},
  testeAdmin: null,
  chatNovas: { total: 0, mencoes: 0 },
  sugestoesChat: [],
  mencoesChat: {},
  push: null,
  sinoAberto: false,
  perfilAberto: false,
  notaAvaliacao: null,
  comentarioAvaliacao: ''
};


