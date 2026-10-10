const { getConfig } = require('../utils/configCache');

const CACHE_SERVIDORES_MS = 60 * 1000;
const servidoresPorUsuario = new Map();

function papeisDoMembro(member, config) {
  const tem = (roleId) => Boolean(roleId && member.roles.cache.has(roleId));
  const responsavel = tem(config.roles?.responsavel_admin);
  const administrador = tem(config.roles?.administrador);

  return {
    responsavel,
    administrador,
    staff: responsavel || administrador,
    podeDenunciarPC: tem(config.roles?.pc),
    podeDenunciarMobile: tem(config.roles?.permitido)
  };
}

// Servidores em que o usuário é membro e o bot está configurado, com os papéis
// dele em cada um. O Discord é consultado no máximo uma vez por minuto por usuário.
async function servidoresDoUsuario(client, userId) {
  const emCache = servidoresPorUsuario.get(userId);
  if (emCache && Date.now() - emCache.em < CACHE_SERVIDORES_MS) return emCache.lista;

  // Todos os servidores ao mesmo tempo. O membro vem da memória do bot quando
  // já está lá (o Discord a mantém atualizada); só vai ao Discord quando falta.
  const lista = (await Promise.all([...client.guilds.cache.values()].map(async (guild) => {
    const config = await getConfig(guild.id).catch(() => null);
    if (!config) return null;

    const member = guild.members.cache.get(userId) || await guild.members.fetch({ user: userId }).catch(() => null);
    if (!member) return null;

    return { guild, member, config, papeis: papeisDoMembro(member, config) };
  }))).filter(Boolean);

  servidoresPorUsuario.set(userId, { em: Date.now(), lista });
  return lista;
}

async function acessoAoServidor(client, userId, guildId) {
  const servidores = await servidoresDoUsuario(client, userId);
  return servidores.find(item => item.guild.id === guildId) || null;
}

// Mesma regra dos tópicos restritos: denunciante, acusados e staff.
function relacaoComDenuncia(denuncia, userId, papeis) {
  if (papeis?.staff) return 'staff';
  if (denuncia.criadoPor === userId) return 'denunciante';
  if ((denuncia.acusadoUserIds || []).includes(userId)) return 'acusado';
  return null;
}

function limparCacheDeAcesso(userId) {
  if (userId) servidoresPorUsuario.delete(userId);
  else servidoresPorUsuario.clear();
}

module.exports = {
  papeisDoMembro,
  servidoresDoUsuario,
  acessoAoServidor,
  relacaoComDenuncia,
  limparCacheDeAcesso
};
