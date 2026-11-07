// Troca da PONTE_CHAVE_MESTRA pelo painel do dono (/admin). Os segredos das
// credenciais são decifrados com a chave atual e cifrados com a nova, então as
// gamemodes continuam funcionando sem trocar o althea_credenciais.txt.
//
// A chave nova vale na hora (process.env) e é gravada no .env da máquina em que
// o bot está rodando. O .env do PC do dono NÃO muda: ele precisa colar a chave
// lá antes do próximo "npm run pacote", senão o zip leva a chave antiga.
const fs = require('node:fs');
const path = require('node:path');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const { chaveMestra, cifrar, decifrar, gerarChaveMestra, impressaoDaChave } = require('./cifra');

const ARQUIVO_ENV = path.join(__dirname, '..', '..', '.env');
const NOME = 'PONTE_CHAVE_MESTRA';

let trocando = false;

// Troca (ou cria) a linha NOME=valor no texto do .env, mantendo o resto igual.
function comChave(textoEnv, valor) {
  const linhas = String(textoEnv || '').split(/\r?\n/);
  const pos = linhas.findIndex(linha => new RegExp(`^\\s*${NOME}\\s*=`).test(linha));
  if (pos >= 0) linhas[pos] = `${NOME}=${valor}`;
  else {
    if (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
    linhas.push(`${NOME}=${valor}`, '');
  }
  return linhas.join('\n');
}

// Grava sem deixar o .env pela metade: escreve num temporário e troca.
function gravarNoEnv(valor, arquivo = ARQUIVO_ENV) {
  const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
  const temporario = `${arquivo}.tmp-${process.pid}`;
  fs.writeFileSync(temporario, comChave(atual, valor), { mode: 0o600 });
  fs.renameSync(temporario, arquivo);
}

// Devolve { chave, impressao, recifradas, ilegiveis, envGravado } ou { erro }.
async function trocarChaveMestra({ arquivo = ARQUIVO_ENV } = {}) {
  if (trocando) return { erro: 'Já existe uma troca de chave em andamento.' };
  trocando = true;
  const anterior = process.env[NOME];
  try {
    const chaveAtual = chaveMestra();
    const nova = gerarChaveMestra();
    const bufferNovo = Buffer.from(nova, 'base64');

    // Tudo é recifrado em memória antes de mexer em qualquer coisa.
    const conexoes = await PonteConexaoGm.find({}, { segredoCifrado: 1 }).lean();
    const atualizacoes = [];
    let ilegiveis = 0;
    for (const c of conexoes) {
      let segredo;
      try {
        segredo = chaveAtual ? decifrar(c.segredoCifrado, chaveAtual) : null;
      } catch {
        segredo = null;
      }
      if (segredo === null) {
        ilegiveis += 1;
        continue;
      }
      atualizacoes.push({ updateOne: { filter: { _id: c._id }, update: { $set: { segredoCifrado: cifrar(segredo, bufferNovo) } } } });
    }

    // A chave nova passa a valer antes do banco mudar: se o banco falhar, volta a anterior.
    process.env[NOME] = nova;
    let envGravado = true;
    try {
      gravarNoEnv(nova, arquivo);
    } catch {
      envGravado = false;
    }
    try {
      if (atualizacoes.length) await PonteConexaoGm.bulkWrite(atualizacoes, { ordered: false });
    } catch (erro) {
      process.env[NOME] = anterior ?? '';
      if (envGravado) {
        try { gravarNoEnv(anterior ?? '', arquivo); } catch { /* o .env fica com a nova; o processo segue com a anterior */ }
      }
      throw erro;
    }
    return { chave: nova, impressao: impressaoDaChave(nova), recifradas: atualizacoes.length, ilegiveis, envGravado };
  } finally {
    trocando = false;
  }
}

module.exports = { trocarChaveMestra, comChave, gravarNoEnv, ARQUIVO_ENV };
