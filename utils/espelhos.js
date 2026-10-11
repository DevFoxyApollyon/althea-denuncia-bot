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

const PAUSA_ENTRE_TOPICOS_MS = 1200;
const IDADE_MINIMA_MS = 15 * 60 * 1000;
const INTERVALO_DA_LIMPEZA_MS = 60 * 60 * 1000;
const ESPERA_INICIAL_MS = 60 * 1000;
// Espelho parado por 1 hora é arquivado pelo próprio Discord. Arquivado ele não
// conta no limite, e volta sozinho quando o bot manda uma mensagem nova nele.
const ARQUIVAR_APOS_MINUTOS = 60;
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

// O que fazer com um espelho ativo:
//   'trancar'  - a denúncia foi finalizada ou já saiu do banco: tranca e arquiva;
//   'arquivar' - a denúncia segue aberta: só arquiva (ele reabre sozinho se chegar mensagem);
//   null       - recém-criado, ainda está recebendo as primeiras mensagens.
function destinoDoEspelho(denuncia, criadoEm, agora = Date.now()) {
  if (agora - criadoEm < IDADE_MINIMA_MS) return null;
  return !denuncia || STATUS_FECHADOS.includes(denuncia.status) ? 'trancar' : 'arquivar';
}

// Antes de editar uma mensagem dentro do espelho: o Discord não deixa editar em tópico arquivado.
async function reabrirEspelho(topico) {
  if (topico?.isThread?.() && topico.archived) await topico.setArchived(false, 'Atualização da cópia da denúncia.').catch(() => {});
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
      const destino = destinoDoEspelho(porTopico.get(topico.id), topico.createdTimestamp || 0);
      if (!destino) continue;
      try {
        if (destino === 'trancar') await fecharTopico(topico, 'Denúncia finalizada: espelho fechado.');
        else await topico.edit({ archived: true, autoArchiveDuration: ARQUIVAR_APOS_MINUTOS, reason: 'Espelho arquivado para liberar tópicos ativos.' });
        fechados += 1;
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
      if (ativos) console.log(`[Espelhos] ${ativos} tópico(s) espelho ativo(s); ${fechados} arquivado(s) para liberar o limite do servidor.`);
    } catch (erro) {
      console.warn(`[Espelhos] Falha na limpeza dos tópicos espelho: ${erro.message}`);
    } finally {
      rodando = false;
    }
  };

  setTimeout(rodar, ESPERA_INICIAL_MS).unref?.();
  setInterval(rodar, INTERVALO_DA_LIMPEZA_MS).unref?.();
}

module.exports = { ARQUIVAR_APOS_MINUTOS, fecharEspelhos, reabrirEspelho, limparEspelhosAbertos, iniciarLimpezaDeEspelhos, destinoDoEspelho };
