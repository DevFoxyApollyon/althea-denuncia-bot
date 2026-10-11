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
// Tópico parado nos canais de denúncia e de espelho há mais tempo que isto é fechado, seja de quem for.
const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;

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

// Os espelhos são criados com o nome "Denúncia <id da mensagem>".
const NOME_DE_ESPELHO = /^Denúncia \d{15,21}$/;

// Varre os tópicos ativos de todos os servidores do bot e arquiva:
//   - os espelhos (armazém e registro), em qualquer canal em que estejam: o
//     canal configurado pode ter mudado e os tópicos antigos ficam no anterior;
//   - o tópico da própria denúncia, quando ela já está finalizada.
async function limparEspelhosAbertos(client) {
  const configs = await Config.find({}).select('channels.armazem channels.registro channels.pc channels.mobile').lean();
  const canaisEspelho = new Set(configs.flatMap(config => [config.channels?.armazem, config.channels?.registro]).filter(Boolean));
  const canaisPrincipais = configs.flatMap(config => [config.channels?.pc, config.channels?.mobile]).filter(Boolean);
  const canaisDeRegistro = new Set(configs.map(config => config.channels?.registro).filter(Boolean));
  const porCanal = { armazem: 0, registro: 0, denuncia: 0, antigo: 0 };
  let ativos = 0;
  let fechados = 0;

  for (const guild of client.guilds.cache.values()) {
    const resposta = await guild.channels.fetchActiveThreads(false).catch((erro) => {
      console.warn(`[Espelhos] Não foi possível listar os tópicos ativos de ${guild.name}: ${erro.message}`);
      return null;
    });
    const todos = [...(resposta?.threads?.values() || [])];
    if (!todos.length) continue;

    const ids = todos.map(topico => topico.id);
    const denuncias = await Denuncia.find({ $or: [{ threadId: { $in: ids } }, { armazemThreadId: { $in: ids } }, { registroThreadId: { $in: ids } }] })
      .select('status threadId armazemThreadId registroThreadId').lean();
    const tipoPorTopico = new Map();
    for (const denuncia of denuncias) {
      if (denuncia.threadId) tipoPorTopico.set(denuncia.threadId, { tipo: 'denuncia', denuncia });
      if (denuncia.armazemThreadId) tipoPorTopico.set(denuncia.armazemThreadId, { tipo: 'armazem', denuncia });
      if (denuncia.registroThreadId) tipoPorTopico.set(denuncia.registroThreadId, { tipo: 'registro', denuncia });
    }

    // Canais de denúncia deste servidor: os configurados e todo canal que tenha
    // um tópico de denúncia ou de espelho (canais antigos, fora do painel).
    const ehEspelhoSemRegistro = (topico) => canaisEspelho.has(topico.parentId) || NOME_DE_ESPELHO.test(topico.name || '');
    const canaisDeDenuncia = new Set([...canaisEspelho, ...canaisPrincipais]);
    for (const topico of todos) {
      if (tipoPorTopico.has(topico.id) || ehEspelhoSemRegistro(topico)) canaisDeDenuncia.add(topico.parentId);
    }

    let ativosAqui = 0;
    let fechadosAqui = 0;
    const agora = Date.now();
    for (const topico of todos) {
      const achado = tipoPorTopico.get(topico.id);
      // Sem registro no banco, só é espelho se estiver num canal de espelho ou tiver nome de espelho.
      const espelhoSemRegistro = !achado && ehEspelhoSemRegistro(topico);
      // Qualquer outro tópico desses canais aberto há 7 dias ou mais também é fechado.
      const antigo = !achado && !espelhoSemRegistro && canaisDeDenuncia.has(topico.parentId)
        && agora - (topico.createdTimestamp || agora) >= IDADE_MAXIMA_MS;
      if (!achado && !espelhoSemRegistro && !antigo) continue;

      const tipo = antigo ? 'antigo' : achado?.tipo || (canaisDeRegistro.has(topico.parentId) ? 'registro' : 'armazem');
      let destino;
      if (tipo === 'antigo') {
        destino = 'trancar';
      } else if (tipo === 'denuncia') {
        // O tópico da denúncia só é mexido aqui quando ela já foi finalizada.
        if (!STATUS_FECHADOS.includes(achado.denuncia.status)) continue;
        destino = 'trancar';
      } else {
        destino = destinoDoEspelho(achado?.denuncia, topico.createdTimestamp || 0);
      }
      ativosAqui += 1;
      if (!destino) continue;

      try {
        if (destino === 'trancar') await fecharTopico(topico, 'Denúncia finalizada: tópico fechado.');
        else await topico.edit({ archived: true, autoArchiveDuration: ARQUIVAR_APOS_MINUTOS, reason: 'Espelho arquivado para liberar tópicos ativos.' });
        fechadosAqui += 1;
        porCanal[tipo] += 1;
      } catch (erro) {
        console.warn(`[Espelhos] Não foi possível fechar o tópico ${topico.id} (${topico.name}): ${erro.message}`);
      }
      // Devagar, para não bater no limite de requisições do Discord.
      await esperar(PAUSA_ENTRE_TOPICOS_MS);
    }

    if (ativosAqui) console.log(`[Espelhos] ${guild.name}: ${todos.length} tópico(s) ativo(s) no servidor, ${ativosAqui} de denúncias/espelhos, ${fechadosAqui} fechado(s).`);
    ativos += ativosAqui;
    fechados += fechadosAqui;
  }

  return { ativos, fechados, porCanal };
}

function iniciarLimpezaDeEspelhos(client) {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const { ativos, fechados, porCanal } = await limparEspelhosAbertos(client);
      if (ativos) console.log(`[Espelhos] Total: ${fechados} tópico(s) fechado(s): ${porCanal.registro} no registro, ${porCanal.armazem} no armazém ${porCanal.denuncia} de denúncias finalizadas e ${porCanal.antigo} aberto(s) há 7 dias ou mais.`);
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
