// Restaura no banco principal uma cópia feita pelo backup diário (jobs/backupBanco.js).
//
//   npm run backup                          lista as cópias guardadas
//   npm run backup -- <nome>                mostra o que a cópia tem, sem gravar nada
//   npm run backup -- <nome> --confirmar    grava no banco principal
//
// Só acrescenta: cada registro da cópia que não existe mais no banco (mesmo _id)
// volta; o que já existe não é tocado. Nada é apagado.
require('dotenv').config();
const zlib = require('zlib');
const readline = require('readline');
const mongoose = require('mongoose');
const { BUCKET } = require('../jobs/backupBanco');

const { EJSON } = mongoose.mongo.BSON;

async function main() {
  const [nome, flag] = process.argv.slice(2);
  const secundario = await mongoose.createConnection(process.env.SECONDARY_DB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const bucket = new mongoose.mongo.GridFSBucket(secundario.db, { bucketName: BUCKET });

  if (!nome) {
    const copias = await bucket.find({}).sort({ uploadDate: -1 }).toArray();
    if (!copias.length) console.log('Nenhuma cópia guardada ainda.');
    for (const copia of copias) console.log(`${copia.filename}   ${Math.round(copia.length / 1024)} KB   ${copia.uploadDate.toLocaleString('pt-BR')}`);
    await secundario.close();
    return;
  }

  const confirmar = flag === '--confirmar';
  const principal = confirmar ? await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise() : null;
  const contagem = {};
  const linhas = readline.createInterface({ input: bucket.openDownloadStreamByName(nome).pipe(zlib.createGunzip()), crlfDelay: Infinity });

  for await (const linha of linhas) {
    if (!linha.trim()) continue;
    const { c, d } = EJSON.parse(linha, { relaxed: false });
    contagem[c] ||= { naCopia: 0, restaurados: 0 };
    contagem[c].naCopia += 1;
    if (principal) {
      const resultado = await principal.db.collection(c).updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
      if (resultado.upsertedCount) contagem[c].restaurados += 1;
    }
  }

  for (const [colecao, numeros] of Object.entries(contagem)) {
    console.log(`${colecao.padEnd(28)} ${String(numeros.naCopia).padStart(8)} na cópia${confirmar ? `   ${numeros.restaurados} restaurados` : ''}`);
  }
  if (!confirmar) console.log('\nNada foi gravado. Para restaurar, rode de novo com --confirmar.');
  await Promise.all([secundario.close(), principal?.close()]);
}

main().catch((erro) => {
  console.error(`Não foi possível restaurar: ${erro.message}`);
  process.exit(1);
});
