// Estabilidade com o banco (MongoDB) instável:
//  - comRepeticao: repete uma operação importante quando o banco pisca (queda de conexão,
//    "timed out", troca de primário), em vez de perder a gravação;
//  - iniciarAlertaBanco: avisa no Log administrativo de cada servidor quando um banco fica
//    fora do ar por mais de 1 minuto, e de novo quando ele volta.
const { EmbedBuilder } = require('discord.js');
const { Logger } = require('./logger');

const log = new Logger({ tag: 'Banco' });
const AVISAR_APOS_MS = 60 * 1000;
const ATUALIZAR_CANAIS_MS = 10 * 60 * 1000;

// Erro passageiro de rede ou de seleção de servidor: vale tentar de novo.
function erroPassageiro(erro) {
  const nome = String(erro?.name || '');
  const texto = String(erro?.message || '');
  return /MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongoPoolClearedError|MongoNotConnectedError/.test(nome)
    || /timed out|ECONNRESET|ECONNREFUSED|EPIPE|not primary|NotWritablePrimary|connection .* closed|Client must be connected/i.test(texto);
}

// Executa fn; se der erro passageiro, espera e tenta de novo (até "tentativas" vezes no total).
// Qualquer outro erro (validação, duplicado) volta na hora, sem repetir.
async function comRepeticao(fn, { tentativas = 3, esperaMs = 1500, nome = 'operação' } = {}) {
  let ultimo;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (erro) {
      ultimo = erro;
      if (!erroPassageiro(erro) || i === tentativas) break;
      log.warn(`${nome}: banco instável (${erro.message}); tentando de novo (${i + 1}/${tentativas}).`);
      await new Promise(resolve => setTimeout(resolve, esperaMs * i));
    }
  }
  throw ultimo;
}

// Canal do Log administrativo de cada servidor, guardado enquanto o banco está no ar
// (com ele fora, a configuração não pode ser lida).
const canaisDeAviso = new Map();
async function atualizarCanais(client) {
  const { getConfig } = require('./configCache');
  for (const guildId of client.guilds.cache.keys()) {
    const config = await getConfig(guildId).catch(() => null);
    if (config?.channels?.log) canaisDeAviso.set(guildId, config.channels.log);
  }
}

async function avisar(client, texto, cor) {
  const embed = new EmbedBuilder().setColor(cor).setTitle('🗄️ Banco de dados').setDescription(texto).setTimestamp();
  for (const canalId of new Set(canaisDeAviso.values())) {
    const canal = await client.channels.fetch(canalId).catch(() => null);
    if (canal?.send) await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }
}

function vigiar(client, conexao, nome) {
  let foraDesde = null;
  let avisado = false;
  let relogio = null;
  conexao.on('disconnected', () => {
    if (foraDesde) return;
    foraDesde = Date.now();
    relogio = setTimeout(() => {
      if (!foraDesde) return;
      avisado = true;
      log.warn(`Banco ${nome} fora do ar há mais de 1 minuto.`);
      avisar(client, `⚠️ O banco **${nome}** está fora do ar há mais de 1 minuto. Botões, painel e envios ao jogo podem falhar até ele voltar. O bot tenta reconectar sozinho.`, '#E67E22')
        .catch(() => {});
    }, AVISAR_APOS_MS);
    relogio.unref?.();
  });
  const voltou = () => {
    if (!foraDesde) return;
    const minutos = Math.max(1, Math.round((Date.now() - foraDesde) / 60000));
    clearTimeout(relogio);
    foraDesde = null;
    if (!avisado) return;
    avisado = false;
    log.info(`Banco ${nome} voltou depois de ${minutos} min.`);
    avisar(client, `✅ O banco **${nome}** voltou depois de ${minutos} min fora do ar.`, '#2ECC71').catch(() => {});
  };
  conexao.on('connected', voltou);
  conexao.on('reconnected', voltou);
}

function iniciarAlertaBanco(client) {
  const { primaryConnection, secondaryConnection } = require('./persistencia');
  vigiar(client, primaryConnection, 'principal');
  vigiar(client, secondaryConnection, 'secundário');
  atualizarCanais(client).catch(() => {});
  setInterval(() => atualizarCanais(client).catch(() => {}), ATUALIZAR_CANAIS_MS).unref();
}

module.exports = { comRepeticao, erroPassageiro, iniciarAlertaBanco, avisarNoLog: avisar };
