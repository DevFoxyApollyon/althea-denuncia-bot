const ConfigSite = require('../models/ConfigSite');
const { definirConfigDoServidor } = require('./categorias');

const RECARREGAR_A_CADA_MS = 60 * 1000;
let carregadoEm = 0;
let carregando = null;

function aplicar(doc) {
  definirConfigDoServidor(doc.guildId, {
    categorias: doc.categorias.map(({ nome, grupo, prioridade, termos }) => ({ nome, grupo: grupo || '', prioridade, termos: [...termos] })),
    slaHoras: { alta: doc.slaHoras.alta, normal: doc.slaHoras.normal },
    respostasProntas: doc.respostasProntas.map(({ titulo, texto }) => ({ titulo, texto }))
  });
}

// Traz do banco as configurações salvas. As rotas chamam isto antes de usar
// categorias e prazos; o banco só é consultado uma vez por minuto.
async function garantirConfigDoSite() {
  if (Date.now() - carregadoEm < RECARREGAR_A_CADA_MS) return;
  carregando ||= ConfigSite.find().lean()
    .then(docs => {
      docs.forEach(aplicar);
      carregadoEm = Date.now();
    })
    .catch(() => {})
    .finally(() => { carregando = null; });
  await carregando;
}

// Confere o que veio do formulário e devolve a configuração limpa, ou lança um
// erro com a mensagem para a pessoa.
function validarConfig(entrada) {
  const texto = (valor, limite) => String(valor ?? '').trim().slice(0, limite);

  const categorias = (Array.isArray(entrada?.categorias) ? entrada.categorias : []).slice(0, 60).map(item => ({
    nome: texto(item?.nome, 40),
    grupo: texto(item?.grupo, 30),
    prioridade: item?.prioridade === 'alta' ? 'alta' : 'normal',
    termos: [...new Set((Array.isArray(item?.termos) ? item.termos : String(item?.termos || '').split(','))
      .map(termo => texto(termo, 40).toLowerCase()).filter(termo => termo.length >= 2))].slice(0, 15)
  })).filter(item => item.nome);

  if (!categorias.length) throw new Error('Mantenha pelo menos uma categoria.');
  const nomes = categorias.map(item => item.nome.toLowerCase());
  if (new Set(nomes).size !== nomes.length) throw new Error('Há duas categorias com o mesmo nome.');
  const semTermo = categorias.find(item => !item.termos.length);
  if (semTermo) throw new Error(`A categoria "${semTermo.nome}" precisa de pelo menos um termo com 2 letras ou mais.`);

  const horas = (valor) => Math.round(Number(valor) * 100) / 100;
  const slaHoras = { alta: horas(entrada?.slaHoras?.alta), normal: horas(entrada?.slaHoras?.normal) };
  for (const [nome, valor] of Object.entries(slaHoras)) {
    if (!Number.isFinite(valor) || valor < 0.25 || valor > 720) {
      throw new Error(`O prazo de prioridade ${nome} deve ficar entre 0,25 e 720 horas.`);
    }
  }
  if (slaHoras.alta > slaHoras.normal) throw new Error('O prazo da prioridade alta não pode ser maior que o da normal.');

  const respostasProntas = (Array.isArray(entrada?.respostasProntas) ? entrada.respostasProntas : []).slice(0, 20)
    .map(item => ({ titulo: texto(item?.titulo, 60), texto: texto(item?.texto, 1500) }))
    .filter(item => item.titulo && item.texto);

  return { categorias, slaHoras, respostasProntas };
}

async function salvarConfigDoSite(guildId, entrada, usuarioId) {
  const config = validarConfig(entrada);
  const doc = await ConfigSite.findOneAndUpdate(
    { guildId },
    { $set: { ...config, atualizadoPor: usuarioId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  aplicar(doc);
  return config;
}

async function restaurarConfigDoSite(guildId) {
  await ConfigSite.deleteOne({ guildId });
  definirConfigDoServidor(guildId, null);
}

module.exports = { garantirConfigDoSite, validarConfig, salvarConfigDoSite, restaurarConfigDoSite };
