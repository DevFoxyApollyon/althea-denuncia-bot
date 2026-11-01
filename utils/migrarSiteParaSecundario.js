// O que é do site (chat, acessos, avisos, logins, rascunhos, configurações do
// site, testes, metas, notas internas e as mensagens das denúncias) mora no banco
// secundário. Quem já usava o site tinha tudo no principal: na primeira vez que o
// bot liga com esta versão, ele copia essas coleções para o secundário antes de
// entrar no Discord. Cada coleção só é apagada do principal depois de conferir
// que todos os documentos dela estão no secundário.
const { Logger } = require('./logger');

const log = new Logger({ tag: 'MigracaoSite' });
const LOTE = 500;
const MARCA = 'site-para-secundario';
const COLECOES = [
  'acessocasos',
  'avisosites',
  'chatbanimentos',
  'chatfixadas',
  'chatmensagems',
  'chatmoderacaos',
  'chatsalas',
  'chatsinalizacaos',
  'chatArquivos.files',
  'chatArquivos.chunks',
  'configsites',
  'loginsites',
  'rascunhodenuncias',
  'testestaffs',
  'testerespostas',
  'metastaffs',
  'notainternas',
  'denunciamensagems'
];

async function copiarColecao(origem, destino) {
  let lote = [];
  let quantidade = 0;
  const gravar = async () => {
    if (!lote.length) return;
    // ordered:false: um documento que já está no destino não impede os outros.
    await destino.insertMany(lote, { ordered: false }).catch((erro) => {
      if (erro?.code !== 11000 && !erro?.writeErrors?.every(e => e.code === 11000)) throw erro;
    });
    quantidade += lote.length;
    lote = [];
  };
  for await (const documento of origem.find({}).batchSize(LOTE)) {
    lote.push(documento);
    if (lote.length >= LOTE) await gravar();
  }
  await gravar();
  return quantidade;
}

// Quantos documentos da origem ainda não estão no destino (conferido pelo _id).
async function faltandoNoDestino(origem, destino) {
  let faltando = 0;
  let ids = [];
  const conferir = async () => {
    if (!ids.length) return;
    faltando += ids.length - await destino.countDocuments({ _id: { $in: ids } });
    ids = [];
  };
  for await (const { _id } of origem.find({}, { projection: { _id: 1 } }).batchSize(LOTE)) {
    ids.push(_id);
    if (ids.length >= LOTE) await conferir();
  }
  await conferir();
  return faltando;
}

async function migrarSiteParaSecundario(principal, secundario) {
  const migracoes = secundario.collection('migracoes');
  if (await migracoes.findOne({ _id: MARCA })) return null;

  // Os dois endereços podem apontar para o mesmo banco: aí não há o que mover, e
  // apagar do "principal" apagaria os dados de vez. Confere com um registro de teste.
  const teste = `teste-${Date.now()}-${Math.random()}`;
  await migracoes.insertOne({ _id: teste });
  const mesmoBanco = Boolean(await principal.collection('migracoes').findOne({ _id: teste }));
  await migracoes.deleteOne({ _id: teste });
  if (mesmoBanco) {
    log.warn('Banco principal e secundário são o mesmo: o site já está no lugar, nada foi movido.');
    await migracoes.insertOne({ _id: MARCA, em: new Date(), copiadas: {}, mesmoBanco: true });
    return {};
  }

  const copiadas = {};
  for (const nome of COLECOES) {
    const existe = await principal.listCollections({ name: nome }, { nameOnly: true }).hasNext();
    if (!existe) continue;
    const origem = principal.collection(nome);
    const destino = secundario.collection(nome);
    log.info(`Copiando ${nome} para o banco secundário...`);
    copiadas[nome] = await copiarColecao(origem, destino);

    // Só apaga do principal com tudo conferido no secundário.
    const faltando = await faltandoNoDestino(origem, destino);
    if (faltando > 0) throw new Error(`${faltando} documento(s) de ${nome} não chegaram ao banco secundário; nada foi apagado dessa coleção.`);
    await origem.drop();
  }

  // A marca só é gravada no fim: se o bot cair no meio, a cópia recomeça e pula
  // o que já foi copiado (e as coleções já apagadas do principal).
  await migracoes.insertOne({ _id: MARCA, em: new Date(), copiadas });
  if (Object.keys(copiadas).length) {
    log.info(`Site movido para o banco secundário e apagado do principal: ${Object.entries(copiadas).map(([n, q]) => `${n} (${q})`).join(', ')}.`);
  }
  return copiadas;
}

module.exports = { migrarSiteParaSecundario, COLECOES };
