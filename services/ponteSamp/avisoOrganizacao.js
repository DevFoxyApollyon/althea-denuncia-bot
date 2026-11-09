// Toda punição aplicada pela gamemode vira um registro no canal Relatório de punições
// (ou no Log Admin, se ele não estiver configurado), com
// organização (com o cargo), nick, ID da conta, comando e link da denúncia. Cargo 6 a 12
// de organização marca o responsável admin e quem aceitou na Cadeia Staff.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig } = require('../../utils/configCache');
const { botaoSoltoEntrarNoTopico } = require('../../utils/restricaoTopicos');
const { Logger } = require('../../utils/logger');
const Usuario = require('../../models/Usuario');

const log = new Logger({ tag: 'PonteOrganizacao' });

// O que o /vercontaid mostra para quem não tem organização. CONFIGURÁVEL.
const SEM_ORGANIZACAO = ['', 'NENHUMA', 'NENHUM', 'CIVIL', 'SEM', 'SEM ORGANIZACAO', 'DESEMPREGADO', 'NAO POSSUI', '-', 'N/A'];

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda": o cargo entre parênteses não entra.
const semParenteses = (texto) => String(texto || '').replace(/\s*\([^)]*\)/g, '').trim();
const temOrganizacao = (organizacao) => !SEM_ORGANIZACAO.includes(normalizar(semParenteses(organizacao)));

// Embed de punição aplicada: "Entrar no tópico" (tópico privado) e "Ver no site"
// (página da denúncia; só com o endereço público do site, em https).
function botoesDaAplicada(punicao) {
  const site = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  const botoes = [];
  if (punicao.mensagens?.topicoPrivado && punicao.mensagens.topicoId) botoes.push(botaoSoltoEntrarNoTopico(punicao.mensagens.topicoId));
  if (site.startsWith('https://') && punicao.denunciaId) {
    botoes.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ver no site').setEmoji('🌐').setURL(`${site}/#/d/${punicao.denunciaId}`));
  }
  return botoes.length ? [new ActionRowBuilder().addComponents(botoes)] : [];
}

// Cargos que fazem o relatório marcar o responsável admin e quem aceitou na Cadeia Staff.
const CARGO_ALTO = { min: 6, max: 12 };

// Número do cargo: o último número entre parênteses ("( Membro - 4)" → 4, "(Cargo:[ lider - 12])" → 12)
// ou entre colchetes no fim, como a gamemode manda ("U$ BEN$A [10]" → 10).
const textoDoCargo = (organizacao) => {
  const texto = String(organizacao || '');
  return texto.match(/\(([^]*)\)/)?.[1] || texto.match(/\[([^\]]*)\]\s*$/)?.[1] || '';
};

function cargoDaOrganizacao(organizacao) {
  const numeros = textoDoCargo(organizacao).match(/\d+/g);
  return numeros ? Number(numeros[numeros.length - 1]) : null;
}

