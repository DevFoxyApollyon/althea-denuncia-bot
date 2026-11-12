// Mongo de verdade (em memória) para testar operações atômicas da ponte.
// Precisa ser iniciado ANTES de carregar qualquer model: a conexão é criada
// quando utils/primaryDb.js é carregado.
const { fecharConexoes } = require('./env');

async function iniciarMongoMemoria() {
  const { MongoMemoryServer } = require('mongodb-memory-server-core');
  // Com vários arquivos de teste ao mesmo tempo, o mongod às vezes demora a subir: prazo
  // maior e uma segunda tentativa, em vez de derrubar o arquivo inteiro.
  const criar = () => MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  const servidor = await criar().catch(() => criar());
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
