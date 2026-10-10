// Constantes e funções compartilhadas pelas rotas do site.
const Denuncia = require('../../models/Denuncia');
const AcessoCaso = require('../../models/AcessoCaso');
const { categoriaDoMotivo, prioridadeDoMotivo, prazoDoSla } = require('../categorias');

const STATUS_ABERTOS = ['pendente', 'reivindicacao', 'analise', 'aceita', 'recusada'];
const LIMITE_LISTA = 100;
const SERVIDOR_OCULTO_VISAO_ADMIN = '1248334449507041330';
const TAMANHO_MAX_MENSAGEM = 1500;
const EXTENSOES_PERMITIDAS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'ogg', 'wav', 'pdf', 'txt'
]);
// Mesmos limites dos campos do formulário do Discord.
const LIMITES_FORMULARIO = {
  PC: { acusado: 70, provas: 500 },
  Mobile: { acusado: 120, provas: 1000 }
};
const LIMITE_MOTIVO = 100;

const AVATAR = { size: 64, extension: 'webp' };

// Nome e foto de cada pessoa como aparecem no servidor (apelido e avatar do Discord).
async function resolverPessoas(client, guild, ids) {
  const unicos = [...new Set(ids)].filter(id => /^\d{15,21}$/.test(String(id || ''))).slice(0, 60);

  // Quem o bot ainda não tem em memória é buscado de uma vez só.
  const faltando = unicos.filter(id => !guild.members.cache.has(id));
  const buscados = faltando.length ? await guild.members.fetch({ user: faltando }).catch(() => null) : null;

  const pessoas = {};
  await Promise.all(unicos.map(async (id) => {
    const membro = guild.members.cache.get(id) || buscados?.get(id);
    if (membro) {
      // Cor do cargo mais alto, como o Discord pinta o nome (preto = sem cor).
      const cor = membro.displayHexColor && membro.displayHexColor !== '#000000' ? membro.displayHexColor : null;
      pessoas[id] = { nome: membro.displayName, avatar: membro.displayAvatarURL?.(AVATAR) || null, cor };
      return;
    }
    // Não está mais no servidor: mostra o nome da conta.
    const usuario = client.users.cache.get(id) || await client.users.fetch(id).catch(() => null);
    if (usuario) pessoas[id] = { nome: usuario.globalName || usuario.username, avatar: usuario.displayAvatarURL?.(AVATAR) || null };
  }));
  return pessoas;
}

// O bot publica as mensagens do site com um cabeçalho dizendo quem enviou.
// Se o registro da autoria no banco falhou, ela é recuperada daqui.
const CABECALHO_DO_SITE = /^(?:📎 \*\*Enviado pelo site\*\* por|Enviado por) <@!?(\d{15,21})>\n?/;

function atribuirAutoriaDoSite(mensagem) {
  if (!mensagem.doBot) return mensagem;
  const cabecalho = mensagem.conteudo.match(CABECALHO_DO_SITE);
  if (!cabecalho) return mensagem;
  return {
    ...mensagem,
    autorId: cabecalho[1],
    doBot: false,
    viaSite: true,
    conteudo: mensagem.conteudo.slice(cabecalho[0].length)
  };
}

