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
// Tópico aberto há mais tempo que isto é fechado, seja de quem for: trancado nos canais de
// denúncia e de espelho; só arquivado nos outros canais (volta sozinho se alguém escrever).
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

const LIMITE_DE_TOPICOS_ATIVOS = 1000;

// Lê os tópicos ativos de todos os servidores do bot e diz o que é cada um e
// o que a limpeza faria com ele:
//   - espelhos (armazém e registro), em qualquer canal em que estejam: o canal
//     configurado pode ter mudado e os tópicos antigos ficam no anterior;
//   - o tópico da própria denúncia: finalizada, ou aberta há 7 dias ou mais;
//   - qualquer outro tópico dos canais de denúncia aberto há 7 dias ou mais;
//   - qualquer tópico de outro canal do servidor aberto há 7 dias ou mais (só arquiva).
async function classificarTopicos(client, agora = Date.now()) {
  const configs = await Config.find({}).select('channels.armazem channels.registro channels.pc channels.mobile').lean();
  const canaisEspelho = new Set(configs.flatMap(config => [config.channels?.armazem, config.channels?.registro]).filter(Boolean));
  const canaisPrincipais = configs.flatMap(config => [config.channels?.pc, config.channels?.mobile]).filter(Boolean);
  const canaisDeRegistro = new Set(configs.map(config => config.channels?.registro).filter(Boolean));
  const servidores = [];

  for (const guild of client.guilds.cache.values()) {
    const resposta = await guild.channels.fetchActiveThreads(false).catch((erro) => {
      console.warn(`[Espelhos] Não foi possível listar os tópicos ativos de ${guild.name}: ${erro.message}`);
      return null;
    });
    const todos = [...(resposta?.threads?.values() || [])];
    const servidor = { guild, total: todos.length, itens: [] };
    servidores.push(servidor);
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

    for (const topico of todos) {
      const achado = tipoPorTopico.get(topico.id);
      const idadeMs = agora - (topico.createdTimestamp || agora);
      // Sem registro no banco, só é espelho se estiver num canal de espelho ou tiver nome de espelho.
      const espelhoSemRegistro = !achado && ehEspelhoSemRegistro(topico);
      // Qualquer outro tópico aberto há 7 dias ou mais também é fechado: trancado nos canais
      // de denúncia; nos outros canais, só arquivado (não conta no limite e reabre com mensagem nova).
      const semDono = !achado && !espelhoSemRegistro && idadeMs >= IDADE_MAXIMA_MS;
      const antigo = semDono && canaisDeDenuncia.has(topico.parentId);
      const outro = semDono && !antigo;
      if (!achado && !espelhoSemRegistro && !semDono) continue;

      const tipo = antigo ? 'antigo' : outro ? 'outro' : achado?.tipo || (canaisDeRegistro.has(topico.parentId) ? 'registro' : 'armazem');
      let destino;
      if (tipo === 'antigo') destino = 'trancar';
      else if (tipo === 'outro') destino = 'arquivar';
      // Tópico da denúncia: trancado quando ela foi finalizada ou está aberta há 7 dias ou mais.
      else if (tipo === 'denuncia') destino = STATUS_FECHADOS.includes(achado.denuncia.status) || idadeMs >= IDADE_MAXIMA_MS ? 'trancar' : null;
      else destino = destinoDoEspelho(achado?.denuncia, topico.createdTimestamp || 0, agora);

      servidor.itens.push({ topico, tipo, destino, idadeMs });
    }
  }
  return servidores;
}

// Andamento da limpeza em curso, para o painel do site acompanhar.
const limpeza = { rodando: false, fechados: 0, previstos: 0, terminouEm: null };

