// Toda punição aplicada pelo painel do jogo vira um registro no canal Relatório de punições
// (ou no Log Admin, se ele não estiver configurado), com
// organização (com o cargo), nick, ID da conta, comando e link da denúncia. Cargo 6 a 12
// de organização marca o responsável admin e quem aceitou na Cadeia Staff.
const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/configCache');
const { botaoEntrarNoTopico } = require('../../utils/restricaoTopicos');
const { Logger } = require('../../utils/logger');
const Usuario = require('../../models/Usuario');

const log = new Logger({ tag: 'PonteOrganizacao' });

// O que o /vercontaid mostra para quem não tem organização. CONFIGURÁVEL.
const SEM_ORGANIZACAO = ['', 'NENHUMA', 'NENHUM', 'CIVIL', 'SEM', 'SEM ORGANIZACAO', 'DESEMPREGADO', 'NAO POSSUI', '-', 'N/A'];

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda": o cargo entre parênteses não entra.
const semParenteses = (texto) => String(texto || '').replace(/\s*\([^)]*\)/g, '').trim();
const temOrganizacao = (organizacao) => !SEM_ORGANIZACAO.includes(normalizar(semParenteses(organizacao)));
// Denúncia de tópico privado: o aviso leva o botão "Entrar no tópico".
const botoesDoTopico = (punicao) => (punicao.mensagens?.topicoPrivado && punicao.mensagens.topicoId ? [botaoEntrarNoTopico(punicao.mensagens.topicoId)] : []);

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
  const usuario = await Usuario.findOne({ guildId, conta: String(contaId) }).sort({ updatedAt: -1 }).select('userId').lean().catch(() => null);
  return usuario?.userId ? `<@${usuario.userId}>` : 'Não informado';
}

// Quem aplicou: a gamemode ("gamemode:brp teste") ou um PC da staff.
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

// resultado: itens que o PC mandou em /aplicada (só os aplicados agora contam).
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
      // foto do Discord do jogador quando ele está vinculado, quem foi punido no
      // topo e duas linhas de três campos.
      const discord = await discordDaConta(punicao.guildId, contaId, r.discord);
      const discordId = String(discord).match(/^<@!?(\d{15,21})>$/)?.[1];
      const pessoa = discordId ? await client.users?.fetch?.(discordId).catch(() => null) : null;
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
          { name: alto ? '✅ Aceita na Cadeia Staff por' : '✅ Aceita por', value: aceitaPor, inline: true },
          { name: '🎮 Aplicada por', value: quemAplicou(nomePc), inline: true },
          { name: '🧾 Comando', value: `\`${String(r.comando || '—').slice(0, 80)}\``, inline: true }
        )
        .setFooter({ text: `Punição #${String(punicao._id || '').slice(-8) || '—'}` })
        .setTimestamp();
      const avatar = pessoa?.displayAvatarURL?.({ size: 128 });
      if (avatar) embed.setThumbnail(avatar);
      await canal.send({
        content: mencoes || undefined,
        embeds: [embed],
        components: botoesDoTopico(punicao),
        allowedMentions: { roles: papeis, users: usuarios }
      });
    }
    return alvos.length;
  } catch (error) {
    log.warn(`Falha ao registrar punição aplicada no relatório de punições: ${error.message}`);
    return 0;
  }
}

