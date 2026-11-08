// Códigos de ativação e guilds ativas da ponte com o jogo.
const PonteServidor = require('../../models/PonteServidor');
const PonteCodigo = require('../../models/PonteCodigo');
const { gerarCodigo, hashCodigo, ultimos4 } = require('./seguranca');

const DIA_MS = 24 * 60 * 60 * 1000;

// A ponte inteira pode ser desligada pelo .env sem mexer no banco.
const ponteLigada = () => String(process.env.PONTE_SAMP_ATIVA || '').trim() === '1';
const ehDono = (userId) => !!process.env.OWNER_DISCORD_ID && String(userId) === String(process.env.OWNER_DISCORD_ID).trim();

async function servidorAtivo(guildId) {
  if (!ponteLigada() || !guildId) return null;
  return PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
}

// Gera um código novo. O texto do código só existe no retorno desta função.
async function criarCodigo({ criadoPor, validadeDias = null, agora = new Date() }) {
  const codigo = gerarCodigo();
  const doc = await PonteCodigo.create({
    codigoHash: hashCodigo(codigo),
    ultimos4: ultimos4(codigo),
    criadoPor: String(criadoPor),
    criadoEm: agora,
    expiraEm: validadeDias ? new Date(agora.getTime() + validadeDias * DIA_MS) : null
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

module.exports = {
  ponteLigada,
  ehDono,
  servidorAtivo,
  criarCodigo,
  ativarGuild,
  desativarGuild
};
