// Liga o aceite da denúncia no Discord à fila de envio à gamemode. Nada aqui
// pode quebrar o aceite normal: todo erro é engolido e só vai para o log.
const PontePunicao = require('../../models/PontePunicao');
const { servidorAtivo } = require('./gestao');
const { RE_CONTA, RE_NICK, limparMotivo, classificarMotivo, separarContas } = require('./validacao');
const { obterTabela } = require('./motivos');
const { CMD_PADRAO, TEMPO_PADRAO } = require('./constantes');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteAceite' });
const AGUARDANDO = '➱ Motivo fora da tabela: aguardando correção';
const LIBERADO = '➱ Motivo cadastrado na tabela: liberado para enviar ao jogo';
// Mensagens antigas (do tempo do PC da staff) ainda têm este texto.
const AGUARDANDO_ANTIGO = '➱ Motivo fora da tabela: aguardando no painel';
const linhaAguardando = (texto) => [AGUARDANDO, AGUARDANDO_ANTIGO].find(l => texto.includes(l)) || null;

// Motivo por acusado quando o aceite diz quem fez o quê. Cada parênteses e cada
// separador (/ | ;) fecha uma parte; a parte que cita acusados vira o motivo só deles:
//   "RUSH+Saav (1267697) + RUSH (1200445+1263958)" → 1267697: "RUSH+Saav"; os outros: "RUSH"
//   "Dm 517416 / 520817 Kos"                      → 517416: "Dm"; 520817: "Kos"
//   "1921(saav rush)", "(1921 saav rush" ou "1921 saav rush" → 1921: "saav rush"
//   "1039 saav + rush + 1921 +saav"               → 1039: "saav + rush"; 1921: "saav"
// Acusado que não aparece em nenhuma parte fica de fora (leva o motivo inteiro).
function motivosPorAcusado(texto, acusados) {
  const mapa = new Map();
  const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const juntar = (chave, motivo) => mapa.set(chave, mapa.has(chave) ? `${mapa.get(chave)} + ${motivo}` : motivo);
  // Sobra o motivo, sem "+", vírgulas ou "e" soltos entre os IDs.
  const limpar = (t) => t.replace(/(^|\s)e(?=\s|$)/gi, ' ').replace(/\s+/g, ' ')
    .replace(/[+,](\s*[+,])+/g, '+').replace(/^[\s+,]+|[\s+,]+$/g, '').trim();
  // "X (ids)" e "ids(X)": o que vem colado antes do parênteses é da mesma parte.
  const partes = String(texto || '').replace(/\)/g, '/').replace(/\(/g, ' ').split(/[/|;]/);
  let pendente = '';
  for (const bruta of partes) {
    const parte = `${pendente} ${bruta}`;
    pendente = '';
    // Onde cada acusado aparece na parte, em ordem.
    const achados = acusados.map(a => {
      const m = new RegExp(`(^|[^\\w])${escapar(a)}(?!\\w)`, 'i').exec(parte);
      return m && { chave: a.toLowerCase(), ini: m.index + m[1].length, fim: m.index + m[0].length };
    }).filter(Boolean).sort((x, y) => x.ini - y.ini);
    if (!achados.length) {
      // Só motivo, sem acusado ("RUSH" em "RUSH (1200445)"): vale para a próxima parte.
      pendente = limpar(parte);
      continue;
    }
    // Textos entre os acusados; IDs sem motivo entre eles ("10 + 20", "20 e 30") formam um grupo.
    const textos = achados.map((x, i) => limpar(parte.slice(i ? achados[i - 1].fim : 0, x.ini)));
    const depois = limpar(parte.slice(achados[achados.length - 1].fim));
    const grupos = [];
    achados.forEach((x, i) => (i && !textos[i] ? grupos[grupos.length - 1].chaves.push(x.chave) : grupos.push({ chaves: [x.chave], antes: textos[i] })));
    grupos.forEach((g, i) => { g.depois = i + 1 < grupos.length ? grupos[i + 1].antes : depois; });
    if (grupos.length === 1) {
      const motivo = limpar(`${grupos[0].antes} ${depois}`);
      if (motivo) grupos[0].chaves.forEach(c => juntar(c, motivo));
      continue;
    }
    // Vários grupos: motivo antes do ID ("saav 10 rush 20") ou depois ("10 saav 20 rush").
    const motivoAntes = Boolean(grupos[0].antes);
    grupos.forEach((g, i) => {
      const motivo = motivoAntes ? limpar(`${g.antes} ${i === grupos.length - 1 ? depois : ''}`) : g.depois;
      if (motivo) g.chaves.forEach(c => juntar(c, motivo));
    });
  }
  // Texto corrido (sem parênteses nem /) só separa se citar todos os acusados:
  // "VDM, Rush + Saav de ambos e Slide do 1267835" vale inteiro para os dois.
  const corrido = !/[()/|;]/.test(String(texto || ''));
  if (corrido && !acusados.every(a => mapa.has(a.toLowerCase()))) return new Map();
  return mapa;
}

