// Punição aceita no Discord que ficou parada na fila do jogo (ninguém aplicou): avisa a staff no Log Admin.
// Um aviso por punição; se continuar parada, repete depois de REPETIR_MS.
const { EmbedBuilder } = require('discord.js');
const PontePunicao = require('../../models/PontePunicao');
const { getConfig } = require('../../utils/configCache');
const { Logger } = require('../../utils/logger');
const { ponteLigada } = require('./gestao');

const log = new Logger({ tag: 'PonteParadas' });

const MIN_PARADA = Math.max(5, Number(process.env.PONTE_PARADA_MIN) || 30);
const REPETIR_MS = 2 * 60 * 60 * 1000;
const VERIFICAR_MS = 5 * 60 * 1000;

let intervalo = null;

// Punições que passaram de "minutos" na fila sem ninguém aplicar e ainda não foram avisadas (ou já passou o REPETIR_MS).
function filtroDeParadas(agora = Date.now(), minutos = MIN_PARADA) {
  const limite = new Date(agora - minutos * 60 * 1000);
  const repetir = new Date(agora - REPETIR_MS);
  return {
    status: 'aceita',
    aceitoEm: { $lt: limite },
    $or: [{ alertaParadaEm: null }, { alertaParadaEm: { $lt: repetir } }]
  };
}

async function avisarParadas(client, agora = Date.now()) {
  if (!client || !ponteLigada()) return 0;
  const lista = await PontePunicao.find(filtroDeParadas(agora)).sort({ aceitoEm: 1 }).limit(20).lean();
  let avisadas = 0;
  for (const p of lista) {
    try {
      const config = await getConfig(p.guildId);
      const canal = config?.channels?.log ? await client.channels.fetch(config.channels.log).catch(() => null) : null;
      // Marca mesmo sem canal para não tentar de novo a cada 5 minutos.
      await PontePunicao.updateOne({ _id: p._id }, { $set: { alertaParadaEm: new Date(agora) } });
      if (!canal?.send) continue;
      const cargo = config?.roles?.responsavel_admin;
      const minutos = Math.round((agora - new Date(p.aceitoEm).getTime()) / 60000);
      const nomes = (p.alvos || []).filter(a => !a.removido).map(a => `\`${a.nick || a.contaId || '?'}\``).join(', ') || 'sem jogadores';
      const link = p.msgDiscord?.link || '';
      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('⏳ Punição parada na fila do jogo')
        .setDescription(`A denúncia de ${nomes} foi aceita há **${minutos} min** e ainda não foi aplicada. Abra o painel do jogo (Alt+0) para aplicar ou tirar da fila.`)
        .addFields(
          { name: '✅ Aceita por', value: String(p.aceitoPor?.nome || 'Não registrado').slice(0, 100), inline: true },
          { name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link', inline: true }
        )
        .setFooter({ text: 'Aviso automático da ponte com o jogo' })
        .setTimestamp();
      await canal.send({ content: cargo ? `<@&${cargo}>` : undefined, embeds: [embed], allowedMentions: { roles: cargo ? [cargo] : [] } });
      avisadas += 1;
    } catch (erro) {
      log.warn(`Falha ao avisar punição parada ${p._id}: ${erro.message}`);
    }
  }
  return avisadas;
}

function iniciarAvisoParadas(client) {
  if (intervalo || !ponteLigada()) return;
  intervalo = setInterval(() => {
    avisarParadas(client).catch(erro => log.warn('Verificação de punições paradas falhou: ' + erro.message));
  }, VERIFICAR_MS);
  intervalo.unref?.();
  log.info(`Aviso de punição parada ligado (${MIN_PARADA} min na fila).`);
}

module.exports = { avisarParadas, iniciarAvisoParadas, filtroDeParadas, MIN_PARADA };
