// Tópicos espelho: cópias de cada denúncia nos canais de armazém e de registro.
//
// O Discord aceita no máximo 1000 tópicos ativos por servidor. Se os espelhos
// nunca forem fechados, o limite estoura ("Maximum number of active threads
// reached") e as denúncias novas ficam sem cópia. Por isso o espelho é trancado
// e arquivado junto com o tópico da denúncia, e uma limpeza periódica fecha os
// que ficaram para trás.
const Denuncia = require('../models/Denuncia');
const Config = require('../models/Config');
const { buscarCanal } = require('./denunciaMensagens');

const PAUSA_ENTRE_TOPICOS_MS = 1500;
const IDADE_MINIMA_MS = 60 * 60 * 1000;
const INTERVALO_DA_LIMPEZA_MS = 6 * 60 * 60 * 1000;
const ESPERA_INICIAL_MS = 3 * 60 * 1000;
const STATUS_FECHADOS = ['finalizada'];

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tranca e arquiva um tópico. Devolve true se ele ficou fechado.
async function fecharTopico(topico, motivo) {
  if (!topico?.isThread?.()) return false;
  if (topico.archived) return true;
  if (!topico.locked) await topico.setLocked(true, motivo).catch(() => {});
  await topico.setArchived(true, motivo);
  // Tópico arquivado não precisa ficar na memória do bot.
  topico.guild?.channels.cache.delete(topico.id);
  return true;
}

// Fecha os espelhos de uma denúncia. Chamado quando o tópico dela é fechado.
async function fecharEspelhos(client, denunciaId, motivo = 'Denúncia finalizada.') {
  const denuncia = await Denuncia.findById(denunciaId).select('armazemThreadId registroThreadId').lean().catch(() => null);
  const ids = [...new Set([denuncia?.armazemThreadId, denuncia?.registroThreadId].filter(Boolean))];
  let fechados = 0;

  for (const id of ids) {
    try {
      if (await fecharTopico(await buscarCanal(client, id), motivo)) fechados += 1;
    } catch (erro) {
      console.warn(`[Espelhos] Não foi possível fechar o tópico espelho ${id}: ${erro.message}`);
    }
  }
  return fechados;
}

// Decide se um espelho ativo já pode ser fechado: a denúncia dele foi
// finalizada, ou o registro já saiu do banco (denúncia antiga). Espelho recém
// criado fica, porque a denúncia pode ainda não ter sido gravada.
function podeFechar(denuncia, criadoEm, agora = Date.now()) {
  if (agora - criadoEm < IDADE_MINIMA_MS) return false;
  return !denuncia || STATUS_FECHADOS.includes(denuncia.status);
}

// Varre os canais de espelho e fecha o que sobrou aberto de denúncias já finalizadas.
async function limparEspelhosAbertos(client) {
  const configs = await Config.find({}).select('channels.armazem channels.registro').lean();
  const canaisEspelho = new Set(configs.flatMap(config => [config.channels?.armazem, config.channels?.registro]).filter(Boolean));
  if (!canaisEspelho.size) return { ativos: 0, fechados: 0 };

  // Os canais de espelho podem estar em qualquer servidor em que o bot esteja.
  const servidores = new Map();
  for (const canalId of canaisEspelho) {
    const canal = await buscarCanal(client, canalId);
    if (canal?.guild) servidores.set(canal.guild.id, canal.guild);
  }

  let ativos = 0;
  let fechados = 0;
  for (const guild of servidores.values()) {
    const resposta = await guild.channels.fetchActiveThreads(false).catch((erro) => {
      console.warn(`[Espelhos] Não foi possível listar os tópicos ativos de ${guild.name}: ${erro.message}`);
      return null;
    });
    const topicos = [...(resposta?.threads?.values() || [])].filter(topico => canaisEspelho.has(topico.parentId));
    ativos += topicos.length;
    if (!topicos.length) continue;

    const ids = topicos.map(topico => topico.id);
    const denuncias = await Denuncia.find({ $or: [{ armazemThreadId: { $in: ids } }, { registroThreadId: { $in: ids } }] })
      .select('status armazemThreadId registroThreadId').lean();
    const porTopico = new Map();
    for (const denuncia of denuncias) {
      if (denuncia.armazemThreadId) porTopico.set(denuncia.armazemThreadId, denuncia);
      if (denuncia.registroThreadId) porTopico.set(denuncia.registroThreadId, denuncia);
    }

    for (const topico of topicos) {
      if (!podeFechar(porTopico.get(topico.id), topico.createdTimestamp || 0)) continue;
      try {
        if (await fecharTopico(topico, 'Denúncia finalizada: espelho fechado.')) fechados += 1;
      } catch (erro) {
        console.warn(`[Espelhos] Não foi possível fechar o tópico espelho ${topico.id}: ${erro.message}`);
      }
      // Devagar, para não bater no limite de requisições do Discord.
      await esperar(PAUSA_ENTRE_TOPICOS_MS);
    }
  }

  return { ativos, fechados };
}

function iniciarLimpezaDeEspelhos(client) {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const { ativos, fechados } = await limparEspelhosAbertos(client);
      if (ativos) console.log(`[Espelhos] ${ativos} tópico(s) espelho ativo(s); ${fechados} fechado(s) por serem de denúncias finalizadas.`);
    } catch (erro) {
      console.warn(`[Espelhos] Falha na limpeza dos tópicos espelho: ${erro.message}`);
    } finally {
      rodando = false;
    }
  };

  setTimeout(rodar, ESPERA_INICIAL_MS).unref?.();
  setInterval(rodar, INTERVALO_DA_LIMPEZA_MS).unref?.();
}

module.exports = { fecharEspelhos, limparEspelhosAbertos, iniciarLimpezaDeEspelhos, podeFechar };