// Nome do cargo, quando o jogo manda: "( Membro - 4)" → "Membro", "(Cargo:[ lider - 12])" → "lider".
function nomeDoCargo(organizacao) {
  return textoDoCargo(organizacao)
    .replace(/cargo\s*:?/i, '').replace(/[[\]]/g, '').replace(/\d+/g, '')
    .replace(/[-:–|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// Só o nome da organização: "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda"; "U$ BEN$A [10]" → "U$ BEN$A".
const nomeDaOrganizacao = (organizacao) => semParenteses(organizacao).replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 100);

// "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda - 4"; "U$ BEN$A [10]" → "U$ BEN$A - 10".
function organizacaoComCargo(organizacao) {
  const nome = nomeDaOrganizacao(organizacao);
  const cargo = cargoDaOrganizacao(organizacao);
  return (cargo === null ? nome : `${nome} - ${cargo}`).slice(0, 100);
}

// Campo "Cargo" do relatório: "Membro (4)", só "10" quando o jogo não manda o nome, ou "Não informado".
function cargoLegivel(organizacao) {
  const numero = cargoDaOrganizacao(organizacao);
  const nome = nomeDoCargo(organizacao);
  if (numero === null) return nome || 'Não informado';
  return nome ? `${nome} (${numero})` : String(numero);
}

// "Ban de 3 dias + 1 aviso", "Ban permanente", "Cadeia de 120 min".
function punicaoLegivel(alvo) {
  const tempo = Number(alvo?.tempo) || 0;
  const avisos = Number(alvo?.avisos) || 0;
  const base = alvo?.cmd === 'cadeia' ? `Cadeia de ${tempo} min`
    : alvo?.cmd === 'ban' ? (tempo === 0 ? 'Ban permanente' : `Ban de ${tempo} dia${tempo === 1 ? '' : 's'}`)
      : null;
  if (!base) return null;
  return avisos > 0 ? `${base} + ${avisos} aviso${avisos === 1 ? '' : 's'}` : base;
}

// Discord da conta punida: o que o jogo mandou ou, se não veio, quem tem essa conta no nick.
async function discordDaConta(guildId, contaId, informado) {
  if (informado) return String(informado).slice(0, 100);
  if (!contaId) return 'Não informado';
  const usuario = await Usuario.findOne({ guildId, conta: String(contaId) }).sort({ updatedAt: -1 }).select('userId username').lean().catch(() => null);
  if (!usuario?.userId) return 'Não informado';
  // Em embed, o Discord só troca <@id> pelo nome se já tiver a pessoa carregada; senão
  // mostra o código cru. O nome em texto ao lado deixa sempre legível.
  const nome = String(usuario.username || '').replace(/[<>@]/g, '').slice(0, 40).replace(/([\\`*_~|])/g, '\\$1');
  return nome ? `<@${usuario.userId}> (${nome})` : `<@${usuario.userId}>`;
}

// Quem aplicou: a gamemode ("gamemode:brp teste"). Punições antigas podem ter sido do PC da staff.
const quemAplicou = (nomePc) => (String(nomePc || '').startsWith('gamemode:')
  ? `Gamemode · ${String(nomePc).slice('gamemode:'.length) || 'servidor do jogo'}`
  : `PC da staff · ${nomePc || '?'}`);

const cargoAlto = (cargo) => cargo !== null && cargo >= CARGO_ALTO.min && cargo <= CARGO_ALTO.max;

// Cor, ícone e título pelo tipo da punição.
const VISUAL_DO_TIPO = {
  ban: { cor: '#E03131', icone: '🔨', titulo: 'Banimento aplicado' },
  cadeia: { cor: '#F08C00', icone: '⛓️', titulo: 'Cadeia aplicada' },
  desbanir: { cor: '#2F9E44', icone: '🔓', titulo: 'Desbanimento aplicado' },
  soltar: { cor: '#2F9E44', icone: '🔓', titulo: 'Jogador solto' }
};
const visualDoTipo = (cmd) => VISUAL_DO_TIPO[cmd] || { cor: '#1C7ED6', icone: '✅', titulo: 'Punição aplicada' };

// resultado: itens aplicados pela gamemode (só os aplicados agora contam).
async function avisarAplicadas(client, punicao, resultado, nomePc) {
  // Pulados por já terem levado ban há menos de 1h vêm com ok e erro preenchido.
  const alvos = resultado.filter(r => r.ok && !r.erro);
  if (!client || alvos.length === 0) return 0;
  try {
    const config = await getConfig(punicao.guildId);
    const canalId = config?.channels?.relatorioPunicoes || config?.channels?.log;
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (!canal?.send) return 0;
    const cargo = config?.roles?.responsavel_admin;
    const link = punicao.msgDiscord?.link || '';

    // Nick no jogo de quem veio só com a conta: o que a gamemode já confirmou ou o do Discord.
    const contas = alvos.map(r => ((punicao.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {}).contaId || r.contaId);
    const nicks = await require('./discordGm').nicksConhecidos(punicao.guildId, contas).catch(() => new Map());

    for (const r of alvos) {
      const alvo = (punicao.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {};
      const organizacao = temOrganizacao(r.organizacao);
      // Cargo 6 a 12: marca o responsável admin e quem aceitou no botão da Cadeia Staff.
      // Cargo fora disso não marca ninguém; sem cargo legível, marca só o responsável (como antes).
      const numeroCargo = organizacao ? cargoDaOrganizacao(r.organizacao) : null;
      const alto = organizacao && cargoAlto(numeroCargo);
      const quemAceitou = alto ? (punicao.cadeiaStaffPor?.id || (punicao.origem === 'canal_staff' ? punicao.aceitoPor?.id : '')) : '';
      const papeis = cargo && (alto || (organizacao && numeroCargo === null)) ? [cargo] : [];
      const usuarios = quemAceitou ? [quemAceitou] : [];
      const mencoes = [...papeis.map(id => `<@&${id}>`), ...usuarios.map(id => `<@${id}>`)].join(' ');
      const contaId = alvo.contaId || r.contaId || '';
      const legivel = punicaoLegivel(alvo);
      const aceitaPor = punicao.cadeiaStaffPor?.id ? `<@${punicao.cadeiaStaffPor.id}>`
        : punicao.aceitoPor?.id ? `<@${punicao.aceitoPor.id}>` : punicao.aceitoPor?.nome || 'Não registrado';
      // Nick: o que o jogo mandou ao aplicar, o do pedido ou o conhecido da conta.
      const nick = r.nome || alvo.nick || nicks.get(Number(contaId)) || 'Jogador';
      // O mesmo embed com ou sem organização. Cor e título pelo tipo (ban, cadeia...),
      // quem foi punido no topo, os campos e, no rodapé, quem aplicou.
      const discord = await discordDaConta(punicao.guildId, contaId, r.discord);
      const visual = visualDoTipo(alvo.cmd);
      const servidor = client.guilds?.cache?.get?.(punicao.guildId);
      const embed = new EmbedBuilder()
        .setColor(visual.cor)
        .setAuthor({ name: `Relatório de punições${servidor?.name ? ` · ${servidor.name}` : ''}`.slice(0, 256), iconURL: servidor?.iconURL?.() || undefined })
        .setTitle(`${visual.icone}  ${visual.titulo}`)
        .setDescription([
          `👤 **Player:** ${String(nick).slice(0, 60)} (\`${contaId || '?'}\`)`,
          `💬 **Discord:** ${discord === 'Não informado' ? 'não vinculado' : discord}`,
          `⚖️ **Punição:** ${legivel || `\`${String(r.comando || '?').slice(0, 120)}\``}`
        ].join('\n'))
        .addFields(
          { name: '📝 Motivo', value: String(alvo.motivo || '—').slice(0, 200), inline: true },
          { name: '🏢 Organização', value: organizacao ? nomeDaOrganizacao(r.organizacao) || 'Não informada' : 'Nenhuma', inline: true },
          { name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link', inline: true },
          { name: alto ? '✅ Aceita na Cadeia Staff por' : '✅ Aceita por', value: aceitaPor, inline: true }
        )
        .setFooter({ text: `🎮 Aplicada por ${quemAplicou(nomePc)} · Punição #${String(punicao._id || '').slice(-8) || '—'}`.slice(0, 2048) })
        .setTimestamp();
      await canal.send({
        content: mencoes || undefined,
        embeds: [embed],
        components: botoesDaAplicada(punicao),
        allowedMentions: { roles: papeis, users: usuarios }
      });
    }
    return alvos.length;
  } catch (error) {
    log.warn(`Falha ao registrar punição aplicada no relatório de punições: ${error.message}`);
    return 0;
  }
}

// A gamemode recusou porque a conta é de staff ou admin (CONTA_PROTEGIDA): aviso no
// Relatório de punições, marcando o responsável, no mesmo formato da punição aplicada.
async function avisarContaProtegida(client, pedido, dados, nomeConexao = '') {
  if (!client) return false;
  try {
    const config = await getConfig(pedido.guildId);
    const canalId = config?.channels?.relatorioPunicoes || config?.channels?.log;
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (!canal?.send) return false;
    const PontePunicao = require('../../models/PontePunicao');
    const punicao = await PontePunicao.findById(pedido.punicaoId, { msgDiscord: 1, alvos: 1, aceitoPor: 1, cadeiaStaffPor: 1 }).lean();
    const alvo = (punicao?.alvos || []).find(a => String(a._id) === String(pedido.alvoId)) || {};
    const conta = dados.conta || pedido.conta || alvo.contaId || '?';
    const discord = await discordDaConta(pedido.guildId, conta, '');
    const servidor = client.guilds?.cache?.get?.(pedido.guildId);
    const cargo = config?.roles?.responsavel_admin;
    const aceitaPor = punicao?.cadeiaStaffPor?.id ? `<@${punicao.cadeiaStaffPor.id}>` : punicao?.aceitoPor?.id ? `<@${punicao.aceitoPor.id}>` : punicao?.aceitoPor?.nome || '—';
    const embed = new EmbedBuilder()
      .setColor('#7048E8')
      .setAuthor({ name: `Relatório de punições${servidor?.name ? ` · ${servidor.name}` : ''}`.slice(0, 256), iconURL: servidor?.iconURL?.() || undefined })
      .setTitle('🛡️  Conta protegida: punição não aplicada')
      .setDescription([
        `👤 **Player:** ${String(dados.nome || pedido.nick || alvo.nick || 'Jogador').slice(0, 60)} (\`${conta}\`)`,
        `💬 **Discord:** ${discord === 'Não informado' ? 'não vinculado' : discord}`,
        `⚖️ **Punição pedida:** ${punicaoLegivel(alvo) || pedido.tipo}`,
        'A gamemode não pune contas de staff ou admin. Se for para punir, aplique à mão no jogo.'
      ].join('\n'))
      .addFields(
        { name: '📝 Motivo', value: String(alvo.motivo || '—').slice(0, 200), inline: true },
        { name: '🏢 Organização', value: temOrganizacao(dados.organizacao) ? nomeDaOrganizacao(dados.organizacao) || 'Não informada' : 'Nenhuma', inline: true },
        { name: '🔗 Denúncia', value: punicao?.msgDiscord?.link ? `[Abrir denúncia](${punicao.msgDiscord.link})` : 'Sem link', inline: true },
        { name: '✅ Aceita por', value: aceitaPor, inline: true }
      )
      .setFooter({ text: `🎮 Recusada por ${quemAplicou(`gamemode:${nomeConexao}`)} · Punição #${String(pedido.punicaoId).slice(-8)}`.slice(0, 2048) })
      .setTimestamp();
    await canal.send({ content: cargo ? `<@&${cargo}>` : undefined, embeds: [embed], allowedMentions: { roles: cargo ? [cargo] : [] } });
    return true;
  } catch (error) {
    log.warn(`Falha ao avisar conta protegida no relatório: ${error.message}`);
    return false;
  }
}

module.exports = { avisarAplicadas, avisarContaProtegida, punicaoLegivel, discordDaConta, quemAplicou, temOrganizacao, cargoDaOrganizacao, nomeDoCargo, nomeDaOrganizacao, cargoLegivel, organizacaoComCargo, SEM_ORGANIZACAO };
