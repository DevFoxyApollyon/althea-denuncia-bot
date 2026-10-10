require('dotenv').config();

const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;
const { CAMPO_RETENCAO, adicionarMeses, prepararRetencaoNoBanco } = require('../utils/retencaoDados');

const TAMANHO_LOTE = 500;
const APLICAR = process.argv.includes('--aplicar');
const COLECAO_CONFIG = 'configs';

function deveMigrarColecao({ name, type }) {
  return !name.startsWith('system.') && type !== 'view' && name !== COLECAO_CONFIG;
}

function normalizarDocumento(documento) {
  const copia = { ...documento };
  delete copia[CAMPO_RETENCAO];
  const estendido = JSON.parse(EJSON.stringify(copia, { relaxed: false }));
  const ordenar = (valor) => {
    if (Array.isArray(valor)) return valor.map(ordenar);
    if (!valor || typeof valor !== 'object') return valor;
    return Object.fromEntries(Object.keys(valor).sort().map(chave => [chave, ordenar(valor[chave])]));
  };
  return JSON.stringify(ordenar(estendido));
}

function enderecoDoBanco(uri) {
  const url = new URL(uri);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function opcoesIndice(indice) {
  const opcoes = { ...indice };
  for (const chave of ['v', 'ns', 'key', 'background', 'expireAfterSeconds']) delete opcoes[chave];
  return opcoes;
}

async function verificarConflitos(origem, destino) {
  const colecoes = (await origem.listCollections({}, { nameOnly: true }).toArray())
    .filter(deveMigrarColecao);
  const conflitos = [];
  let total = 0;

  for (const { name } of colecoes) {
    const origemColecao = origem.collection(name);
    const destinoColecao = destino.collection(name);
    const destinoExiste = await destino.listCollections({ name }, { nameOnly: true }).hasNext();
    let quantidade = 0;

    for await (const documento of origemColecao.find({}).batchSize(TAMANHO_LOTE)) {
      quantidade += 1;
      const existente = destinoExiste ? await destinoColecao.findOne({ _id: documento._id }) : null;
      if (existente && normalizarDocumento(existente) !== normalizarDocumento(documento)) {
        conflitos.push({ colecao: name, id: String(documento._id) });
      }
    }

    total += quantidade;
    console.log(`[${APLICAR ? 'MIGRAR' : 'SIMULAR'}] ${name}: ${quantidade} registro(s) de origem.`);
  }

  return { colecoes, conflitos, total };
}

async function copiarColecoes(origem, destino, colecoes, dataRetencao) {
  for (const { name } of colecoes) {
    const origemColecao = origem.collection(name);
    const destinoColecao = destino.collection(name);
    let lote = [];

    const gravarLote = async () => {
      if (!lote.length) return;
      await destinoColecao.bulkWrite(lote, { ordered: false });
      lote = [];
    };

    for await (const documento of origemColecao.find({}).batchSize(TAMANHO_LOTE)) {
      const copia = { ...documento };
      delete copia[CAMPO_RETENCAO];
      lote.push({
        updateOne: {
          filter: { _id: documento._id },
          update: {
            $set: { [CAMPO_RETENCAO]: dataRetencao },
            $setOnInsert: copia
          },
          upsert: true
        }
      });
      if (lote.length >= TAMANHO_LOTE) await gravarLote();
    }
    await gravarLote();
  }
}

async function copiarIndices(origem, destino, colecoes) {
  for (const { name } of colecoes) {
    const destinoColecao = destino.collection(name);
    const indices = await origem.collection(name).indexes();

    for (const indice of indices) {
      if (indice.name === '_id_' || indice.expireAfterSeconds !== undefined) continue;
      await destinoColecao.createIndex(indice.key, opcoesIndice(indice));
    }
  }
}

async function main() {
  const uriOrigem = String(process.env.MONGODB_URI || '').trim();
  const uriDestino = String(process.env.SECONDARY_DB_URI || '').trim();
  if (!uriOrigem || !uriDestino) {
    throw new Error('Defina MONGODB_URI (origem) e SECONDARY_DB_URI (destino) no .env.');
  }
  if (enderecoDoBanco(uriOrigem) === enderecoDoBanco(uriDestino)) {
    throw new Error('Origem e destino apontam para o mesmo banco; migração cancelada.');
  }

  const conexaoOrigem = await mongoose.createConnection(uriOrigem).asPromise();
  const conexaoDestino = await mongoose.createConnection(uriDestino).asPromise();
  try {
    const resultado = await verificarConflitos(conexaoOrigem.db, conexaoDestino.db);
    if (resultado.conflitos.length) {
      const lista = resultado.conflitos.slice(0, 10)
        .map(item => `${item.colecao}/${item.id}`).join(', ');
      throw new Error(`Existem IDs diferentes já gravados no destino (${lista}). Nada foi migrado.`);
    }

    if (!APLICAR) {
      console.log(`Simulação concluída: ${resultado.total} registro(s) em ${resultado.colecoes.length} coleção(ões).`);
      console.log('Para executar, pare o bot e rode: npm run db:migrar -- --aplicar');
      return;
    }

    const migradoEm = new Date();
    const dataRetencao = adicionarMeses(migradoEm);
    await copiarColecoes(conexaoOrigem.db, conexaoDestino.db, resultado.colecoes, dataRetencao);
    await copiarIndices(conexaoOrigem.db, conexaoDestino.db, resultado.colecoes);
    await prepararRetencaoNoBanco(conexaoDestino.db, migradoEm, { reiniciarPrazo: true });

    const verificacao = await verificarConflitos(conexaoOrigem.db, conexaoDestino.db);
    if (verificacao.conflitos.length) {
      throw new Error('A verificação pós-cópia encontrou diferenças; a origem foi mantida intacta.');
    }

    console.log(`Migração verificada. Os dados de origem foram preservados como cópia de segurança.`);
    console.log(`Todos os registros migrados expiram a partir de ${dataRetencao.toISOString()}.`);
  } finally {
    await Promise.all([conexaoOrigem.close(), conexaoDestino.close()]);
  }
}

if (require.main === module) {
  main().catch(erro => {
    console.error(`Migração não concluída: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizarDocumento,
  enderecoDoBanco,
  opcoesIndice,
  deveMigrarColecao,
  verificarConflitos,
  copiarColecoes,
  copiarIndices
};
