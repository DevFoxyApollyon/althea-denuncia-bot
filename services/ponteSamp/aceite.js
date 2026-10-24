// Liga o aceite da denúncia no Discord à fila do painel do jogo. Nada aqui
// pode quebrar o aceite normal: todo erro é engolido e só vai para o log.
const PontePunicao = require('../../models/PontePunicao');
const { servidorAtivo } = require('./gestao');
const { RE_CONTA, RE_NICK, limparMotivo, classificarMotivo } = require('./validacao');
const { obterTabela } = require('./motivos');
const { CMD_PADRAO, TEMPO_PADRAO } = require('./constantes');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteAceite' });
const AGUARDANDO = '➱ Motivo fora da tabela: aguardando no painel';
const LIBERADO = '➱ Motivo cadastrado na tabela: liberado no painel do jogo';

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
  const acusados = [...new Set(String(denuncia.acusadoId || '').split('+').map(id => id.trim()).filter(Boolean))];
  const porAcusado = motivosPorAcusado(denuncia.motivoAceite, acusados);
  return acusados
    .filter(a => RE_CONTA.test(a) || RE_NICK.test(a))
    .map(a => {
      const proprio = porAcusado.get(a.toLowerCase());
      // Motivo separado por conta, mas esta conta não foi citada: não leva o texto inteiro
      // (somaria a punição de todos). Fica sem motivo e sem regra: o automático não aplica,
      // a Cadeia Staff é avisada e a staff escolhe a punição no painel.
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

    const alvos = montarAlvos(denuncia, (await obterTabela()).tabela);
    const novo = {
      denunciaId: denuncia._id,
      guildId: denuncia.guildId,
      status: 'aceita',
      origem,
      aceitoPor: { id: String(staff.id), nome: corta(staff.nome, 64) },
      aceitoEm: new Date(),
      msgDiscord: {
        texto: corta(denuncia.motivo, 1500),
        link: `https://discord.com/channels/${denuncia.guildId}/${denuncia.threadId}`,
        acusado: corta(denuncia.acusado, 200),
        motivo: corta(denuncia.motivoAceite, 300),
        provas: corta(denuncia.provas, 1000)
      },
      mensagens: {
        topicoId: denuncia.threadId || '',
        canalId: canalMensagem?.channelId || '',
        canalMsgId: canalMensagem?.id || ''
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
    if (resultado.lastErrorObject?.updatedExisting) {
      return { jaExistia: true, aceitoPor: punicao?.aceitoPor?.nome || '' };
    }

    log.info(`Denúncia ${denuncia._id} na fila do jogo (${alvos.length} alvo(s), guild ${denuncia.guildId}).`);
    // Motivo fora da tabela: o automático não aplica; a staff confere no painel.
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
    editarMensagem(client, canalId, canalMsgId, (atual) => (atual.includes(AGUARDANDO) ? atual.replace(AGUARDANDO, texto) : `${atual}\n${texto}`))
  ]);
}

// Tirada da fila sem aplicar: só some a linha "aguardando no painel" da Cadeia Staff,
// sem escrever nada no lugar.
async function limparAguardando(client, punicao) {
  const { canalId, canalMsgId } = punicao.mensagens || {};
  await editarMensagem(client, canalId, canalMsgId, (atual) => {
    if (!atual.includes(AGUARDANDO)) return null;
    return atual.split('\n').filter(l => l.trim() !== AGUARDANDO).join('\n').trim() || '​';
  });
}

// Motivo que estava fora da tabela e passou a existir (cadastrado no site ou no Discord):
// o jogador ganha tipo, tempo e avisos da tabela atual. Só mexe em quem ainda está sem
// regra (ninguém editou à mão) e tem motivo. Quando a denúncia inteira fica com regra, a
// mensagem do Discord troca "aguardando no painel" por "liberado". Sem lista, confere a
// fila toda (a tabela vale para todos os servidores). Devolve a lista atualizada.
async function reclassificarFila({ client = null, lista = null, tabela = null } = {}) {
  const fila = lista || await PontePunicao.find({ status: 'aceita', 'alvos.regra': '' }).lean();
  const regras = tabela || (await obterTabela()).tabela;
  for (const [i, p] of fila.entries()) {
    let mudou = false;
    const alvos = (p.alvos || []).map(a => {
      if (a.removido || a.regra || !a.motivo) return a;
      const c = classificarMotivo(a.motivo, regras);
      if (!c.regra) return a;
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
  }
  return fila;
}

module.exports = { registrarAceite, atualizarMensagensDiscord, limparAguardando, montarAlvos, reclassificarFila };
