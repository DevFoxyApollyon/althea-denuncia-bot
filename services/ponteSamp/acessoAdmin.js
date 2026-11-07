// Quem abre o painel da ponte (/admin): o dono do bot e as pessoas que ele liberou.
// Gerenciar esta lista, trocar a chave mestra, gerar códigos e desativar servidores
// continuam só com o dono.
const PonteAcessoAdmin = require('../../models/PonteAcessoAdmin');
const { ehDono } = require('./gestao');

const RE_ID = /^\d{15,21}$/;
const CACHE_MS = 60 * 1000;
let cache = { em: 0, ids: new Set() };

async function liberados() {
  if (Date.now() - cache.em < CACHE_MS) return cache.ids;
  const lista = await PonteAcessoAdmin.find({}, { userId: 1 }).lean().catch(() => null);
  // Banco fora do ar: segue com a última lista conhecida.
  if (lista) cache = { em: Date.now(), ids: new Set(lista.map(item => item.userId)) };
  return cache.ids;
}

const limparCache = () => { cache = { em: 0, ids: new Set() }; };

async function podeAbrirPainel(userId) {
  if (!userId) return false;
  if (ehDono(userId)) return true;
  return (await liberados()).has(String(userId));
}

const listarAcessos = () => PonteAcessoAdmin.find({}).sort({ adicionadoEm: -1 }).limit(100).lean();

async function adicionarAcesso({ userId, nome = '', por }) {
  const id = String(userId || '').trim();
  if (!RE_ID.test(id)) return { erro: 'ID do Discord inválido (só números, 15 a 21 dígitos).' };
  if (ehDono(id)) return { erro: 'Este é o dono do bot: ele já tem acesso.' };
  const existente = await PonteAcessoAdmin.findOne({ userId: id }).lean();
  if (existente) return { erro: 'Esta pessoa já tem acesso.' };
  const acesso = await PonteAcessoAdmin.create({ userId: id, nome: String(nome).slice(0, 64), adicionadoPor: String(por) });
  limparCache();
  return { acesso };
}

async function removerAcesso(userId) {
  const r = await PonteAcessoAdmin.deleteOne({ userId: String(userId) });
  limparCache();
  return r.deletedCount === 1;
}

module.exports = { podeAbrirPainel, listarAcessos, adicionarAcesso, removerAcesso, limparCache };
