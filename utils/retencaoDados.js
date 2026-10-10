const MESES_RETENCAO = 6;
const CAMPO_RETENCAO = 'dataRetencaoAte';
const INDICE_RETENCAO = `${CAMPO_RETENCAO}_1`;
const PREFIXO_GRIDFS = 'chatArquivos.';

function adicionarMeses(data, meses = MESES_RETENCAO) {
  const resultado = new Date(data);
  const diaOriginal = resultado.getDate();
  resultado.setMonth(resultado.getMonth() + meses);
  if (resultado.getDate() !== diaOriginal) resultado.setDate(0);
  return resultado;
}

function aplicarRetencaoAoSchema(schema) {
  if (!schema.path(CAMPO_RETENCAO)) {
    schema.add({
      [CAMPO_RETENCAO]: {
        type: Date,
        default: () => adicionarMeses(new Date())
      }
    });
  }
  const jaConfigurado = schema.indexes().some(([campos, opcoes]) =>
    campos[CAMPO_RETENCAO] === 1 && opcoes.expireAfterSeconds === 0);
  if (!jaConfigurado) schema.index({ [CAMPO_RETENCAO]: 1 }, { expireAfterSeconds: 0 });
}

async function prepararRetencaoNoBanco(db, agora = new Date(), { reiniciarPrazo = false } = {}) {
  const colecoes = await db.listCollections({}, { nameOnly: true }).toArray();
  const dataExpiracao = adicionarMeses(agora);

  for (const { name, type } of colecoes) {
    if (name.startsWith('system.') || type === 'view') continue;

    const colecao = db.collection(name);
    const gridFs = name.startsWith(PREFIXO_GRIDFS);
    if (gridFs && name.endsWith('.chunks')) continue;

    const indices = await colecao.indexes();
    for (const indice of indices) {
      if (indice.expireAfterSeconds !== undefined && indice.name !== INDICE_RETENCAO) {
        await colecao.dropIndex(indice.name);
      }
    }

    await colecao.updateMany(
      reiniciarPrazo ? {} : { [CAMPO_RETENCAO]: { $exists: false } },
      { $set: { [CAMPO_RETENCAO]: dataExpiracao } }
    );

    if (!gridFs) {
      await colecao.createIndex({ [CAMPO_RETENCAO]: 1 }, { expireAfterSeconds: 0 });
    }
  }
}

module.exports = {
  CAMPO_RETENCAO,
  INDICE_RETENCAO,
  adicionarMeses,
  aplicarRetencaoAoSchema,
  prepararRetencaoNoBanco
};
