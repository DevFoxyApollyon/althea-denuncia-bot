// Credenciais da ponte com a gamemode (/ponte gamemode criar|listar|revogar|renovar).
// Só o dono do bot mexe nelas. O segredo existe em texto só no retorno de criar/renovar:
// no banco ele fica cifrado com a PONTE_CHAVE_MESTRA.
const net = require('node:net');
const mongoose = require('mongoose');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const { servidorAtivo } = require('./gestao');
const { chaveMestraConfigurada, cifrar, gerarSegredo } = require('./cifra');

const MAX_IPS = 10;
const MAX_CONEXOES_ATIVAS = 5;
const SEM_CHAVE = 'Falta a PONTE_CHAVE_MESTRA no .env do bot (base64 de 32 bytes). Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" e reinicie o bot.';

// "1.2.3.4, 5.6.7.8" → lista de IPs válidos, sem repetir. Vazio = qualquer IP.
function lerIps(texto) {
  const itens = [...new Set(String(texto || '').split(/[\s,;]+/).map(ip => ip.trim()).filter(Boolean))];
  const invalido = itens.find(ip => !net.isIP(ip));
  if (invalido) return { erro: `IP inválido: \`${invalido.slice(0, 50)}\`.` };
  if (itens.length > MAX_IPS) return { erro: `Até ${MAX_IPS} IPs por credencial.` };
  return { ips: itens };
}

// Conteúdo de scriptfiles/althea_credenciais.txt (seção 2 da especificação).
const arquivoCredenciais = (conexao, segredo) => `id=${conexao._id}\nsegredo=${segredo}\n`;

async function criarConexao({ guildId, nome, ips = '', criadoPor }) {
  if (!chaveMestraConfigurada()) return { erro: SEM_CHAVE };
  if (!(await servidorAtivo(guildId))) return { erro: 'A ponte com o jogo não está ativa neste servidor. Use /ativar.' };
  const nomeLimpo = String(nome || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 40);
  if (!nomeLimpo) return { erro: 'Nome inválido.' };
  const lidos = lerIps(ips);
  if (lidos.erro) return { erro: lidos.erro };
  const ativas = await PonteConexaoGm.countDocuments({ guildId: String(guildId), status: 'ativa' });
  if (ativas >= MAX_CONEXOES_ATIVAS) return { erro: `Limite de ${MAX_CONEXOES_ATIVAS} credenciais ativas. Revogue uma antes.` };

  const segredo = gerarSegredo();
  const conexao = await PonteConexaoGm.create({
    guildId: String(guildId),
    nome: nomeLimpo,
    segredoCifrado: cifrar(segredo),
    ultimos4: segredo.slice(-4),
    ipsPermitidos: lidos.ips,
    criadoPor: String(criadoPor)
  });
  return { segredo, conexao };
}

const listarConexoes = (guildId) =>
  PonteConexaoGm.find({ guildId: String(guildId) }, { segredoCifrado: 0 }).sort({ criadoEm: -1 }).limit(25).lean();

async function revogarConexao({ guildId, id, por, agora = new Date() }) {
  if (!mongoose.isValidObjectId(id)) return null;
  return PonteConexaoGm.findOneAndUpdate(
    { _id: id, guildId: String(guildId), status: 'ativa' },
    { $set: { status: 'revogada', revogadoEm: agora, revogadoPor: String(por) } },
    { new: true, projection: { segredoCifrado: 0 } }
  ).lean();
}

// Segredo novo: o antigo para de valer na hora. Só para credencial ativa.
async function renovarConexao({ guildId, id }) {
  if (!chaveMestraConfigurada()) return { erro: SEM_CHAVE };
  if (!mongoose.isValidObjectId(id)) return { erro: 'ID inválido.' };
  const segredo = gerarSegredo();
  const conexao = await PonteConexaoGm.findOneAndUpdate(
    { _id: id, guildId: String(guildId), status: 'ativa' },
    { $set: { segredoCifrado: cifrar(segredo), ultimos4: segredo.slice(-4) } },
    { new: true, projection: { segredoCifrado: 0 } }
  ).lean();
  if (!conexao) return { erro: 'Credencial ativa não encontrada neste servidor.' };
  return { segredo, conexao };
}

module.exports = { lerIps, arquivoCredenciais, criarConexao, listarConexoes, revogarConexao, renovarConexao, MAX_IPS, SEM_CHAVE };
