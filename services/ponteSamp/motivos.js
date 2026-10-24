// Tabela de motivos única para todos os servidores (coleção pontemotivos, banco secundário).
// Editada pelo Discord (/ponte motivos) ou pelo site (página Motivos de punição e /admin).
// Vazia: usa a tabela padrão de constantes.js.
const PonteMotivos = require('../../models/PonteMotivos');
const PonteServidor = require('../../models/PonteServidor');
const GlobalConfig = require('../../models/GlobalConfig');
const { tabelaDa, validarTabela } = require('./validacao');

const CACHE_MS = 60 * 1000;
let cache = null; // { regras, em }

async function regrasGlobais() {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.regras;
  const doc = await PonteMotivos.findOne({ chave: 'global' }).lean();
  let regras = doc?.regras || [];
  if (!doc?.definidas) {
    // Primeira vez: aproveita a tabela antiga (GlobalConfig no banco principal ou a de algum servidor).
    const global = await GlobalConfig.findOne({ key: 'global' }).lean().catch(() => null);
    const antigo = global?.ponteRegras?.length ? global.ponteRegras
      : (await PonteServidor.findOne({ 'regras.0': { $exists: true } }).sort({ updatedAt: -1 }).lean())?.regras;
    if (regras.length === 0 && antigo?.length) regras = antigo;
    await PonteMotivos.updateOne({ chave: 'global' }, { $set: { regras, definidas: true } }, { upsert: true });
  }
  cache = { regras, em: Date.now() };
  return regras;
}

// { tabela, propria }: propria = foi editada (não é a padrão).
async function obterTabela() {
  const regras = await regrasGlobais();
  return { tabela: tabelaDa({ regras }), propria: regras.length > 0 };
}

// Salva a tabela de todos os servidores. Lista vazia volta para a padrão.
async function salvarTabela(lista, autor) {
  const { erro, regras } = validarTabela(lista);
  if (erro) return { erro };
  await PonteMotivos.updateOne(
    { chave: 'global' },
    { $set: { regras, definidas: true, atualizadoPor: String(autor || 'Sistema').slice(0, 80) } },
    { upsert: true }
  );
  cache = null;
  return obterTabela();
}

// Texto editável (Discord): uma linha por motivo, "NOME|SINONIMO = ban 5 1" (tipo, tempo, avisos).
function tabelaParaTexto(tabela) {
  return tabela.map(t => `${t.sinonimos.join('|')} = ${t.cmd} ${t.tempo} ${t.avisos}`).join('\n');
}

function textoParaTabela(texto) {
  const lista = [];
  for (const [i, linha] of String(texto || '').split('\n').entries()) {
    if (!linha.trim()) continue;
    const m = linha.match(/^(.+?)\s*=\s*(ban|cadeia)\s+(\d+)\s+(\d+)\s*$/i);
    if (!m) return { erro: `Linha ${i + 1} fora do formato "NOME = ban 5 1": ${linha.slice(0, 60)}` };
    const [nome, ...sinonimos] = m[1].split('|').map(s => s.trim()).filter(Boolean);
    lista.push({ nome, sinonimos, cmd: m[2].toLowerCase(), tempo: Number(m[3]), avisos: Number(m[4]) });
  }
  return { lista };
}

const limparCache = () => { cache = null; };

module.exports = { obterTabela, salvarTabela, tabelaParaTexto, textoParaTabela, limparCache };
