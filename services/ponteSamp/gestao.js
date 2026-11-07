// Códigos de ativação, guilds ativas e PCs (instalações) da ponte com o jogo.
const PonteServidor = require('../../models/PonteServidor');
const PonteCodigo = require('../../models/PonteCodigo');
const PonteInstalacao = require('../../models/PonteInstalacao');
const { LIMITE_PCS_PADRAO } = require('./constantes');
const { gerarToken, gerarCodigo, hashCodigo, sha256, ultimos4 } = require('./seguranca');

const DIA_MS = 24 * 60 * 60 * 1000;

// A ponte inteira pode ser desligada pelo .env sem mexer no banco.
const ponteLigada = () => String(process.env.PONTE_SAMP_ATIVA || '').trim() === '1';
const ehDono = (userId) => !!process.env.OWNER_DISCORD_ID && String(userId) === String(process.env.OWNER_DISCORD_ID).trim();

async function servidorAtivo(guildId) {
  if (!ponteLigada() || !guildId) return null;
  return PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
}

// Gera um código novo. O texto do código só existe no retorno desta função.
async function criarCodigo({ criadoPor, validadeDias = null, limitePcs = null, agora = new Date() }) {
  const codigo = gerarCodigo();
  const doc = await PonteCodigo.create({
    codigoHash: hashCodigo(codigo),
    ultimos4: ultimos4(codigo),
    criadoPor: String(criadoPor),
    criadoEm: agora,
    expiraEm: validadeDias ? new Date(agora.getTime() + validadeDias * DIA_MS) : null,
    limitePcs: limitePcs || null
  });
  return { codigo, doc };
}

// Consome o código de forma atômica (dois /ativar ao mesmo tempo: só um ganha)
// e liga a guild. Devolve { servidor } ou { erro }.
async function ativarGuild({ codigo, guildId, userId, agora = new Date() }) {
  const usado = await PonteCodigo.findOneAndUpdate(
    {
      codigoHash: hashCodigo(codigo),
      usadoEm: null,
      expirado: false,
      $or: [{ expiraEm: null }, { expiraEm: { $gt: agora } }]
    },
    { $set: { usadoEm: agora, usadoPorGuild: String(guildId), usadoPorUser: String(userId) } },
    { new: true }
  );
  if (!usado) return { erro: 'Código inválido, já usado ou expirado.' };

  const servidor = await PonteServidor.findOneAndUpdate(
    { guildId: String(guildId) },
    {
      $set: {
        ativo: true,
        ativadoEm: agora,
        ativadoPor: String(userId),
        codigoId: usado._id,
        limitePcs: usado.limitePcs || LIMITE_PCS_PADRAO,
        desativadoEm: null,
        desativadoPor: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { servidor };
}

async function desativarGuild({ guildId, por, agora = new Date() }) {
  return PonteServidor.findOneAndUpdate(
    { guildId: String(guildId) },
    { $set: { ativo: false, desativadoEm: agora, desativadoPor: String(por) } },
    { new: true }
  );
}

// Cria o PC e devolve o token uma única vez. Respeita o limite de PCs da guild.
async function criarInstalacao({ guildId, nome, criadoPor }) {
  const servidor = await servidorAtivo(guildId);
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor. Use /ativar.' };

  const nomeLimpo = String(nome || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 40);
  if (!nomeLimpo) return { erro: 'Nome do PC inválido.' };

  const ativos = await PonteInstalacao.countDocuments({ guildId: String(guildId), status: 'ativa' });
  if (ativos >= (servidor.limitePcs || LIMITE_PCS_PADRAO)) {
    return { erro: `Limite de ${servidor.limitePcs} PCs ativos atingido. Revogue um antes.` };
  }

  const token = gerarToken();
  const instalacao = await PonteInstalacao.create({
    guildId: String(guildId),
    nome: nomeLimpo,
    tokenHash: sha256(token),
    ultimos4: ultimos4(token),
    criadoPor: String(criadoPor)
  });
  return { token, instalacao };
}

const listarInstalacoes = (guildId) =>
  PonteInstalacao.find({ guildId: String(guildId) }).sort({ criadoEm: -1 }).limit(25).lean();

async function revogarInstalacao({ guildId, id, por, agora = new Date() }) {
  if (!PonteInstalacao.base.isValidObjectId(id)) return null;
  return PonteInstalacao.findOneAndUpdate(
    { _id: id, guildId: String(guildId) },
    { $set: { status: 'revogada', revogadoEm: agora, revogadoPor: String(por) } },
    { new: true }
  );
}

// Troca de PC: token novo, HWID zerado (o próximo PC a usar grava o dele).
async function renovarInstalacao({ guildId, id }) {
  if (!PonteInstalacao.base.isValidObjectId(id)) return { erro: 'ID inválido.' };
  const servidor = await servidorAtivo(guildId);
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor.' };
  const token = gerarToken();
  const instalacao = await PonteInstalacao.findOneAndUpdate(
    { _id: id, guildId: String(guildId) },
    { $set: { tokenHash: sha256(token), ultimos4: ultimos4(token), hwidHash: null, status: 'ativa', revogadoEm: null, revogadoPor: null } },
    { new: true }
  );
  if (!instalacao) return { erro: 'Instalação não encontrada neste servidor.' };
  return { token, instalacao };
}

module.exports = {
  ponteLigada,
  ehDono,
  servidorAtivo,
  criarCodigo,
  ativarGuild,
  desativarGuild,
  criarInstalacao,
  listarInstalacoes,
  revogarInstalacao,
  renovarInstalacao
};
