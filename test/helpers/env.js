// Valores falsos para que nenhum teste encoste nos bancos ou no Discord reais.
// Como já estão definidos, o dotenv (chamado por alguns módulos) não os sobrescreve.
process.env.DISCORD_TOKEN = 'token-de-teste';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/althea-teste';
process.env.SECONDARY_DB_URI = 'mongodb://127.0.0.1:1/althea-teste-secundario';
process.env.SUPORTE_BOT_ID = '100000000000000001';
process.env.BOT_ALVO_ID = '100000000000000002,100000000000000003';
process.env.USUARIOS_ISENTOS = '';

async function fecharConexoes() {
  const mongoose = require('mongoose');
  await Promise.allSettled(mongoose.connections.map(conexao => conexao.close(true)));
  const { advancedMonitor } = require('../../utils/advancedMonitoring');
  const { globalCache } = require('../../utils/smartCache');
  advancedMonitor.destroy();
  globalCache.destroy();
}

module.exports = { fecharConexoes };
