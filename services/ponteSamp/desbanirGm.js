// /desbanir: o responsável cola o link de uma denúncia que o bot já aplicou e a
// gamemode desfaz o que foi aplicado em cada jogador: ban vira pedido "desbanir"
// (/desbanir <conta>), cadeia vira "soltar" (a mesma cadeia com tempo 0). Os avisos
// que o bot deu vão no mesmo pedido, para a gamemode tirar (/limpaaviso, um por aviso).
// O resultado aparece no Relatório de punições.
const { EmbedBuilder } = require('discord.js');
const Denuncia = require('../../models/Denuncia');
const PontePunicao = require('../../models/PontePunicao');
const PontePedidoGm = require('../../models/PontePedidoGm');
const PonteServidor = require('../../models/PonteServidor');
const PonteConexaoGm = require('../../models/PonteConexaoGm');
const PonteUso = require('../../models/PonteUso');
const { motivoComSufixo } = require('./validacao');
const { motivoParaGamemode, nomeParaGamemode } = require('./protocoloGm');
const { LIMITES_GM_PADRAO } = require('./constantes');
const { explicarCodigo } = require('./pedidosGm');
const { canalDoRelatorio, EXECUTORES_GM, alvosAtivos } = require('./discordGm');
const { punicaoLegivel, discordDaConta, quemAplicou, temOrganizacao, nomeDaOrganizacao } = require('./avisoOrganizacao');

const MOTIVO_DESBAN = motivoParaGamemode(motivoComSufixo('DESBANIMENTO'));
const EM_ANDAMENTO = ['aprovado', 'entregue', 'incerto'];
const TIPOS_DESFAZER = ['desbanir', 'soltar'];
// Pedido que desfaz cada tipo de punição.
const tipoParaDesfazer = (cmd) => (cmd === 'cadeia' ? 'soltar' : 'desbanir');

// Denúncia pelo link do tópico, de uma mensagem dele ou da mensagem principal.
// Também acha as provas da staff (/provastaff) pelo link do registro ou do tópico.
async function denunciaPeloLink(guildId, link) {
  const filtros = [{ threadId: link.canalId }];
  if (link.mensagemId) filtros.push({ messageId: link.mensagemId });
  const denuncia = await Denuncia.findOne({ guildId: String(guildId), $or: filtros }).select('_id acusado denunciante motivo channelId messageId threadId').lean();
  if (denuncia) return denuncia;
  const staff = await require('../../models/DenunciaStaff').findOne({ guildId: String(guildId), $or: filtros }).lean();
  return staff ? { _id: staff._id, acusado: staff.acusadoAceite || staff.contas.join('+'), motivo: staff.motivoAceite || staff.motivo, channelId: staff.channelId, messageId: staff.messageId, threadId: staff.threadId } : null;
}

// Situação de cada jogador punido (ban ou cadeia): pode desfazer, já desfeito ou em andamento.
async function situacaoDoDesbanimento(punicao) {
  const aplicados = new Map((punicao.resultado || []).filter(r => r.ok && !r.erro).map(r => [String(r.alvoId), r]));
  const pedidos = await PontePedidoGm.find({ punicaoId: punicao._id, tipo: { $in: TIPOS_DESFAZER } }).sort({ rodada: -1 }).lean();
  return alvosAtivos(punicao).filter(a => ['ban', 'cadeia'].includes(a.cmd) && aplicados.has(String(a._id))).map(alvo => {
    const r = aplicados.get(String(alvo._id));
    const ultimo = pedidos.find(p => String(p.alvoId) === String(alvo._id));
    const conta = Number(alvo.contaId || r.contaId) || 0;
    const estado = ultimo?.status === 'aplicada' ? 'desbanido' : EM_ANDAMENTO.includes(ultimo?.status) ? 'andamento' : 'pode';
    return { alvo, conta, nick: r.nome || alvo.nick || '', estado, tipo: tipoParaDesfazer(alvo.cmd) };
  });
}

