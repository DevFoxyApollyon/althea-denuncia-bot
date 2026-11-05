// Esperas entre uma ação e outra, ligadas ou desligadas no painel do bot (site).
//  - entre denúncias: a pessoa espera 1 minuto para abrir outra denúncia;
//  - entre reivindicações: a staff espera para reivindicar outra. O tempo, em
//    minutos, é escolhido no painel (padrão 1).
const ESPERA_ENTRE_DENUNCIAS_MS = 60 * 1000;
const MINUTOS_ENTRE_REIVINDICACOES = { padrao: 1, minimo: 1, maximo: 60 };

// Minutos válidos para a espera de reivindicar: inteiro entre o mínimo e o máximo.
function minutosEntreReivindicacoes(config) {
  const valor = Math.round(Number(config?.minutosEntreReivindicacoes));
  if (!Number.isFinite(valor)) return MINUTOS_ENTRE_REIVINDICACOES.padrao;
  return Math.min(MINUTOS_ENTRE_REIVINDICACOES.maximo, Math.max(MINUTOS_ENTRE_REIVINDICACOES.minimo, valor));
}

const esperaEntreReivindicacoesMs = (config) => minutosEntreReivindicacoes(config) * 60 * 1000;

// Antes da opção no site, a espera para reivindicar só valia nos servidores do
// .env (CLAIM_COOLDOWN_GUILD_IDS). Enquanto o responsável não mexer na opção,
// cada servidor continua como estava.
const SERVIDORES_COM_ESPERA_PARA_REIVINDICAR = new Set(
  (process.env.CLAIM_COOLDOWN_GUILD_IDS ?? '817924556358156360')
    .split(/[\s,;]+/)
    .filter(Boolean)
);

const esperaEntreDenunciasAtiva = (config) => config?.esperaEntreDenuncias !== false;

function esperaEntreReivindicacoesAtiva(config, guildId) {
  if (typeof config?.esperaEntreReivindicacoes === 'boolean') return config.esperaEntreReivindicacoes;
  return SERVIDORES_COM_ESPERA_PARA_REIVINDICAR.has(String(guildId || config?.guildId || ''));
}

// Análise automática: denúncia reivindicada que fica parada vai sozinha para
// análise depois do tempo escolhido no painel (padrão 30 minutos).
const MINUTOS_ANALISE_AUTOMATICA = { padrao: 30, minimo: 5, maximo: 240 };
const analiseAutomaticaAtiva = (config) => config?.analiseAutomatica !== false;

function minutosAnaliseAutomatica(config) {
  const valor = Math.round(Number(config?.minutosAnaliseAutomatica));
  if (!Number.isFinite(valor) || !config?.minutosAnaliseAutomatica) return MINUTOS_ANALISE_AUTOMATICA.padrao;
  return Math.min(MINUTOS_ANALISE_AUTOMATICA.maximo, Math.max(MINUTOS_ANALISE_AUTOMATICA.minimo, valor));
}

// Espera entre denúncias, aviso de reivindicação parada e arquivamento dos
// tópicos: tempos escolhidos no painel.
const MINUTOS_ENTRE_DENUNCIAS = { padrao: 1, minimo: 1, maximo: 60 };
const MINUTOS_AVISO_REIVINDICACAO = { padrao: 15, minimo: 5, maximo: 120 };
// O Discord só aceita estes tempos de arquivamento (1 hora, 1 dia, 3 dias, 1 semana).
const OPCOES_ARQUIVAR_TOPICO = [60, 1440, 4320, 10080];

function minutosDentro(valor, { padrao, minimo, maximo }) {
  const minutos = Math.round(Number(valor));
  if (!valor || !Number.isFinite(minutos)) return padrao;
  return Math.min(maximo, Math.max(minimo, minutos));
}

const minutosEntreDenuncias = (config) => minutosDentro(config?.minutosEntreDenuncias, MINUTOS_ENTRE_DENUNCIAS);
const esperaEntreDenunciasMs = (config) => minutosEntreDenuncias(config) * 60 * 1000;
const avisoReivindicacaoAtivo = (config) => config?.avisoReivindicacao !== false;
const minutosAvisoReivindicacao = (config) => minutosDentro(config?.minutosAvisoReivindicacao, MINUTOS_AVISO_REIVINDICACAO);
const minutosArquivarTopico = (config) => (OPCOES_ARQUIVAR_TOPICO.includes(Number(config?.minutosArquivarTopico)) ? Number(config.minutosArquivarTopico) : 1440);

// "1m 20s" ou "45s".
function tempoRestante(ms) {
  const segundos = Math.ceil(ms / 1000);
  const minutos = Math.floor(segundos / 60);
  return minutos > 0 ? `${minutos}m ${segundos % 60}s` : `${segundos}s`;
}

module.exports = {
  ESPERA_ENTRE_DENUNCIAS_MS,
  MINUTOS_ENTRE_REIVINDICACOES,
  minutosEntreReivindicacoes,
  esperaEntreReivindicacoesMs,
  esperaEntreDenunciasAtiva,
  esperaEntreReivindicacoesAtiva,
  tempoRestante,
  MINUTOS_ANALISE_AUTOMATICA,
  analiseAutomaticaAtiva,
  minutosAnaliseAutomatica,
  MINUTOS_ENTRE_DENUNCIAS,
  MINUTOS_AVISO_REIVINDICACAO,
  OPCOES_ARQUIVAR_TOPICO,
  minutosEntreDenuncias,
  esperaEntreDenunciasMs,
  avisoReivindicacaoAtivo,
  minutosAvisoReivindicacao,
  minutosArquivarTopico
};