// Modo automático: comando e tempo saem do motivo do aceite (tabela em constantes.js).
function montarAlvos(denuncia, tabela) {
  // Cada acusado pode vir pelo ID da conta (472860) ou pelo nick (Fulano_Tal).
  const acusados = separarContas(denuncia.acusadoId);
  const porAcusado = motivosPorAcusado(denuncia.motivoAceite, acusados);
  return acusados
    .filter(a => RE_CONTA.test(a) || RE_NICK.test(a))
    .map(a => {
      const proprio = porAcusado.get(a.toLowerCase());
      // Motivo separado por conta, mas esta conta não foi citada: não leva o texto inteiro
      // (somaria a punição de todos). Fica sem motivo e sem regra: o automático não aplica,
      // a Cadeia Staff é avisada e o responsável escolhe a punição no Editar.
      if (!proprio && porAcusado.size > 0) {
        return { contaId: RE_CONTA.test(a) ? a : '', nick: RE_CONTA.test(a) ? '' : a, cmd: CMD_PADRAO, tempo: TEMPO_PADRAO, avisos: 1, regra: '', motivo: '' };
      }
      // Sem nada separado por conta: vale o motivo inteiro do aceite.
      const motivo = proprio || denuncia.motivoAceite;
      const { cmd, tempo, avisos, regra } = classificarMotivo(motivo, tabela);
      return {
        contaId: RE_CONTA.test(a) ? a : '',
        nick: RE_CONTA.test(a) ? '' : a,
        cmd, tempo, avisos, regra, motivo: limparMotivo(motivo)
      };
    });
}

const corta = (texto, max) => String(texto || '').slice(0, max);

