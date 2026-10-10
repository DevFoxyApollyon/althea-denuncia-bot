// Mostra o que há em cada banco de dados (principal e secundário): coleções,
// quantidade de registros e se a coleção apaga registros sozinha.
// Só lê; não altera nada.   npm run bancos
require('dotenv').config();
const mongoose = require('mongoose');
const { COLECOES_PERMANENTES, COLECOES_COM_REGRA_PROPRIA, PRAZOS_EM_DIAS, CAMPO_RETENCAO } = require('../utils/retencaoDados');

async function descrever(rotulo, uri) {
  const conexao = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const db = conexao.db;
  const colecoes = (await db.listCollections({}, { nameOnly: true }).toArray())
    .filter(item => !item.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n${rotulo}: banco "${db.databaseName}", ${colecoes.length} coleções`);
  for (const { name } of colecoes) {
    const colecao = db.collection(name);
    const [total, indices] = await Promise.all([colecao.estimatedDocumentCount(), colecao.indexes().catch(() => [])]);
    const expira = indices.filter(indice => indice.expireAfterSeconds !== undefined).map(indice => Object.keys(indice.key)[0]);
    const comPrazo = expira.includes(CAMPO_RETENCAO) ? await colecao.countDocuments({ [CAMPO_RETENCAO]: { $exists: true } }) : 0;
    const regra = COLECOES_PERMANENTES.includes(name) ? 'permanente'
      : COLECOES_COM_REGRA_PROPRIA.includes(name) ? 'regra própria'
        : PRAZOS_EM_DIAS[name] ? `${PRAZOS_EM_DIAS[name]} dias` : '6 meses';
    const hoje = expira.length ? `hoje apaga por "${expira.join(', ')}"${comPrazo ? ` (${comPrazo} com validade)` : ''}` : 'hoje não apaga';
    const situacao = `regra: ${regra.padEnd(14)} ${hoje}`;
    console.log(`  ${name.padEnd(26)} ${String(total).padStart(8)} registros   ${situacao}`);
  }
  await conexao.close();
}

(async () => {
  await descrever('PRINCIPAL', process.env.MONGODB_URI);
  await descrever('SECUNDÁRIO', process.env.SECONDARY_DB_URI);
})().catch((erro) => {
  console.error(`Não foi possível ler os bancos: ${erro.message}`);
  process.exit(1);
});
