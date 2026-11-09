// Mongo de verdade (em memória) para testar operações atômicas da ponte.
// Precisa ser iniciado ANTES de carregar qualquer model: a conexão é criada
// quando utils/primaryDb.js é carregado.
const { fecharConexoes } = require('./env');

async function iniciarMongoMemoria() {
  const { MongoMemoryServer } = require('mongodb-memory-server-core');
  const servidor = await MongoMemoryServer.create();
  process.env.MONGODB_URI = servidor.getUri('althea-teste');
  process.env.SECONDARY_DB_URI = servidor.getUri('althea-teste-secundario');
  const { primaryConnection } = require('../../utils/persistencia');
  await primaryConnection.asPromise();
  return {
    conexao: primaryConnection,
    parar: async () => {
      await fecharConexoes();
      await servidor.stop();
    }
  };
}

module.exports = { iniciarMongoMemoria };
