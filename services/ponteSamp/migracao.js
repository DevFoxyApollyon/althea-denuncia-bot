// Os dados da ponte com o jogo moram no banco secundário. Quem já usava a ponte
// tinha tudo no principal: ao ligar, o bot copia cada coleção que ainda estiver
// vazia no secundário. Nada é apagado do principal.
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteMigracao' });
const COLECOES = ['ponteservidores', 'pontecodigos', 'ponteinstalacoes', 'pontepunicoes', 'ponteusos'];
const LOTE = 500;

async function migrarPonteParaSecundario(principal, secundario) {
  const copiadas = {};
  for (const nome of COLECOES) {
    const origem = principal.collection(nome);
    const destino = secundario.collection(nome);
    if (await destino.estimatedDocumentCount() > 0) continue;
    const total = await origem.estimatedDocumentCount();
    if (total === 0) continue;

    let lote = [];
    let quantidade = 0;
    const gravar = async () => {
      if (!lote.length) return;
      // ordered:false: um documento repetido não impede os outros
      await destino.insertMany(lote, { ordered: false }).catch(erro => {
        if (erro?.code !== 11000 && !erro?.writeErrors?.every(e => e.code === 11000)) throw erro;
      });
      quantidade += lote.length;
      lote = [];
    };
    for await (const documento of origem.find({})) {
      lote.push(documento);
      if (lote.length >= LOTE) await gravar();
    }
    await gravar();
    copiadas[nome] = quantidade;
  }
  if (Object.keys(copiadas).length) {
    log.info(`Ponte do jogo copiada para o banco secundário: ${Object.entries(copiadas).map(([n, q]) => `${n} (${q})`).join(', ')}.`);
  }
  return copiadas;
}

module.exports = { migrarPonteParaSecundario, COLECOES };