// Menções do Discord (<@id>, <@&id>, <#id>) presentes num texto.
function extrairMencoes(texto) {
  const ids = { usuarios: [], cargos: [], canais: [] };
  for (const [, usuario, cargo, canal] of String(texto || '').matchAll(/<@!?(\d{15,21})>|<@&(\d{15,21})>|<#(\d{15,21})>/g)) {
    if (usuario) ids.usuarios.push(usuario);
    if (cargo) ids.cargos.push(cargo);
    if (canal) ids.canais.push(canal);
  }
  return ids;
}

// Nome e ícone mostrados antes do login. O servidor oculto nunca é exposto.
function infoPublicaDoSite(client) {
  const guild = [client.guilds.cache.get(process.env.GUILD_ID), ...client.guilds.cache.values()]
    .find(item => item && item.id !== SERVIDOR_OCULTO_VISAO_ADMIN);
  return { nome: guild?.name || 'Denúncias', icone: guild?.iconURL?.({ size: 128 }) || null };
}

const ATALHO_DO_SITE = '🔗 Acompanhe esta denúncia pelo site';
const escaparRegex = (texto) => String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Outras denúncias contra os mesmos IDs ("1039" também casa com "1039+2471").
async function historicoDoAcusado(denuncia) {
  const ids = String(denuncia.acusado || '').split('+').map(id => id.trim()).filter(Boolean).slice(0, 6);
  if (!ids.length) return null;

  const casos = await Denuncia.find({
    guildId: denuncia.guildId,
    _id: { $ne: denuncia._id },
    $or: ids.map(id => ({ acusado: new RegExp(`(^|\\+)\\s*${escaparRegex(id)}\\s*(\\+|$)`, 'i') }))
  }).sort({ dataCriacao: -1 }).limit(50).select('acusado motivo status dataCriacao').lean();

  const contar = (status) => casos.filter(caso => caso.status === status).length;
  return {
    total: casos.length,
    aceitas: contar('aceita'),
    recusadas: contar('recusada'),
    casos: casos.slice(0, 5).map(caso => ({
      id: String(caso._id), acusado: caso.acusado, motivo: caso.motivo, status: caso.status, dataCriacao: caso.dataCriacao
    }))
  };
}

// Registra a abertura de um caso pelo site, no máximo uma vez a cada 30 minutos
// por pessoa e caso (a tela recarrega sozinha várias vezes).
const JANELA_DE_ACESSO_MS = 30 * 60 * 1000;
const ultimosAcessos = new Map();

function registrarAcesso(denuncia, usuarioId, relacao) {
  const chave = `${usuarioId}:${denuncia._id}`;
  const agora = Date.now();
  if (agora - (ultimosAcessos.get(chave) || 0) < JANELA_DE_ACESSO_MS) return;
  if (ultimosAcessos.size > 5000) ultimosAcessos.clear();
  ultimosAcessos.set(chave, agora);

  AcessoCaso.create({
    denunciaId: denuncia._id,
    guildId: denuncia.guildId,
    usuarioId,
    relacao,
    expiraEm: denuncia.dataExpiracao || null
  }).catch(() => {});
}

const STATUS_DECIDIDOS = ['aceita', 'recusada', 'finalizada'];
const chaveDoDia = (data) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;

// Staff com o caso aberto agora, por tópico: evita duas pessoas analisando o mesmo.
const presencaPorTopico = new Map();
const conexoesPorUsuario = new Map();

function quemEstaVendo(threadId, excetoId) {
  const vistos = new Map();
  for (const pessoa of presencaPorTopico.get(threadId)?.values() || []) {
    if (pessoa.id !== excetoId) vistos.set(pessoa.id, pessoa.nome);
  }
  return [...vistos.values()];
}

// Primeiros bytes de cada formato aceito. Impede, por exemplo, um executável
// renomeado para .png. Texto puro (.txt) não tem assinatura: só não pode ter bytes nulos.
const ASSINATURAS = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  wav: [[0x52, 0x49, 0x46, 0x46]],
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  ogg: [[0x4f, 0x67, 0x67, 0x53]],
  mp3: [[0x49, 0x44, 0x33], [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]],
  webm: [[0x1a, 0x45, 0xdf, 0xa3]],
  mkv: [[0x1a, 0x45, 0xdf, 0xa3]]
};

function conteudoCombinaComExtensao(dados, extensao) {
  if (extensao === 'txt') return !dados.subarray(0, 4096).includes(0);
  // MP4 e MOV: a marca "ftyp" (ou "moov"/"mdat"/"wide" em MOVs antigos) fica a partir do 5º byte.
  if (extensao === 'mp4' || extensao === 'mov') {
    return ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(dados.subarray(4, 8).toString('latin1'));
  }
  const assinaturas = ASSINATURAS[extensao];
  return Boolean(assinaturas?.some(bytes => bytes.every((byte, indice) => dados[indice] === byte)));
}

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const assincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Limite de upload do servidor no Discord, com 1 MB de folga para o cabeçalho.
function limiteDeUploadBytes(guild) {
  const tier = Number(guild?.premiumTier) || 0;
  const base = tier >= 3 ? 100 : tier === 2 ? 50 : 10;
  return (base - 1) * 1024 * 1024;
}

