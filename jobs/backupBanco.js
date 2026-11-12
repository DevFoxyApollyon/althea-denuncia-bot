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
// Falhou (banco instável): tenta de novo em 10, 20 e 40 minutos; na última, avisa no Log Admin.
const REPETICOES_MS = [10, 20, 40].map(min => min * 60 * 1000);
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

// Faz a cópia e, se falhar, tenta de novo mais tarde (sem esperar o dia seguinte).
async function fazerComRepeticao(client, tentativa = 0) {
  const r = await fazerBackup();
  if (!r?.erro) return r;
  if (tentativa < REPETICOES_MS.length) {
    log.warn(`Backup: nova tentativa em ${REPETICOES_MS[tentativa] / 60000} min.`);
    setTimeout(() => fazerComRepeticao(client, tentativa + 1), REPETICOES_MS[tentativa]).unref();
  } else if (client) {
    require('../utils/saudeBanco').avisarNoLog(client,
      `⚠️ O backup diário do banco principal falhou ${REPETICOES_MS.length + 1} vezes seguidas (último erro: ${String(r.erro).slice(0, 200)}). Ele tenta de novo amanhã; confira o banco.`, '#E67E22').catch(() => {});
  }
  return r;
}

// Ao ligar, faz uma cópia se a última tiver mais de um dia; depois, uma por dia.
function iniciarBackupDoBanco(client = null) {
  setTimeout(async () => {
    const ultimaCopia = (await bucket().find({}).sort({ uploadDate: -1 }).limit(1).toArray().catch(() => []))[0];
    if (!ultimaCopia || Date.now() - new Date(ultimaCopia.uploadDate).getTime() >= INTERVALO_MS) await fazerComRepeticao(client);
    setInterval(() => fazerComRepeticao(client), INTERVALO_MS).unref();
  }, 60_000).unref();
}

module.exports = { BUCKET, COPIAS_GUARDADAS, fazerBackup, resumoDosBackups, iniciarBackupDoBanco, linhasDoBanco };