// Cria a punição na fila (uma por denúncia). Devolve:
//  { criado: true, punicao } | { jaExistia: true, aceitoPor } | null (ponte desligada ou erro).
async function registrarAceite({ client, denuncia, origem, staff, canalMensagem = null }) {
  try {
    const servidor = await servidorAtivo(denuncia?.guildId);
    if (!servidor) return null;

    const todos = montarAlvos(denuncia, (await obterTabela()).tabela);
    // Só registro (ex.: mute já dado no jogo): o aceite segue, mas nada vai para o jogo.
    const alvos = todos.filter(a => a.cmd !== 'registro');
    if (!alvos.length && todos.length) return { soRegistro: true };
    const novo = {
      denunciaId: denuncia._id,
      guildId: denuncia.guildId,
      status: 'aceita',
      origem,
      aceitoPor: { id: String(staff.id), nome: corta(staff.nome, 64) },
      aceitoEm: new Date(),
      msgDiscord: {
        texto: corta(denuncia.motivo, 1500),
        // Link da mensagem da denúncia no canal: o do tópico privado aparece como
        // "#desconhecido" para quem não está nele.
        link: denuncia.channelId && denuncia.messageId
          ? `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`
          : `https://discord.com/channels/${denuncia.guildId}/${denuncia.threadId}`,
        acusado: corta(denuncia.acusado, 200),
        motivo: corta(denuncia.motivoAceite, 300),
        provas: corta(denuncia.provas, 1000)
      },
      mensagens: {
        topicoId: denuncia.threadId || '',
        canalId: canalMensagem?.channelId || '',
        canalMsgId: canalMensagem?.id || '',
        // Tópico público nasce da mensagem (mesmo id); o privado tem id próprio.
        topicoPrivado: Boolean(denuncia.threadId && denuncia.messageId && denuncia.threadId !== denuncia.messageId)
      },
      alvos,
      versao: 0,
      criadoEm: new Date()
    };

    let resultado;
    try {
      resultado = await PontePunicao.findOneAndUpdate(
        { denunciaId: denuncia._id },
        // Quem apertou "aceitar" na Cadeia Staff fica gravado mesmo se o tópico criou antes:
        // o Relatório de punições marca essa pessoa quando o punido é cargo alto de organização.
        origem === 'canal_staff'
          ? { $setOnInsert: novo, $set: { cadeiaStaffPor: novo.aceitoPor } }
          : { $setOnInsert: novo },
        { upsert: true, new: true, includeResultMetadata: true, runValidators: true }
      );
    } catch (error) {
      // Dois cliques ao mesmo tempo: o upsert do outro ganhou a corrida.
      if (error?.code !== 11000) throw error;
      const existente = await PontePunicao.findOne({ denunciaId: denuncia._id }).lean();
      return { jaExistia: true, aceitoPor: existente?.aceitoPor?.nome || '' };
    }

    const punicao = resultado.value;
    // Aceite de novo com outro ID ou motivo (ou a punição tinha ficado sem jogador) e
    // ainda não enviada: os jogadores saem do aceite novo. Mesmo aceite não mexe, para
    // não desfazer o que alguém editou à mão.
    const contasDe = (lista) => (lista || []).filter(a => !a.removido).map(a => `${a.contaId}|${a.nick}`).sort().join(',');
    const outroAceite = String(punicao?.msgDiscord?.motivo || '') !== novo.msgDiscord.motivo
      || contasDe(punicao?.alvos) !== contasDe(alvos);
    if (resultado.lastErrorObject?.updatedExisting && ['aceita', 'cancelada'].includes(punicao?.status) && alvos.length && outroAceite) {
      const refeita = await PontePunicao.findOneAndUpdate(
        { _id: punicao._id, status: punicao.status, versao: punicao.versao },
        {
          $set: { status: 'aceita', executor: '', alvos, aceitoPor: novo.aceitoPor, aceitoEm: new Date(), 'msgDiscord.motivo': novo.msgDiscord.motivo, 'msgDiscord.acusado': novo.msgDiscord.acusado },
          $inc: { versao: 1 }
        },
        { new: true, runValidators: true }
      ).lean();
      if (refeita) {
        log.info(`Punição ${refeita._id} refeita pelo aceite novo (denúncia ${denuncia._id}).`);
        if (alvos.some(a => !a.regra)) await atualizarMensagensDiscord(client, refeita, AGUARDANDO).catch(() => {});
        await require('./discordGm').atualizarMensagemGm(client, refeita._id).catch(() => {});
        return { atualizada: true, punicao: refeita };
      }
    }
    if (resultado.lastErrorObject?.updatedExisting) {
      // Cancelada antes e aceita de novo na Cadeia Staff: é uma decisão nova, então a
      // punição volta a esperar envio (e, no modo gamemode, o aceite já envia).
      if (origem === 'canal_staff' && punicao?.status === 'cancelada') {
        const reaberta = await PontePunicao.findOneAndUpdate(
          { _id: punicao._id, status: 'cancelada' },
          { $set: { status: 'aceita', executor: '', aceitoPor: novo.aceitoPor, aceitoEm: new Date() }, $inc: { versao: 1 } },
          { new: true }
        ).lean();
        if (reaberta) {
          log.info(`Punição ${reaberta._id} reaberta pelo aceite na Cadeia Staff (denúncia ${denuncia._id}).`);
          await require('./discordGm').atualizarMensagemGm(client, reaberta._id).catch(() => {});
          return { reaberta: true, punicao: reaberta };
        }
      }
      return { jaExistia: true, aceitoPor: punicao?.aceitoPor?.nome || '', status: punicao?.status || '' };
    }

    // Motivo fora da tabela: não dá para enviar até o responsável corrigir no Editar.
    if (alvos.some(a => !a.regra)) {
      await atualizarMensagensDiscord(client, punicao, AGUARDANDO).catch(() => {});
    }
    // Modo gamemode: embed com "Enviar ao jogo" no Relatório de punições. Carregado aqui
    // para não criar dependência circular (discordGm → pedidosGm → aceite).
    await require('./discordGm').postarPunicaoGm(client, punicao, servidor)
      .catch(error => log.error('Falha ao postar a punição para a gamemode (o aceite seguiu)', error));
    return { criado: true, punicao };
  } catch (error) {
    log.error('Falha na ponte ao registrar aceite (o aceite normal seguiu)', error);
    return null;
  }
}