function exigirDenunciaAberta(denuncia) {
  if (!STATUS_ABERTOS.includes(denuncia.status)) {
    throw new ErroHttp(409, 'Esta denúncia já foi finalizada e não aceita novas mensagens ou ações.');
  }
}

function criarLimitador(maximo, janelaMs) {
  const usos = new Map();
  return (chave) => {
    const agora = Date.now();
    const recentes = (usos.get(chave) || []).filter(instante => agora - instante < janelaMs);
    if (recentes.length >= maximo) {
      usos.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    usos.set(chave, recentes);
    if (usos.size > 5000) usos.clear();
    return true;
  };
}

function resumoDaDenuncia(denuncia, relacao) {
  return {
    id: String(denuncia._id),
    guildId: denuncia.guildId,
    acusado: denuncia.acusado,
    denunciante: denuncia.denunciante,
    motivo: denuncia.motivo,
    categoria: categoriaDoMotivo(denuncia.motivo, denuncia.guildId),
    prioridade: prioridadeDoMotivo(denuncia.motivo, denuncia.guildId),
    // SLA: até quando a staff deve reivindicar o caso.
    prazoSla: prazoDoSla(denuncia.motivo, denuncia.dataCriacao, denuncia.guildId),
    reivindicadaEm: denuncia.claimedAt || null,
    platform: denuncia.platform,
    status: denuncia.status,
    dataCriacao: denuncia.dataCriacao,
    claimedBy: denuncia.claimedBy || null,
    relacao,
    aberta: STATUS_ABERTOS.includes(denuncia.status)
  };
}

function serializarMensagemParaSite(mensagem, denunciaId, botId) {
  return {
    id: mensagem.mensagemId,
    autorId: mensagem.autorId,
    autorNome: mensagem.autorNome || 'Usuário',
    doBot: mensagem.autorId === botId && !mensagem.viaSite,
    viaSite: Boolean(mensagem.viaSite),
    conteudo: mensagem.conteudo || '',
    dataCriacao: mensagem.dataCriacao,
    editadaEm: mensagem.editadaEm || null,
    apagadaEm: mensagem.apagadaEm || null,
    embeds: (Array.isArray(mensagem.embeds) ? mensagem.embeds : [])
      .map(embed => ({ titulo: embed?.title || '', descricao: embed?.description || '' }))
      .filter(embed => embed.titulo || embed.descricao),
    anexos: (mensagem.anexos || []).map(anexo => ({
      id: anexo.id,
      nome: anexo.nome,
      tipo: anexo.tipo || '',
      tamanho: anexo.tamanho ?? null,
      url: `/api/denuncias/${denunciaId}/anexos/${mensagem.mensagemId}/${anexo.id}`
    }))
  };
}

module.exports = {
  STATUS_ABERTOS,
  LIMITE_LISTA,
  SERVIDOR_OCULTO_VISAO_ADMIN,
  TAMANHO_MAX_MENSAGEM,
  EXTENSOES_PERMITIDAS,
  LIMITES_FORMULARIO,
  LIMITE_MOTIVO,
  AVATAR,
  resolverPessoas,
  CABECALHO_DO_SITE,
  atribuirAutoriaDoSite,
  extrairMencoes,
  infoPublicaDoSite,
  ATALHO_DO_SITE,
  escaparRegex,
  historicoDoAcusado,
  JANELA_DE_ACESSO_MS,
  ultimosAcessos,
  registrarAcesso,
  STATUS_DECIDIDOS,
  chaveDoDia,
  presencaPorTopico,
  conexoesPorUsuario,
  quemEstaVendo,
  ASSINATURAS,
  conteudoCombinaComExtensao,
  ErroHttp,
  assincrono,
  limiteDeUploadBytes,
  exigirDenunciaAberta,
  criarLimitador,
  resumoDaDenuncia,
  serializarMensagemParaSite,
};
