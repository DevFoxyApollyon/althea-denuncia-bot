// Aviso de gamemode offline.
//
// A cada minuto confere as credenciais ativas dos servidores que aplicam pela
// gamemode. Se uma passou 5 minutos sem buscar pedidos (servidor do jogo caiu, IP
// bloqueado pela trava, credencial errada...), o bot avisa uma vez no Log Admin e
// por notificação do navegador para o dono. Quando ela volta a buscar, avisa que
// voltou. A marca fica no banco (alertaOfflineEm), então um reinício do bot não
// repete o aviso.
const { EmbedBuilder } = require('discord.js');
const PonteConexaoGm = require('../models/PonteConexaoGm');
const PonteServidor = require('../models/PonteServidor');
const PonteUso = require('../models/PonteUso');
const { getConfig } = require('../utils/configCache');
const { Logger } = require('../utils/logger');

const log = new Logger({ tag: 'AlertaGamemode' });

const OFFLINE_MS = 5 * 60 * 1000;
const INTERVALO_MS = 60 * 1000;
const EXECUTORES_GM = ['gamemode', 'ambos'];

let rodando = false;

const minutos = (ms) => Math.max(1, Math.round(ms / 60000));

// Por que ela pode estar sem buscar: a última recusa da API para esta credencial.
async function ultimaRecusa(conexaoId, desde) {
  const uso = await PonteUso.findOne({ acao: 'gm_auth_falhou', 'detalhes.conexaoId': String(conexaoId), em: { $gte: desde } })
    .sort({ em: -1 }).lean().catch(() => null);
  if (!uso) return null;
  const codigo = uso.detalhes?.codigo || '?';
  const explicacao = {
    IP: `o IP ${uso.ip || '?'} não está na trava por IP da credencial. Libere o IP na aba Controle do painel da ponte.`,
    GUILD_INATIVA: 'o executor deste servidor está no PC da staff, ou a ponte foi desativada.',
    REVOGADA: 'a credencial foi revogada.',
    ASSINATURA: 'a assinatura não confere: o arquivo de credenciais da gamemode pode estar errado.',
    RELOGIO: 'o relógio do servidor do jogo está errado.',
    CREDENCIAL: 'a credencial não existe mais.'
  }[codigo];
  return `Última recusa: **${codigo}**${explicacao ? ` (${explicacao})` : ''}`;
}

async function avisar(client, guildId, embed) {
  const config = await getConfig(guildId).catch(() => null);
  const canalId = config?.channels?.log;
  const canal = canalId && client ? await client.channels.fetch(canalId).catch(() => null) : null;
  if (canal?.send) await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(e => log.warn(`Falha ao avisar no Log Admin: ${e.message}`));
}

async function notificarDono(titulo, corpo) {
  const dono = String(process.env.OWNER_DISCORD_ID || '').trim();
  if (!dono) return;
  await require('../site/push').enviarPush([dono], { titulo, corpo, url: '/admin#controle', tag: 'gamemode-offline' }).catch(() => {});
}

async function conferirGamemodes(client, agora = Date.now()) {
  if (rodando) return { offline: 0, voltaram: 0 };
  rodando = true;
  const resumo = { offline: 0, voltaram: 0 };
  try {
    const servidores = await PonteServidor.find({ ativo: true, executor: { $in: EXECUTORES_GM }, 'gm.pausado': { $ne: true } }, { guildId: 1 }).lean();
    if (!servidores.length) return resumo;
    const conexoes = await PonteConexaoGm.find({
      guildId: { $in: servidores.map(s => s.guildId) },
      status: 'ativa',
      pausada: { $ne: true },
      // Só quem já conectou alguma vez: credencial recém-criada ainda não tem por que avisar.
      ultimoContatoEm: { $ne: null }
    }).lean();

    for (const c of conexoes) {
      const parada = agora - new Date(c.ultimoContatoEm).getTime();
      const nomeGuild = client?.guilds?.cache?.get(c.guildId)?.name || c.guildId;

      if (parada >= OFFLINE_MS && !c.alertaOfflineEm) {
        const marcada = await PonteConexaoGm.updateOne({ _id: c._id, alertaOfflineEm: null }, { $set: { alertaOfflineEm: new Date(agora) } });
        if (!marcada.modifiedCount) continue;
        resumo.offline++;
        const motivo = await ultimaRecusa(c._id, new Date(c.ultimoContatoEm));
        log.warn(`Gamemode "${c.nome}" (${nomeGuild}) sem buscar pedidos há ${minutos(parada)} min.`);
        await avisar(client, c.guildId, new EmbedBuilder()
          .setColor('#E67E22')
          .setTitle('🔌 Gamemode sem conectar')
          .setDescription([
            `A gamemode **${c.nome}** não busca pedidos há **${minutos(parada)} min**. Punições aceitas ficam na fila até ela voltar.`,
            '',
            motivo || 'Sem recusa registrada: o servidor do jogo pode estar desligado ou sem internet.',
            c.ultimoIp && `Último contato de \`${c.ultimoIp}\`.`
          ].filter(Boolean).join('\n'))
          .setFooter({ text: 'Painel da ponte › Controle' })
          .setTimestamp());
        await notificarDono('Gamemode sem conectar', `${c.nome} não busca pedidos há ${minutos(parada)} min.`);
      } else if (parada < OFFLINE_MS && c.alertaOfflineEm) {
        await PonteConexaoGm.updateOne({ _id: c._id }, { $set: { alertaOfflineEm: null } });
        resumo.voltaram++;
        const fora = agora - new Date(c.alertaOfflineEm).getTime() + OFFLINE_MS;
        log.info(`Gamemode "${c.nome}" (${nomeGuild}) voltou a buscar pedidos.`);
        await avisar(client, c.guildId, new EmbedBuilder()
          .setColor('#2ECC71')
          .setTitle('✅ Gamemode conectada de novo')
          .setDescription(`A gamemode **${c.nome}** voltou a buscar pedidos depois de ~${minutos(fora)} min. A fila segue normal.`)
          .setTimestamp());
        await notificarDono('Gamemode conectada de novo', `${c.nome} voltou a buscar pedidos.`);
      }
    }
    return resumo;
  } catch (erro) {
    log.warn(`Falha ao conferir as gamemodes: ${erro.message}`);
    return resumo;
  } finally {
    rodando = false;
  }
}

function iniciarAlertaGamemode(client) {
  setInterval(() => conferirGamemodes(client), INTERVALO_MS).unref();
}

module.exports = { OFFLINE_MS, conferirGamemodes, iniciarAlertaGamemode };