// Edita uma mensagem da ponte; montar(atual) devolve o novo texto (ou null para não mexer).
async function editarMensagem(client, canalId, msgId, montar) {
  if (!client || !canalId || !msgId) return;
  const canal = await client.channels.fetch(canalId).catch(() => null);
  const msg = canal?.messages ? await canal.messages.fetch(msgId).catch(() => null) : null;
  if (!msg) return;
  const novo = montar(msg.content || '');
  if (novo === null || novo === msg.content) return;
  await msg.edit({ content: corta(novo, 2000) }).catch(e => log.warn('Falha ao editar mensagem da ponte', e?.message));
}

// Registra a aplicação na mensagem da Cadeia Staff (e no aviso do tópico, se houver).
async function atualizarMensagensDiscord(client, punicao, texto) {
  const { topicoId, topicoMsgId, canalId, canalMsgId } = punicao.mensagens || {};
  await Promise.all([
    editarMensagem(client, topicoId, topicoMsgId, () => texto),
    editarMensagem(client, canalId, canalMsgId, (atual) => (linhaAguardando(atual) ? atual.replace(linhaAguardando(atual), texto) : `${atual}\n${texto}`))
  ]);
}

// Aplicada: o tópico ganha a linha "Aplicado"; na Cadeia Staff só some o "aguardando
// correção" (o Relatório de punições já registra a aplicação).
async function marcarAplicadaNoDiscord(client, punicao, texto) {
  const { topicoId, topicoMsgId } = punicao.mensagens || {};
  await Promise.all([
    editarMensagem(client, topicoId, topicoMsgId, () => texto),
    limparAguardando(client, punicao)
  ]);
}

// Tirada da fila sem aplicar: só some a linha "aguardando correção" da Cadeia Staff,
// sem escrever nada no lugar.
async function limparAguardando(client, punicao) {
  const { canalId, canalMsgId } = punicao.mensagens || {};
  await editarMensagem(client, canalId, canalMsgId, (atual) => {
    const linha = linhaAguardando(atual);
    if (!linha) return null;
    return atual.split('\n').filter(l => l.trim() !== linha).join('\n').trim() || '​';
  });
}

// Mensagem da Cadeia Staff da denúncia: a gravada no aceite pela Cadeia Staff ou, se a
// punição nasceu no tópico, a do log da denúncia (ou do registro das provas da staff).
async function mensagemDaCadeia(punicao) {
  const Denuncia = require('../../models/Denuncia');
  const DenunciaStaff = require('../../models/DenunciaStaff');
  const [denuncia, provas] = await Promise.all([
    Denuncia.findById(punicao.denunciaId, { messageId: 1, logMessageId: 1 }).lean().catch(() => null),
    DenunciaStaff.findById(punicao.denunciaId, { messageId: 1, cadeia: 1 }).lean().catch(() => null)
  ]);
  const messageId = denuncia?.messageId || provas?.messageId || '';
  if (!messageId) return null;
  const { canalId, canalMsgId } = punicao.mensagens || {};
  if (canalId && canalMsgId) return { canalId, msgId: canalMsgId, messageId, provasId: provas?._id || null };
  if (provas?.cadeia?.msgId) return { canalId: provas.cadeia.canalId, msgId: provas.cadeia.msgId, messageId, provasId: provas._id };
  if (denuncia?.logMessageId) {
    const config = await require('../../utils/configCache').getConfig(punicao.guildId).catch(() => null);
    if (config?.channels?.logs) return { canalId: config.channels.logs, msgId: denuncia.logMessageId, messageId, provasId: null };
  }
  return null;
}

