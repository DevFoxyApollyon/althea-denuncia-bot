const { getConfig } = require('../utils/configCache');
const { AsyncLocalStorage } = require('async_hooks');
const { avisarAcesso } = require('../utils/eventosDenuncia');

// Dados do pedido em andamento (método e caminho), para o modo somente leitura
// valer em todas as rotas sem cada uma ter que conferir.
const pedidoAtual = new AsyncLocalStorage();
const METODOS_QUE_ALTERAM = ['POST', 'PUT', 'PATCH', 'DELETE'];
// O que continua funcionando com o site só para consulta: ativar notificações e sessões da própria conta.
const LIVRES_NO_SOMENTE_LEITURA = ['/push', '/sessoes'];

const acompanharPedido = (req, res, next) => pedidoAtual.run({ metodo: req.method, caminho: req.path }, next);

// Com o site em modo somente leitura, só o responsável consegue enviar ou alterar algo.
function exigirEscritaLiberada(config, papeis) {
  const pedido = pedidoAtual.getStore();
  if (!pedido || !METODOS_QUE_ALTERAM.includes(pedido.metodo)) return;
  if (!config?.siteSomenteLeitura || papeis?.responsavel) return;
  if (LIVRES_NO_SOMENTE_LEITURA.some(caminho => pedido.caminho.startsWith(caminho))) return;
  throw Object.assign(new Error('O site está em modo somente leitura para manutenção. Dá para consultar tudo, mas não enviar nem alterar. Tente de novo mais tarde.'), { status: 503 });
}

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
  const acesso = servidores.find(item => item.guild.id === guildId) || null;
  if (acesso) exigirEscritaLiberada(acesso.config, acesso.papeis);
  return acesso;
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

// O que o site mostra de um membro: cargos e apelido. Mudou um dos dois?
function mudouParaOSite(antes, depois) {
  // Sem o estado anterior (membro que o bot ainda não tinha em memória), confere por garantia.
  if (!antes || antes.partial || !antes.roles?.cache) return true;
  if (antes.nickname !== depois.nickname) return true;
  const cargosAntes = antes.roles.cache;
  const cargosDepois = depois.roles.cache;
  return cargosAntes.size !== cargosDepois.size || [...cargosDepois.keys()].some(id => !cargosAntes.has(id));
}

// Perdeu ou ganhou um cargo no Discord, mudou o apelido, entrou ou saiu do
// servidor: o acesso guardado é descartado e o site aberto dessa pessoa se
// atualiza na hora, sem precisar recarregar a página.
function acompanharMudancasDeAcesso(client) {
  const renovar = (userId) => {
    if (!userId) return;
    servidoresPorUsuario.delete(userId);
    avisarAcesso(userId);
  };
  client.on('guildMemberUpdate', (antes, depois) => {
    if (mudouParaOSite(antes, depois)) renovar(depois.id);
  });
  client.on('guildMemberRemove', (membro) => renovar(membro.id));
  client.on('guildMemberAdd', (membro) => renovar(membro.id));
}

module.exports = {
  acompanharPedido,
  exigirEscritaLiberada,
  pedidoAtual,
  mudouParaOSite,
  acompanharMudancasDeAcesso,
  papeisDoMembro,
  servidoresDoUsuario,
  acessoAoServidor,
  relacaoComDenuncia,
  limparCacheDeAcesso
};
