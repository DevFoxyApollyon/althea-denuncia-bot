// Toda punição aplicada pelo painel do jogo vira um registro no canal Relatório de punições
// (ou no Log Admin, se ele não estiver configurado), com
// organização (com o cargo), nick, ID da conta, comando e link da denúncia. Cargo 6 a 12
// de organização marca o responsável admin e quem aceitou na Cadeia Staff.
const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/configCache');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'PonteOrganizacao' });

// O que o /vercontaid mostra para quem não tem organização. CONFIGURÁVEL.
const SEM_ORGANIZACAO = ['', 'NENHUMA', 'NENHUM', 'CIVIL', 'SEM', 'SEM ORGANIZACAO', 'DESEMPREGADO', 'NAO POSSUI', '-', 'N/A'];

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda": o cargo entre parênteses não entra.
const semParenteses = (texto) => String(texto || '').replace(/\s*\([^)]*\)/g, '').trim();
const temOrganizacao = (organizacao) => !SEM_ORGANIZACAO.includes(normalizar(semParenteses(organizacao)));

// Cargos que fazem o relatório marcar o responsável admin e quem aceitou na Cadeia Staff.
const CARGO_ALTO = { min: 6, max: 12 };

// Número do cargo: o último número entre parênteses ("( Membro - 4)" → 4, "(Cargo:[ lider - 12])" → 12).
function cargoDaOrganizacao(organizacao) {
  const dentro = String(organizacao || '').match(/\(([^]*)\)/)?.[1] || '';
  const numeros = dentro.match(/\d+/g);
  return numeros ? Number(numeros[numeros.length - 1]) : null;
}

// "Tropa da Holanda ( Membro - 4)" → "Tropa da Holanda - 4".
function organizacaoComCargo(organizacao) {
  const nome = semParenteses(organizacao).replace(/\s+/g, ' ').trim();
  const cargo = cargoDaOrganizacao(organizacao);
  return (cargo === null ? nome : `${nome} - ${cargo}`).slice(0, 100);
}

const cargoAlto = (cargo) => cargo !== null && cargo >= CARGO_ALTO.min && cargo <= CARGO_ALTO.max;

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
      const embed = new EmbedBuilder()
        .setColor(organizacao ? '#C0392B' : '#7F8C8D')
        .setTitle(organizacao ? '🚨 Punição em membro de organização' : '⚖️ Punição aplicada pelo painel do jogo')
        .addFields(
          { name: '🏢 Organização', value: organizacao ? organizacaoComCargo(r.organizacao) : 'Nenhuma', inline: true },
          { name: '👤 Nick no jogo', value: String(r.nome || alvo.nick || 'Não identificado').slice(0, 100), inline: true },
          { name: '💬 Discord', value: String(r.discord || 'Não informado').slice(0, 100), inline: true },
          { name: '🆔 ID da conta', value: `\`${alvo.contaId || '?'}\``, inline: true },
          { name: '⚖️ Punição', value: `\`${String(r.comando || '').slice(0, 120)}\`` },
          { name: '🔗 Denúncia', value: link ? `[Abrir denúncia](${link})` : 'Sem link' }
        )
        .setFooter({ text: `Aplicada pelo painel do jogo (PC: ${nomePc})` })
        .setTimestamp();
      if (alto) embed.addFields({ name: '✅ Aceita na Cadeia Staff por', value: quemAceitou ? `<@${quemAceitou}>` : 'Não registrado' });
      await canal.send({
        content: mencoes || undefined,
        embeds: [embed],
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
      await canal.send({ embeds: [embed] });
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

module.exports = { avisarAplicadas, avisarNicksNaoEncontrados, avisarJaBanidos, avisarSemResposta, temOrganizacao, cargoDaOrganizacao, organizacaoComCargo, SEM_ORGANIZACAO };