// Envio cancelado: a mensagem da Cadeia Staff volta a ser como antes do aceite (sem o
// "||data|| por @fulano", sem as linhas da ponte e com Aceitar e Recusar), para alguém
// aceitar de novo como da primeira vez. Devolve true se a mensagem foi refeita.
async function voltarParaCadeiaStaff(client, punicao) {
  if (!client || !punicao) return false;
  const alvo = await mensagemDaCadeia(punicao);
  if (!alvo?.canalId) return false;
  const canal = await client.channels.fetch(alvo.canalId).catch(() => null);
  const msg = canal?.messages ? await canal.messages.fetch(alvo.msgId).catch(() => null) : null;
  if (!msg) return false;

  const linhasDaPonte = [AGUARDANDO, AGUARDANDO_ANTIGO, LIBERADO];
  let texto = String(msg.content || '').split('\n')
    .filter(l => !linhasDaPonte.includes(l.trim()) && !l.trim().startsWith('➱ Aplicado'))
    .join('\n');
  // Tira só a última confirmação ("||08/11/2026 16:25|| por @fulano"): é a do aceite.
  const confirmacoes = [...texto.matchAll(/ \|\|[^|\n]+\|\| por <@!?\d+>/g)];
  const ultima = confirmacoes[confirmacoes.length - 1];
  if (ultima) texto = texto.slice(0, ultima.index) + texto.slice(ultima.index + ultima[0].length);

  // O "Entrar no tópico" (tópico privado) continua ao lado de Aceitar e Recusar.
  const entrar = (msg.components || []).flatMap(l => l.components || []).find(b => String(b.customId || '').startsWith('entrar_topico:'));
  const threadPrivado = entrar ? String(entrar.customId).split(':')[1]
    : punicao.mensagens?.topicoPrivado ? punicao.mensagens.topicoId : null;
  const { createLogActionRow } = require('../../Handlers/statusDenuncia/mensagensStatus');
  const editada = await msg.edit({ content: corta(texto.trim() || '​', 2000), components: [createLogActionRow(alvo.messageId, false, threadPrivado || null)] })
    .then(() => true).catch(e => { log.warn('Falha ao devolver a mensagem para a Cadeia Staff', e?.message); return false; });
  if (editada && alvo.provasId) {
    await require('../../models/DenunciaStaff').updateOne({ _id: alvo.provasId }, { $set: { 'cadeia.status': '' } }).catch(() => {});
  }
  return editada;
}

// Motivo que estava fora da tabela e passou a existir (cadastrado no site ou no Discord),
// ou motivo da tabela que mudou de punição: o jogador ganha tipo, tempo e avisos da tabela
// atual. Não mexe em quem foi editado à mão (regra "editado por ...") nem em quem está sem motivo. Quando a denúncia inteira fica com regra, a
// mensagem do Discord troca "aguardando correção" por "liberado". Sem lista, confere a
// fila toda (a tabela vale para todos os servidores). Devolve a lista atualizada.
async function reclassificarFila({ client = null, lista = null, tabela = null } = {}) {
  const fila = lista || await PontePunicao.find({ status: 'aceita' }).lean();
  const regras = tabela || (await obterTabela()).tabela;
  for (const [i, p] of fila.entries()) {
    let mudou = false;
    const alvos = (p.alvos || []).map(a => {
      if (a.removido || !a.motivo || /^editado por/i.test(a.regra || '')) return a;
      const c = classificarMotivo(a.motivo, regras);
      if (!c.regra || c.cmd === 'registro') return a;
      if (a.regra === c.regra && a.cmd === c.cmd && Number(a.tempo) === c.tempo && Number(a.avisos || 0) === c.avisos) return a;
      mudou = true;
      return { ...a, cmd: c.cmd, tempo: c.tempo, avisos: c.avisos, regra: c.regra };
    });
    if (!mudou) continue;
    const atualizada = await PontePunicao.findOneAndUpdate(
      { _id: p._id, status: 'aceita', versao: p.versao },
      { $set: { alvos }, $inc: { versao: 1 } },
      { new: true }
    ).lean().catch(() => null);
    if (!atualizada) continue;
    fila[i] = atualizada;
    if (atualizada.alvos.every(a => a.removido || a.regra)) {
      await atualizarMensagensDiscord(client, atualizada, LIBERADO).catch(() => {});
    }
    // Modo gamemode: o embed "Punição esperando envio" mostra a punição nova.
    await require('./discordGm').atualizarMensagemGm(client, atualizada._id).catch(() => {});
  }
  return fila;
}