// Fecha o que a classificação mandou fechar. Com soAntigos, só mexe nos
// tópicos abertos há 7 dias ou mais (o botão "limpar agora" do painel).
async function limparEspelhosAbertos(client, { soAntigos = false } = {}) {
  const porCanal = { armazem: 0, registro: 0, denuncia: 0, antigo: 0, outro: 0 };
  if (limpeza.rodando) return { ativos: 0, fechados: 0, porCanal, ocupado: true };

  limpeza.rodando = true;
  limpeza.fechados = 0;
  limpeza.previstos = 0;
  let ativos = 0;
  try {
    const servidores = await classificarTopicos(client);
    const aFechar = (servidor) => servidor.itens.filter(item => item.destino && (!soAntigos || item.idadeMs >= IDADE_MAXIMA_MS));
    limpeza.previstos = servidores.reduce((soma, servidor) => soma + aFechar(servidor).length, 0);

    for (const servidor of servidores) {
      let fechadosAqui = 0;
      for (const { topico, tipo, destino } of aFechar(servidor)) {
        try {
          // Tópico de outro canal: só arquiva, sem trancar e sem mudar o tempo de arquivamento dele.
          if (tipo === 'outro') await topico.setArchived(true, 'Tópico aberto há 7 dias ou mais arquivado para liberar tópicos ativos.');
          // Tópico com 7 dias ou mais é sempre trancado, mesmo sendo espelho de denúncia em andamento.
          else if (destino === 'trancar' || soAntigos) await fecharTopico(topico, 'Tópico de denúncia fechado pela limpeza.');
          else await topico.edit({ archived: true, autoArchiveDuration: ARQUIVAR_APOS_MINUTOS, reason: 'Espelho arquivado para liberar tópicos ativos.' });
          fechadosAqui += 1;
          limpeza.fechados += 1;
          porCanal[tipo] += 1;
        } catch (erro) {
          console.warn(`[Espelhos] Não foi possível fechar o tópico ${topico.id} (${topico.name}): ${erro.message}`);
        }
        // Devagar, para não bater no limite de requisições do Discord.
        await esperar(PAUSA_ENTRE_TOPICOS_MS);
      }
      if (servidor.itens.length) console.log(`[Espelhos] ${servidor.guild.name}: ${servidor.total} tópico(s) ativo(s) no servidor, ${servidor.itens.length} para a limpeza, ${fechadosAqui} fechado(s).`);
      ativos += servidor.itens.length;
    }
    resumoGuardado = null;
    return { ativos, fechados: limpeza.fechados, porCanal };
  } finally {
    limpeza.rodando = false;
    limpeza.terminouEm = new Date();
  }
}

// Números para o painel do site: quantos tópicos ativos cada servidor tem e
// quantos a limpeza fecharia. Guardado por um minuto para não consultar o Discord a cada clique.
let resumoGuardado = null;
async function resumoDosTopicos(client, { forcar = false } = {}) {
  if (!forcar && resumoGuardado && Date.now() - resumoGuardado.em < 60 * 1000) return { ...resumoGuardado.dados, limpeza: { ...limpeza } };
  const servidores = (await classificarTopicos(client)).map(servidor => ({
    id: servidor.guild.id,
    nome: servidor.guild.name,
    ativos: servidor.total,
    limite: LIMITE_DE_TOPICOS_ATIVOS,
    deDenuncias: servidor.itens.filter(item => item.tipo !== 'outro').length,
    antigos: servidor.itens.filter(item => item.destino && item.idadeMs >= IDADE_MAXIMA_MS).length,
    deOutrosCanais: servidor.itens.filter(item => item.tipo === 'outro').length
  })).sort((a, b) => b.ativos - a.ativos);
  resumoGuardado = { em: Date.now(), dados: { servidores, conferidoEm: new Date() } };
  return { ...resumoGuardado.dados, limpeza: { ...limpeza } };
}

function iniciarLimpezaDeEspelhos(client) {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const { ativos, fechados, porCanal, ocupado } = await limparEspelhosAbertos(client);
      if (ocupado) return;
      if (ativos) console.log(`[Espelhos] Total: ${fechados} tópico(s) fechado(s): ${porCanal.registro} no registro, ${porCanal.armazem} no armazém, ${porCanal.denuncia} de denúncias (finalizadas ou abertas há 7 dias ou mais), ${porCanal.antigo} aberto(s) há 7 dias ou mais nos canais de denúncia e ${porCanal.outro} arquivado(s) em outros canais.`);
    } catch (erro) {
      console.warn(`[Espelhos] Falha na limpeza dos tópicos espelho: ${erro.message}`);
    } finally {
      rodando = false;
    }
  };

  setTimeout(rodar, ESPERA_INICIAL_MS).unref?.();
  setInterval(rodar, INTERVALO_DA_LIMPEZA_MS).unref?.();
}

module.exports = { ARQUIVAR_APOS_MINUTOS, fecharEspelhos, reabrirEspelho, limparEspelhosAbertos, resumoDosTopicos, iniciarLimpezaDeEspelhos, destinoDoEspelho };
