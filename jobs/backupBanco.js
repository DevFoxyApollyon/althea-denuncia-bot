// Cópia de segurança do banco principal, uma vez por dia.
//
// As denúncias e as configurações do bot só existem no banco principal. Todo
// dia o bot copia as coleções dele para um arquivo compactado (uma linha JSON
// por registro) e guarda no banco secundário, no GridFS "backups". Ficam as
// últimas 7 cópias; as mais antigas são apagadas. Para restaurar, veja
// scripts/restaurar-backup.js.
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const { primaryConnection, secondaryConnection } = require('../utils/persistencia');
const { log } = require('../utils/logger');

const BUCKET = 'backups';
const COPIAS_GUARDADAS = 7;
const INTERVALO_MS = 24 * 60 * 60 * 1000;
const { EJSON } = mongoose.mongo.BSON;

let ultimo = null;
let rodando = false;

const bucket = () => new mongoose.mongo.GridFSBucket(secondaryConnection.db, { bucketName: BUCKET });

// Uma linha por registro: {"c":"coleção","d":{...}}. EJSON mantém _id e datas como são.
async function* linhasDoBanco(db) {
  const colecoes = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(item => item.name)
    .filter(nome => !nome.startsWith('system.'))
    .sort();
  for (const nome of colecoes) {
    for await (const doc of db.collection(nome).find({})) {
      yield `${EJSON.stringify({ c: nome, d: doc }, { relaxed: false })}\n`;
    }
  }
}

async function fazerBackup(agora = new Date()) {
  if (rodando) return null;
  rodando = true;
  try {
    const nome = `principal-${agora.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.ndjson.gz`;
    const destino = bucket().openUploadStream(nome, { metadata: { banco: primaryConnection.name } });
    await pipeline(Readable.from(linhasDoBanco(primaryConnection.db)), zlib.createGzip(), destino);

    // Só apaga as antigas depois que a nova terminou de subir.
    const copias = await bucket().find({}).sort({ uploadDate: -1 }).toArray();
    for (const antiga of copias.slice(COPIAS_GUARDADAS)) await bucket().delete(antiga._id).catch(() => {});

    ultimo = { nome, em: agora, tamanho: destino.length ?? null, erro: null };
    log.info(`Backup do banco principal salvo: ${nome}`);
    return ultimo;
  } catch (erro) {
    ultimo = { nome: null, em: agora, tamanho: null, erro: erro.message };
    log.warn(`Backup do banco principal falhou: ${erro.message}`);
    return ultimo;
  } finally {
    rodando = false;
  }
}

// Para a tela Saúde: a última cópia e quantas existem.
async function resumoDosBackups() {
  const copias = await bucket().find({}).sort({ uploadDate: -1 }).toArray().catch(() => []);
  return {
    ultimaFalha: ultimo?.erro ? { em: ultimo.em, erro: ultimo.erro } : null,
    copias: copias.length,
    ultima: copias[0] ? { nome: copias[0].filename, em: copias[0].uploadDate, tamanhoKb: Math.round(copias[0].length / 1024) } : null
  };
}

// Ao ligar, faz uma cópia se a última tiver mais de um dia; depois, uma por dia.
function iniciarBackupDoBanco() {
  setTimeout(async () => {
    const ultimaCopia = (await bucket().find({}).sort({ uploadDate: -1 }).limit(1).toArray().catch(() => []))[0];
    if (!ultimaCopia || Date.now() - new Date(ultimaCopia.uploadDate).getTime() >= INTERVALO_MS) await fazerBackup();
    setInterval(() => fazerBackup(), INTERVALO_MS).unref();
  }, 60_000).unref();
}

module.exports = { BUCKET, COPIAS_GUARDADAS, fazerBackup, resumoDosBackups, iniciarBackupDoBanco, linhasDoBanco };