// Punições esperando envio que ficaram sem jogador porque o ID do aceite veio com espaço,
// vírgula ou parênteses ("(8285 708579 1154255)"): refaz os jogadores com o ID e o motivo
// do aceite, agora lidos com qualquer separador. Roda ao iniciar; sem nenhuma, não muda nada.
// Uma punição sem jogador: lê o ID e o motivo do aceite (denúncia ou provas da staff) e
// remonta os jogadores. Devolve a punição refeita ou null (sem ID que dê para ler).
async function refazerJogadores(client, p, tabela = null) {
  const Denuncia = require('../../models/Denuncia');
  const DenunciaStaff = require('../../models/DenunciaStaff');
  const denuncia = await Denuncia.findById(p.denunciaId, { acusadoId: 1, motivoAceite: 1 }).lean()
    || await DenunciaStaff.findById(p.denunciaId, { acusadoAceite: 1, motivoAceite: 1 }).lean().then(d => d && { acusadoId: d.acusadoAceite, motivoAceite: d.motivoAceite });
  if (!denuncia?.acusadoId) {
    log.warn(`Punição ${p._id} sem jogador: a denúncia não tem ID do aceite para refazer.`);
    return null;
  }
  const alvos = montarAlvos(denuncia, tabela || (await obterTabela()).tabela).filter(a => a.cmd !== 'registro');
  if (!alvos.length) {
    log.warn(`Punição ${p._id} sem jogador: o ID do aceite ("${String(denuncia.acusadoId).slice(0, 80)}") não tem conta nem nick que dê para ler.`);
    return null;
  }
  const refeita = await PontePunicao.findOneAndUpdate(
    { _id: p._id, status: 'aceita', versao: p.versao },
    { $set: { alvos }, $inc: { versao: 1 } },
    { new: true, runValidators: true }
  ).lean();
  if (!refeita) return null;
  const normal = separarContas(denuncia.acusadoId).join('+');
  if (normal && normal !== denuncia.acusadoId) await Denuncia.updateOne({ _id: p.denunciaId }, { $set: { acusadoId: normal } }).catch(() => {});
  await require('./discordGm').atualizarMensagemGm(client, refeita._id).catch(() => {});
  log.info(`Punição ${refeita._id} sem jogador refeita com o ID do aceite (${alvos.length} jogador(es)).`);
  return refeita;
}

async function refazerSemJogador(client) {
  const lista = await PontePunicao.find({ status: 'aceita' }).limit(300).lean();
  const semJogador = lista.filter(p => !(p.alvos || []).some(a => !a.removido));
  if (!semJogador.length) return 0;
  const { tabela } = await obterTabela();
  let refeitas = 0;
  for (const p of semJogador) if (await refazerJogadores(client, p, tabela)) refeitas++;
  return refeitas;
}

module.exports = { registrarAceite, atualizarMensagensDiscord, marcarAplicadaNoDiscord, limparAguardando, montarAlvos, motivosPorAcusado, reclassificarFila, voltarParaCadeiaStaff, refazerSemJogador, refazerJogadores };