// Acusado informado só pelo nick e o /vercontanick não achou a conta: a punição fica
// pausada na fila do jogo. Avisa no Log Admin marcando o responsável admin.
async function avisarNicksNaoEncontrados(client, punicao, resultado, nomePc) {
  if (!client || resultado.length === 0) return 0;
  try {
    const config = await getConfig(punicao.guildId);
    const canal = config?.channels?.log ? await client.channels.fetch(config.channels.log).catch(() => null) : null;
    if (!canal?.send) return 0;
    const cargo = config?.roles?.responsavel_admin;
    const nicks = resultado.map(r => {
      const alvo = (punicao.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {};
      return `\`${alvo.nick || r.nome || '?'}\``;
    });
    const link = punicao.msgDiscord?.link || '';
    const embed = new EmbedBuilder()
      .setColor('#E67E22')
      .setTitle('⏸️ Punição pausada: nick não encontrado')
      .setDescription(`O /vercontanick não encontrou a conta de ${nicks.join(', ')}. A punição ficou pausada na fila do jogo até alguém corrigir o nick ou informar o ID da conta no painel.`)
      .addFields({ name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link' })
      .setFooter({ text: `Painel do jogo (PC: ${nomePc})` })
      .setTimestamp();
    await canal.send({ content: cargo ? `<@&${cargo}>` : undefined, embeds: [embed], allowedMentions: { roles: cargo ? [cargo] : [] } });
    return resultado.length;
  } catch (error) {
    log.warn(`Falha ao avisar nick não encontrado no Log Admin: ${error.message}`);
    return 0;
  }
}

// O servidor respondeu que a conta já estava banida (ex.: chegou a 3/3 avisos e tomou ban
// automático). Nada foi aplicado; fica o registro no Relatório de punições.
async function avisarJaBanidos(client, punicao, resultado, nomePc) {
  if (!client || resultado.length === 0) return 0;
  try {
    const config = await getConfig(punicao.guildId);
    const canalId = config?.channels?.relatorioPunicoes || config?.channels?.log;
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (!canal?.send) return 0;
    const link = punicao.msgDiscord?.link || '';
    for (const r of resultado) {
      const alvo = (punicao.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {};
      const TEXTOS = {
        'ja tem ban permanente': ['🔒 Já tem ban permanente: punição não aplicada',
          'Esta conta já tem um banimento permanente. Ele foi mantido e a nova punição saiu da fila sem ser aplicada.'],
        'desbanir falhou': ['⚠️ Não foi possível desbanir para somar a punição',
          'O painel tentou desbanir a conta para aplicar o ban somado, mas o servidor continuou dizendo que ela está banida. A punição ficou na fila para aplicar à mão.'],
        'ja estava banido': ['⚠️ Já estava banido: punição não aplicada',
          'Esta conta já está banida (por exemplo, chegou a 3/3 avisos). A punição saiu da fila sem ser aplicada.']
      };
      const [titulo, descricao] = TEXTOS[r.erro] || TEXTOS['ja estava banido'];
      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle(titulo)
        .setDescription(descricao)
        .addFields(
          { name: '🏢 Organização', value: temOrganizacao(r.organizacao) ? organizacaoComCargo(r.organizacao) : 'Nenhuma', inline: true },
          { name: '👤 Nick no jogo', value: String(r.nome || alvo.nick || 'Não identificado').slice(0, 100), inline: true },
          { name: '🆔 ID da conta', value: `\`${r.contaId || alvo.contaId || '?'}\``, inline: true },
          { name: '⚖️ Punição que seria aplicada', value: `\`${String(r.comando || '').slice(0, 120) || '?'}\`` },
          ...(r.resposta ? [{ name: '💬 Resposta do servidor', value: String(r.resposta).slice(0, 200) }] : []),
          { name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link' }
        )
        .setFooter({ text: `Painel do jogo (PC: ${nomePc})` })
        .setTimestamp();
      await canal.send({ embeds: [embed], components: botoesDoTopico(punicao) });
    }
    return resultado.length;
  } catch (error) {
    log.warn(`Falha ao registrar "já estava banido" no relatório de punições: ${error.message}`);
    return 0;
  }
}

// O servidor do jogo não respondeu (tela do /vercontaid ou do comando não chegou) várias vezes
// seguidas: o automático parou de tentar. Avisa no Log Admin marcando o responsável admin.
async function avisarSemResposta(client, punicao, resultado, nomePc, tentativas) {
  if (!client || resultado.length === 0) return 0;
  try {
    const config = await getConfig(punicao.guildId);
    const canal = config?.channels?.log ? await client.channels.fetch(config.channels.log).catch(() => null) : null;
    if (!canal?.send) return 0;
    const cargo = config?.roles?.responsavel_admin;
    const contas = resultado.map(r => {
      const alvo = (punicao.alvos || []).find(a => String(a._id) === String(r.alvoId)) || {};
      return `\`${r.contaId || alvo.contaId || alvo.nick || '?'}\``;
    });
    const link = punicao.msgDiscord?.link || '';
    const embed = new EmbedBuilder()
      .setColor('#E67E22')
      .setTitle('⏸️ Punição parada: servidor do jogo não respondeu')
      .setDescription(`O servidor não respondeu ${tentativas} vezes ao aplicar a punição de ${contas.join(', ')}. O automático parou de tentar: a punição continua na fila do jogo para aplicar pelo painel.`)
      .addFields({ name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link' })
      .setFooter({ text: `Painel do jogo (PC: ${nomePc})` })
      .setTimestamp();
    await canal.send({ content: cargo ? `<@&${cargo}>` : undefined, embeds: [embed], allowedMentions: { roles: cargo ? [cargo] : [] } });
    return resultado.length;
  } catch (error) {
    log.warn(`Falha ao avisar servidor sem resposta no Log Admin: ${error.message}`);
    return 0;
  }
}

module.exports = { avisarAplicadas, punicaoLegivel, avisarNicksNaoEncontrados, avisarJaBanidos, avisarSemResposta, temOrganizacao, cargoDaOrganizacao, nomeDoCargo, nomeDaOrganizacao, cargoLegivel, organizacaoComCargo, SEM_ORGANIZACAO };
