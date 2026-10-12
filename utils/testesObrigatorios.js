// Testes da staff que valem como requisito: quem não tem aprovação em dia num
// teste marcado como obrigatório não reivindica denúncias, nem pelo Discord
// nem pelo site. O responsável do servidor fica de fora da regra.
const { MessageFlags } = require('discord.js');
const TesteStaff = require('../models/TesteStaff');
const TesteResposta = require('../models/TesteResposta');
const { getConfig } = require('./configCache');

const DIA_MS = 24 * 60 * 60 * 1000;
const GUARDAR_POR_MS = 30 * 1000;
const guardadas = new Map();

// Como a pessoa está num teste, olhando a tentativa mais recente dela:
//   novo      - nunca fez;
//   reprovado - a última tentativa não atingiu a nota;
//   vencido   - foi aprovada, mas a validade do teste já passou;
//   aprovado  - aprovação em dia (venceEm diz até quando, se o teste tem validade).
function situacaoNoTeste(teste, ultima, agora = Date.now()) {
  if (!ultima) return { situacao: 'novo', venceEm: null };
  if (!ultima.aprovado) return { situacao: 'reprovado', venceEm: null };
  const dias = Number(teste.validadeDias) || 0;
  if (!dias) return { situacao: 'aprovado', venceEm: null };
  const venceEm = new Date(new Date(ultima.em).getTime() + dias * DIA_MS);
  return { situacao: venceEm.getTime() <= agora ? 'vencido' : 'aprovado', venceEm };
}

// Testes publicados do servidor, com a situação da pessoa em cada um.
async function situacaoDaPessoa(guildId, usuarioId, agora = Date.now()) {
  const [testes, respostas] = await Promise.all([
    TesteStaff.find({ guildId }).sort({ criadoEm: 1, _id: 1 }).select('titulo ativo obrigatorio validadeDias perguntas.id').lean(),
    TesteResposta.find({ guildId, usuarioId }).sort({ em: -1 }).limit(300).select('testeId aprovado em').lean()
  ]);
  // Respostas antigas, sem testeId, são do teste mais antigo do servidor.
  const maisAntigo = testes[0] ? String(testes[0]._id) : null;

  return testes.filter(teste => teste.ativo !== false && teste.perguntas?.length).map((teste) => {
    const id = String(teste._id);
    const ultima = respostas.find(item => (item.testeId || maisAntigo) === id);
    return { id, titulo: teste.titulo, obrigatorio: Boolean(teste.obrigatorio), ...situacaoNoTeste(teste, ultima, agora) };
  });
}

// O que falta para a pessoa: testes sem aprovação em dia. Guardado por meio
// minuto, para o botão "Reivindicar" não consultar o banco a cada clique.
async function pendenciasDeTeste(guildId, usuarioId) {
  const chave = `${guildId}:${usuarioId}`;
  const guardada = guardadas.get(chave);
  if (guardada && Date.now() - guardada.em < GUARDAR_POR_MS) return guardada.dados;

  const todos = await situacaoDaPessoa(guildId, usuarioId);
  const pendentes = todos.filter(item => item.situacao !== 'aprovado');
  const dados = { total: pendentes.length, obrigatorios: pendentes.filter(item => item.obrigatorio) };
  if (guardadas.size > 2000) guardadas.clear();
  guardadas.set(chave, { em: Date.now(), dados });
  return dados;
}

// Chamar quando um teste é salvo, apagado ou respondido: a situação de todos muda.
function esquecerPendencias(guildId, usuarioId) {
  if (usuarioId) return guardadas.delete(`${guildId}:${usuarioId}`);
  for (const chave of guardadas.keys()) if (chave.startsWith(`${guildId}:`)) guardadas.delete(chave);
}

const MOTIVO = { novo: 'ainda não fez', reprovado: 'não foi aprovado', vencido: 'aprovação vencida' };

// Chame ANTES de processar o botão "reivindicar". Devolve true se bloqueou (e
// a pessoa já foi avisada). Numa falha de consulta libera: o atendimento não
// trava por problema técnico.
async function bloquearReivindicacaoSemTeste(interaction) {
  let obrigatorios;
  try {
    if (!interaction.guild) return false;
    const config = await getConfig(interaction.guild.id);
    const responsavel = config?.roles?.responsavel_admin;
    if (responsavel && interaction.member?.roles?.cache?.has(responsavel)) return false;

    ({ obrigatorios } = await pendenciasDeTeste(interaction.guild.id, interaction.user.id));
    if (!obrigatorios.length) return false;
  } catch (erro) {
    console.warn('[Testes] Falha ao conferir os testes obrigatórios; liberando a reivindicação:', erro.message);
    return false;
  }

  const site = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  const content = [
    '🚫 **Você ainda não pode reivindicar denúncias.**',
    obrigatorios.length === 1 ? 'Falta a aprovação em um teste obrigatório da staff:' : `Falta a aprovação em ${obrigatorios.length} testes obrigatórios da staff:`,
    '',
    ...obrigatorios.slice(0, 8).map(item => `• **${item.titulo}** (${MOTIVO[item.situacao]})`),
    '',
    site.startsWith('https://') ? `Faça pelo site: ${site}/#/teste` : 'Faça os testes pelo site, na área da staff.'
  ].join('\n');

  try {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  } catch (erro) {
    console.warn('[Testes] Não foi possível enviar o aviso de teste obrigatório:', erro.message);
  }
  return true;
}

module.exports = { situacaoNoTeste, situacaoDaPessoa, pendenciasDeTeste, esquecerPendencias, bloquearReivindicacaoSemTeste };
