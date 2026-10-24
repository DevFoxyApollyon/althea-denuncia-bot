// Proteções do bot no Discord:
//
//   1. Freio por pessoa: quem dispara botões, menus ou comandos sem parar é
//      avisado e, se insistir, fica um minuto sem resposta. Evita que uma
//      pessoa (ou um script) ocupe o bot e estoure os limites do Discord.
//   2. Lista de servidores permitidos: com SERVIDORES_PERMITIDOS no .env, o bot
//      sai sozinho de qualquer servidor que não esteja na lista. Sem a
//      variável ele não sai de nenhum, só registra quando é adicionado a um novo.
//
// As menções em massa (@everyone, @here e cargos) são barradas na criação do
// cliente, em index.js: nenhum texto digitado por usuário consegue fazer o bot
// marcar todo mundo.
const { MessageFlags } = require('discord.js');

const JANELA_MS = 10 * 1000;
const MAXIMO_DE_INTERACOES = 12;
const MAXIMO_DE_COMANDOS = 5;
// Passou muito do limite: silêncio por este tempo, sem nem responder.
const ABUSO = 40;
const SILENCIO_MS = 60 * 1000;

function criarFreio(maximo, { janelaMs = JANELA_MS, abuso = ABUSO, silencioMs = SILENCIO_MS, agora = () => Date.now() } = {}) {
  const porPessoa = new Map();

  // 'ok' = pode seguir; 'avisar' = passou do limite (avisa uma vez por janela);
  // 'ignorar' = já foi avisada ou está em silêncio.
  return function conferir(usuarioId) {
    const instante = agora();
    let item = porPessoa.get(usuarioId);
    if (!item || instante - item.inicio >= janelaMs) {
      if (item?.silencioAte > instante) return 'ignorar';
      if (porPessoa.size > 5000) porPessoa.clear();
      item = { inicio: instante, usos: 0, avisada: false, silencioAte: 0 };
      porPessoa.set(usuarioId, item);
    }
    if (item.silencioAte > instante) return 'ignorar';

    item.usos += 1;
    if (item.usos <= maximo) return 'ok';
    if (item.usos > abuso) {
      item.silencioAte = instante + silencioMs;
      return 'ignorar';
    }
    if (item.avisada) return 'ignorar';
    item.avisada = true;
    return 'avisar';
  };
}

const freioDeInteracoes = criarFreio(MAXIMO_DE_INTERACOES);
const freioDeComandos = criarFreio(MAXIMO_DE_COMANDOS);

// Chamar antes de tratar uma interação. Devolve true quando ela deve ser barrada.
async function frearInteracao(interaction, log = console) {
  // O preenchimento automático dispara a cada tecla: não entra na conta.
  if (interaction.isAutocomplete?.()) return false;
  const resultado = freioDeInteracoes(interaction.user?.id || 'desconhecido');
  if (resultado === 'ok') return false;

  if (resultado === 'avisar') {
    log.warn?.(`[Proteção] ${interaction.user?.tag || interaction.user?.id} passou de ${MAXIMO_DE_INTERACOES} interações em 10 segundos e foi freado.`);
    await interaction.reply?.({
      content: '⏳ Você está clicando rápido demais. Aguarde alguns segundos e tente de novo.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }
  return true;
}

// O mesmo para os comandos com "!" escritos no chat.
function frearComando(message, log = console) {
  const resultado = freioDeComandos(message.author?.id || 'desconhecido');
  if (resultado === 'ok') return false;
  if (resultado === 'avisar') {
    log.warn?.(`[Proteção] ${message.author?.tag || message.author?.id} passou de ${MAXIMO_DE_COMANDOS} comandos em 10 segundos e foi freado.`);
    message.reply?.({ content: '⏳ Muitos comandos em pouco tempo. Aguarde alguns segundos.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  }
  return true;
}

// IDs de servidor em SERVIDORES_PERMITIDOS, separados por vírgula ou espaço. Vazio = sem lista.
function servidoresPermitidos(env = process.env) {
  return new Set(String(env.SERVIDORES_PERMITIDOS || '').split(/[\s,;]+/).map(id => id.trim()).filter(id => /^\d{15,21}$/.test(id)));
}

// Sai dos servidores fora da lista (quando ela existe) e avisa quando o bot entra num servidor novo.
function vigiarServidores(client, log = console) {
  const sairSeNaoPermitido = async (guild, motivo) => {
    const permitidos = servidoresPermitidos();
    if (!permitidos.size) {
      if (motivo === 'entrada') log.warn?.(`[Proteção] O bot foi adicionado ao servidor "${guild.name}" (${guild.id}, ${guild.memberCount || '?'} membros). Para ele sair sozinho de servidores que você não autorizou, defina SERVIDORES_PERMITIDOS no .env.`);
      return false;
    }
    if (permitidos.has(guild.id)) return false;
    log.warn?.(`[Proteção] Saindo do servidor "${guild.name}" (${guild.id}): não está em SERVIDORES_PERMITIDOS.`);
    await guild.leave().catch(erro => log.warn?.(`[Proteção] Não foi possível sair de ${guild.id}: ${erro.message}`));
    return true;
  };

  client.on('guildCreate', guild => { sairSeNaoPermitido(guild, 'entrada'); });
  client.once('clientReady', async () => {
    for (const guild of client.guilds.cache.values()) await sairSeNaoPermitido(guild, 'inicio');
  });
}

module.exports = { criarFreio, frearInteracao, frearComando, servidoresPermitidos, vigiarServidores };