// O que o /desbanir mostra antes do botão. Devolve { erro } ou { denuncia, punicao, alvos }.
async function prepararDesbanimento(guildId, link) {
  const denuncia = await denunciaPeloLink(guildId, link);
  if (!denuncia) return { erro: 'Não achei nenhuma denúncia com esse link.' };
  const punicao = await PontePunicao.findOne({ denunciaId: denuncia._id, guildId: String(guildId) }).lean();
  if (!punicao) return { erro: 'Esta denúncia não passou pela ponte com o jogo: o bot não aplicou nada nela.' };
  if (punicao.status !== 'aplicada') return { erro: `O bot ainda não aplicou a punição desta denúncia (situação: ${punicao.status}).` };
  const alvos = await situacaoDoDesbanimento(punicao);
  if (!alvos.length) return { erro: 'Nenhum jogador foi banido ou preso pelo bot nesta denúncia.' };
  return { denuncia, punicao, alvos };
}

// Botão "Desbanir": um pedido por jogador que ainda pode ser desbanido.
async function desbanir({ client = null, punicaoId, guildId, staff, agora = Date.now() }) {
  const servidor = await PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor.' };
  if (!EXECUTORES_GM.includes(servidor.executor)) return { erro: 'Este servidor aplica pelo PC da staff: o desbanimento pelo bot só funciona com a gamemode.' };
  const punicao = await PontePunicao.findOne({ _id: punicaoId, guildId: String(guildId), status: 'aplicada' }).lean();
  if (!punicao) return { erro: 'Punição não encontrada ou ainda não aplicada.' };

  const alvos = (await situacaoDoDesbanimento(punicao)).filter(a => a.estado === 'pode' && a.conta > 0);
  if (!alvos.length) return { erro: 'Todos os jogadores desta denúncia já foram desbanidos ou soltos, ou estão sendo.' };

  // Tirar avisos no mesmo pedido precisa da include 1.0.1 (a 1.0.0 recusa).
  const conexoes = await PonteConexaoGm.find({ guildId: String(guildId), status: 'ativa' }, { versaoInclude: 1 }).lean();
  const tiraAvisos = conexoes.length > 0 && conexoes.every(c => c.versaoInclude && c.versaoInclude !== '1.0.0');
  const maxAvisos = servidor.gm?.maxAvisos ?? LIMITES_GM_PADRAO.maxAvisos;

  const anteriores = await PontePedidoGm.find({ punicaoId: punicao._id }, { alvoId: 1, rodada: 1 }).lean();
  const rodadaDe = (alvoId) => 1 + Math.max(0, ...anteriores.filter(p => String(p.alvoId) === String(alvoId)).map(p => p.rodada));
  const teste = (servidor.gm?.modoTeste ?? LIMITES_GM_PADRAO.modoTeste) === true;
  const criados = await PontePedidoGm.insertMany(alvos.map(({ alvo, conta, nick }, i) => ({
    punicaoId: punicao._id,
    alvoId: alvo._id,
    rodada: rodadaDe(alvo._id),
    denunciaId: punicao.denunciaId,
    guildId: punicao.guildId,
    tipo: tipoParaDesfazer(alvo.cmd),
    conta,
    nick: /^[A-Za-z0-9_[\].$@=()]{3,24}$/.test(nick) ? nick : '',
    tempo: 0,
    avisos: tiraAvisos ? Math.min(Number(alvo.avisos) || 0, maxAvisos) : 0,
    somar: false,
    motivo: MOTIVO_DESBAN,
    aprovadoPor: nomeParaGamemode(staff.nome),
    teste,
    confirmadoPor: [{ id: String(staff.id), nome: String(staff.nome || '').slice(0, 64), em: new Date(agora) }],
    status: 'aprovado',
    criadoEm: new Date(agora + i)
  })));
  await PonteUso.create({
    guildId: punicao.guildId, acao: 'gm_enviar', punicaoId: punicao._id,
    detalhes: { sub: 'desbanir', por: String(staff.id), nome: staff.nome, contas: alvos.map(a => a.conta), teste }
  }).catch(() => {});
  const avisosFicam = !tiraAvisos && alvos.some(a => Number(a.alvo.avisos) > 0);
  return { ok: true, pedidos: criados.length, contas: alvos.map(a => a.conta), teste, avisosFicam };
}

