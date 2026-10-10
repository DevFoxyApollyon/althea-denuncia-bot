const OBRIGATORIAS = {
  DISCORD_TOKEN: 'token do bot (Discord Developer Portal > Bot)',
  MONGODB_URI: 'URI do banco principal (denúncias, configs, ranking)',
  SECONDARY_DB_URI: 'URI do banco secundário (usuários/contas)'
};

const OPCIONAIS = {
  SUPORTE_BOT_ID: 'sem ele ninguém recebe o acesso de suporte ao painel',
  BOT_ALVO_ID: 'sem ele a sincronização de nicknames fica desligada'
};

// Confere todas as variáveis de uma vez, para o erro apontar tudo o que falta
// em vez de o bot cair na primeira ausência.
function validarEnv(log = console) {
  const faltando = Object.keys(OBRIGATORIAS).filter((nome) => !String(process.env[nome] || '').trim());

  for (const nome of Object.keys(OPCIONAIS)) {
    if (!String(process.env[nome] || '').trim()) log.warn(`${nome} não definida: ${OPCIONAIS[nome]}.`);
  }

  if (faltando.length === 0) return true;

  for (const nome of faltando) log.error(`Variável obrigatória ausente no .env: ${nome} — ${OBRIGATORIAS[nome]}.`);
  log.error('Copie o .env.example para .env e preencha os valores acima.');
  return false;
}

module.exports = { validarEnv, OBRIGATORIAS, OPCIONAIS };
