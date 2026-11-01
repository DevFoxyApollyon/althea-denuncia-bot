// Esperas entre uma ação e outra, ligadas ou desligadas no painel do bot (site).
//  - entre denúncias: quanto a pessoa espera para abrir outra denúncia;
//  - entre reivindicações: quanto a staff espera para reivindicar outra.
const ESPERA_ENTRE_DENUNCIAS_MS = 60 * 1000;
const ESPERA_ENTRE_REIVINDICACOES_MS = 60 * 1000;

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

// "1m 20s" ou "45s".
function tempoRestante(ms) {
  const segundos = Math.ceil(ms / 1000);
  const minutos = Math.floor(segundos / 60);
  return minutos > 0 ? `${minutos}m ${segundos % 60}s` : `${segundos}s`;
}

module.exports = {
  ESPERA_ENTRE_DENUNCIAS_MS,
  ESPERA_ENTRE_REIVINDICACOES_MS,
  esperaEntreDenunciasAtiva,
  esperaEntreReivindicacoesAtiva,
  tempoRestante
};