// Resultado do desbanimento no Relatório de punições: o mesmo formato do embed de
// punição aplicada (servidor no topo, player/discord/o que foi feito, campos e rodapé).
async function avisarDesbanimento(client, pedido, dados, nomeConexao = '') {
  if (!client || !TIPOS_DESFAZER.includes(pedido.tipo)) return;
  const solto = pedido.tipo === 'soltar';
  const canal = await canalDoRelatorio(client, pedido.guildId);
  if (!canal) return;
  const ok = pedido.status === 'aplicada';
  const simulado = pedido.status === 'simulada';
  const punicao = await PontePunicao.findById(pedido.punicaoId, { msgDiscord: 1, alvos: 1, aplicadaEm: 1, resultado: 1, guildId: 1 }).lean();
  const alvo = (punicao?.alvos || []).find(a => String(a._id) === String(pedido.alvoId)) || {};
  const aplicado = (punicao?.resultado || []).find(r => String(r.alvoId) === String(pedido.alvoId) && r.ok) || {};
  const conta = dados.conta || pedido.conta || alvo.contaId || '?';
  const nick = dados.nome || aplicado.nome || pedido.nick || alvo.nick || 'Jogador';
  const organizacao = dados.organizacao || aplicado.organizacao || '';
  const codigo = pedido.codigo || dados.codigo;
  const discord = await discordDaConta(pedido.guildId, conta, '');
  const servidor = client.guilds?.cache?.get?.(pedido.guildId);
  const pedidoPor = pedido.confirmadoPor?.[0]?.id ? `<@${pedido.confirmadoPor[0].id}>` : pedido.aprovadoPor || '—';
  const banOriginal = punicaoLegivel(alvo) || 'Ban';
  const embed = new EmbedBuilder()
    .setColor(ok ? '#2F9E44' : simulado ? '#1C7ED6' : '#E67700')
    .setAuthor({ name: `Relatório de punições${servidor?.name ? ` · ${servidor.name}` : ''}`.slice(0, 256), iconURL: servidor?.iconURL?.() || undefined })
    .setTitle(solto
      ? (ok ? '🔓  Jogador solto' : simulado ? '🧪  Soltura simulada' : '⚠️  Soltura não aplicada')
      : (ok ? '🔓  Desbanimento aplicado' : simulado ? '🧪  Desbanimento simulado' : '⚠️  Desbanimento não aplicado'))
    .setDescription([
      `👤 **Player:** ${String(nick).slice(0, 60)} (\`${conta}\`)`,
      `💬 **Discord:** ${discord === 'Não informado' ? 'não vinculado' : discord}`,
      `⚖️ **${solto ? 'Cadeia retirada' : 'Ban retirado'}:** ${banOriginal}`,
      pedido.avisos > 0 ? `🧹 **Avisos retirados:** ${pedido.avisos}` : '',
      ok || simulado ? '' : `ℹ️ **${codigo}:** ${explicarCodigo(codigo)}`
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: solto ? '📝 Motivo da cadeia' : '📝 Motivo do ban', value: String(alvo.motivo || '—').slice(0, 200), inline: true },
      { name: '🏢 Organização', value: temOrganizacao(organizacao) ? nomeDaOrganizacao(organizacao) || 'Não informada' : 'Nenhuma', inline: true },
      { name: '🔗 Denúncia', value: punicao?.msgDiscord?.link ? `[Abrir denúncia](${punicao.msgDiscord.link})` : 'Sem link', inline: true },
      { name: solto ? '✅ Solto a pedido de' : '✅ Desbanido a pedido de', value: pedidoPor, inline: true },
      { name: solto ? '📅 Preso em' : '📅 Banido em', value: punicao?.aplicadaEm ? `<t:${Math.floor(new Date(punicao.aplicadaEm).getTime() / 1000)}:f>` : '—', inline: true }
    )
    .setFooter({ text: `🎮 Aplicado por ${quemAplicou(`gamemode:${nomeConexao}`)} · Punição #${String(pedido.punicaoId).slice(-8)}`.slice(0, 2048) })
    .setTimestamp();
  await canal.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

// ---------- /desbanir pelo ID da conta ----------
// Sem denúncia: o pedido não tem punição de verdade (ids próprios, só para o registro).
async function servidorComGamemode(guildId) {
  const servidor = await PonteServidor.findOne({ guildId: String(guildId), ativo: true }).lean();
  if (!servidor) return { erro: 'A ponte com o jogo não está ativa neste servidor.' };
  if (!EXECUTORES_GM.includes(servidor.executor)) return { erro: 'Este servidor aplica pelo PC da staff: o /desbanir pelo ID só funciona com a gamemode.' };
  return { servidor };
}

async function pedidoAvulso({ servidor, guildId, conta, tipo, avisos = 0, staff, agora = Date.now() }) {
  const mongoose = require('mongoose');
  return PontePedidoGm.create({
    punicaoId: new mongoose.Types.ObjectId(),
    alvoId: new mongoose.Types.ObjectId(),
    rodada: 1,
    guildId: String(guildId),
    tipo,
    conta: Number(conta),
    tempo: 0,
    avisos,
    somar: false,
    motivo: tipo === 'consultar' ? motivoParaGamemode(motivoComSufixo('CONSULTA')) : MOTIVO_DESBAN,
    aprovadoPor: nomeParaGamemode(staff.nome),
    // A consulta só lê: vai valendo mesmo com o modo teste ligado.
    teste: tipo === 'consultar' ? false : (servidor.gm?.modoTeste ?? LIMITES_GM_PADRAO.modoTeste) === true,
    confirmadoPor: [{ id: String(staff.id), nome: String(staff.nome || '').slice(0, 64), em: new Date(agora) }],
    status: 'aprovado',
    criadoEm: new Date(agora)
  });
}

// Pergunta à gamemode se a conta está banida, presa e quantos avisos tem. Espera a
// resposta (a gamemode busca a cada ~10 s). Devolve { ok, banido, preso, avisos, nome } ou { erro }.
async function consultarConta({ guildId, conta, staff, esperarMs = 45000, intervaloMs = 2000 }) {
  const { servidor, erro } = await servidorComGamemode(guildId);
  if (erro) return { erro };
  const pedido = await pedidoAvulso({ servidor, guildId, conta, tipo: 'consultar', staff });
  const limite = Date.now() + esperarMs;
  while (Date.now() < limite) {
    await new Promise(r => setTimeout(r, intervaloMs));
    const atual = await PontePedidoGm.findById(pedido._id).lean();
    if (['aplicada', 'simulada'].includes(atual?.status) && atual.resultado?.banido !== null && atual.resultado?.banido !== undefined) {
      return { ok: true, banido: atual.resultado.banido, preso: atual.resultado.preso, avisos: atual.resultado.avisos || 0, nome: atual.resultado.nome || '' };
    }
    if (['recusada', 'erro', 'incerto', 'cancelado'].includes(atual?.status)) {
      return { erro: atual.codigo === 'CONTA_INEXISTENTE' ? 'Essa conta não existe no jogo.' : atual.codigo === 'RECUSADO'
        ? 'A gamemode ainda não sabe responder a consulta (falta a Althea_Consultar na gamemode).' : `A gamemode não respondeu a consulta (${atual.codigo || atual.status}).` };
    }
  }
  await PontePedidoGm.updateOne({ _id: pedido._id, status: 'aprovado' }, { $set: { status: 'cancelado' } }).catch(() => {});
  return { erro: 'A gamemode não respondeu a consulta a tempo. Ela está online? Veja o Status ao vivo no Painel da ponte.' };
}

// Desbanir (tirando "avisos") ou soltar da cadeia, direto pela conta.
async function desfazerPorConta({ guildId, conta, acao, avisos = 0, staff }) {
  const { servidor, erro } = await servidorComGamemode(guildId);
  if (erro) return { erro };
  const maxAvisos = servidor.gm?.maxAvisos ?? LIMITES_GM_PADRAO.maxAvisos;
  const tipo = acao === 'soltar' ? 'soltar' : 'desbanir';
  const pedido = await pedidoAvulso({ servidor, guildId, conta, tipo, avisos: tipo === 'desbanir' ? Math.max(0, Math.min(maxAvisos, Number(avisos) || 0)) : 0, staff });
  await PonteUso.create({
    guildId: String(guildId), acao: 'gm_enviar',
    detalhes: { sub: tipo, via: 'desbanir_id', por: String(staff.id), nome: staff.nome, conta: Number(conta), avisos: pedido.avisos }
  }).catch(() => {});
  return { ok: true, pedido, teste: pedido.teste };
}

module.exports = { consultarConta, desfazerPorConta, TIPOS_DESFAZER, prepararDesbanimento, desbanir, avisarDesbanimento, situacaoDoDesbanimento };
