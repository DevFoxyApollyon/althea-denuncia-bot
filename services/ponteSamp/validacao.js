// Validação dos alvos e montagem dos comandos. O Lua repete as mesmas regras:
// o servidor nunca confia no que o PC manda, e o PC nunca confia no servidor.
const mongoose = require('mongoose');
const { REGRAS_PUNICAO, SUFIXO_MOTIVO, TEMPLATES_PADRAO, TEMPLATES_ANTIGOS, CMDS_PUNICAO, CMD_PADRAO, TEMPO_PADRAO } = require('./constantes');

const RE_CONTA = /^\d{1,9}$/;
const RE_NICK = /^[A-Za-z0-9_[\].$@=()]{3,24}$/;
const RE_CMD = /^[a-z0-9_]{1,20}$/;
const MARCADORES = ['{cmd}', '{id}', '{nick}', '{tempo}', '{motivo}'];
const MAX_ALVOS = 30;
const MAX_COMANDO = 128; // limite do chat do SA-MP

// Converte o Map do mongoose (ou objeto comum) em objeto.
const templatesComoObjeto = (templates) =>
  templates instanceof Map ? Object.fromEntries(templates) : { ...(templates || {}) };

// Tira o que pode quebrar o chat ou virar outro comando: quebras de linha,
// chaves de cor do SA-MP, barra no início e caracteres de controle.
function limparMotivo(texto) {
  return String(texto || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n{}\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\/+\s*/, '')
    .slice(0, 60)
    .trim();
}

// Template só pode ter os marcadores conhecidos e precisa começar com "/".
function templateValido(template) {
  const t = String(template || '');
  if (!t.startsWith('/') || t.length > MAX_COMANDO || /[\r\n]/.test(t)) return false;
  const marcadores = t.match(/\{[^}]*\}/g) || [];
  return marcadores.every(m => MARCADORES.includes(m)) && (t.includes('{id}') || t.includes('{nick}'));
}

// Motivo no jogo sempre termina com [DC]; o corte deixa espaço para a marca.
function motivoComSufixo(texto) {
  const motivo = limparMotivo(texto);
  if (motivo.toUpperCase().endsWith(SUFIXO_MOTIVO)) return motivo;
  const base = motivo.slice(0, 60 - SUFIXO_MOTIVO.length - 1).trim();
  return base ? `${base} ${SUFIXO_MOTIVO}` : SUFIXO_MOTIVO;
}

// Maiúsculas e sem acentos, para comparar com a tabela de motivos.
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Sigla ou frase inteira (DB não casa dentro de ADB).
function contemMotivo(textoNormal, motivo) {
  const escapado = motivo.replace(/[.*+?^${}()|[\]\/]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escapado}($|[^A-Z0-9])`).test(textoNormal);
}

// Junta motivos da tabela numa punição só: permanente vence tudo; banimentos somam
// dias e avisos (SAAV + RUSH = 6 dias, 2 avisos); banimento vence cadeia; cadeias somam minutos.
function combinarMotivos(itens) {
  const bans = itens.filter(m => m.cmd === 'ban');
  const usados = bans.length ? bans : itens;
  const cmd = bans.length ? 'ban' : (itens[0]?.cmd || CMD_PADRAO);
  const permanente = bans.some(m => m.tempo === 0);
  const tempo = permanente ? 0 : Math.min(99999, usados.reduce((t, m) => t + m.tempo, 0));
  const avisos = Math.min(10, usados.reduce((t, m) => t + (m.avisos || 0), 0));
  const nomes = usados.map(m => m.nome);
  const regra = (usados.length === 1 ? `${nomes[0]}: ${usados[0].grupo}` : nomes.join(' + ')).slice(0, 60);
  return { cmd, tempo, avisos, regra, motivos: nomes };
}

// "Banimento de 5 dias + 1 aviso", "Banimento permanente", "Cadeia de 120 minutos".
function grupoDe(cmd, tempo, avisos) {
  const base = cmd === 'cadeia'
    ? `Cadeia de ${tempo} minutos`
    : tempo === 0 ? 'Banimento permanente' : `Banimento de ${tempo} dia${tempo === 1 ? '' : 's'}`;
  return avisos > 0 ? `${base} + ${avisos} aviso${avisos === 1 ? '' : 's'}` : base;
}

// Tabela padrão (constantes.js) como lista plana: um item por motivo, com seus sinônimos.
const ITENS_TABELA = REGRAS_PUNICAO.flatMap(regra => regra.motivos.map(m => {
  const sinonimos = m.split('|');
  const avisos = regra.avisos || 0;
  return { nome: sinonimos[0], sinonimos, cmd: regra.cmd, tempo: regra.tempo, avisos, grupo: grupoDe(regra.cmd, regra.tempo, avisos) };
}));

// Tabela da guild (editada no jogo) ou a padrão, se nunca foi editada.
function tabelaDa(servidor) {
  const propria = Array.isArray(servidor?.regras) ? servidor.regras : [];
  if (propria.length === 0) return ITENS_TABELA;
  return propria.map(r => {
    const sinonimos = [r.nome, ...(r.sinonimos || [])].filter(Boolean);
    return { nome: r.nome, sinonimos, cmd: r.cmd, tempo: r.tempo, avisos: r.avisos || 0, grupo: grupoDe(r.cmd, r.tempo, r.avisos || 0) };
  });
}

// Valida a tabela enviada pelo painel do jogo. Devolve { regras } ou { erro }.
function validarTabela(lista) {
  if (!Array.isArray(lista) || lista.length > 150) return { erro: 'Tabela inválida (até 150 motivos).' };
  const limpar = (t) => normalizar(t).replace(/[^A-Z0-9 /+-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const regras = [];
  const vistos = new Set();
  for (const [i, bruto] of lista.entries()) {
    const n = i + 1;
    const nome = limpar(bruto?.nome);
    const sinonimos = (Array.isArray(bruto?.sinonimos) ? bruto.sinonimos : []).map(limpar).filter(Boolean).slice(0, 5);
    const cmd = String(bruto?.cmd || '');
    const tempo = Number(bruto?.tempo);
    const avisos = Number(bruto?.avisos ?? 0);
    if (nome.length < 2) return { erro: `Motivo ${n}: nome muito curto.` };
    if (vistos.has(nome)) return { erro: `Motivo "${nome}" repetido.` };
    if (!CMDS_PUNICAO.includes(cmd)) return { erro: `Motivo ${nome}: tipo inválido (ban ou cadeia).` };
    if (!Number.isInteger(tempo) || tempo < 0 || tempo > 99999 || (cmd === 'cadeia' && tempo === 0)) return { erro: `Motivo ${nome}: tempo inválido.` };
    if (!Number.isInteger(avisos) || avisos < 0 || avisos > 10) return { erro: `Motivo ${nome}: avisos inválidos (0 a 10).` };
    vistos.add(nome);
    regras.push({ nome, sinonimos: sinonimos.filter(s => s !== nome), cmd, tempo, avisos });
  }
  return { regras };
}

// Descobre a punição pelo motivo escrito no Discord (ex.: "DM" → ban 5 dias; "SAAV+RUSH" → 6 dias).
// Sem nenhum motivo conhecido: padrão, com regra vazia para a staff conferir.
function classificarMotivo(texto, tabela = ITENS_TABELA) {
  const normal = normalizar(texto);
  const achados = tabela.filter(item => item.sinonimos.some(m => contemMotivo(normal, m)));
  if (achados.length === 0) return { cmd: CMD_PADRAO, tempo: TEMPO_PADRAO, avisos: 1, regra: '', motivos: [] };
  return combinarMotivos(achados);
}

// Guild ativada com os templates provisórios passa a usar os comandos reais;
// templates auxiliares que faltarem (aviso, blackban) vêm do padrão.
function templatesEfetivos(templates) {
  const atuais = templatesComoObjeto(templates);
  const antigos = Object.keys(atuais).length === Object.keys(TEMPLATES_ANTIGOS).length
    && Object.entries(TEMPLATES_ANTIGOS).every(([k, v]) => atuais[k] === v);
  if (antigos) return { ...TEMPLATES_PADRAO };
  const efetivos = { ...TEMPLATES_PADRAO, ...atuais };
  // O comando certo é /agendacadeia; guilds ativadas com o nome errado passam ao certo.
  if (/^\/agendarcadeia/i.test(efetivos.cadeia || '')) efetivos.cadeia = efetivos.cadeia.replace(/^\/agendarcadeia/i, '/agendacadeia');
  return efetivos;
}

function montarComando(template, alvo, cmd) {
  if (!templateValido(template)) return null;
  if (template.includes('{nick}') && !alvo.nick) return null;
  const comando = template
    .replace(/\{cmd\}/g, cmd)
    .replace(/\{id\}/g, alvo.contaId)
    .replace(/\{nick\}/g, alvo.nick || '')
    .replace(/\{tempo\}/g, String(alvo.tempo ?? 0))
    .replace(/\{motivo\}/g, motivoComSufixo(alvo.motivo))
    .replace(/\s+/g, ' ')
    .trim();
  return comando.startsWith('/') && comando.length <= MAX_COMANDO ? comando : null;
}


// Valida a lista enviada pelo painel. Devolve { alvos } ou { erro }.
function validarAlvos(lista, templates) {
  const tpl = templatesEfetivos(templates);
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_ALVOS) {
    return { erro: `Lista de alvos inválida (1 a ${MAX_ALVOS}).` };
  }
  const alvos = [];
  for (const [i, bruto] of lista.entries()) {
    const n = i + 1;
    if (!bruto || typeof bruto !== 'object') return { erro: `Alvo ${n} inválido.` };
    const contaId = String(bruto.contaId ?? '').trim();
    const nick = String(bruto.nick ?? '').trim();
    const cmd = String(bruto.cmd ?? '').trim();
    const tempo = Number(bruto.tempo ?? 0);
    if (contaId && !RE_CONTA.test(contaId)) return { erro: `Alvo ${n}: ID de conta inválido.` };
    if (!contaId && !nick) return { erro: `Alvo ${n}: informe o ID da conta ou o nick.` };
    if (nick && !RE_NICK.test(nick)) return { erro: `Alvo ${n}: nick inválido.` };
    const avisos = Number(bruto.avisos ?? 0);
    if (!CMDS_PUNICAO.includes(cmd) || !tpl[cmd]) return { erro: `Alvo ${n}: tipo "${cmd}" inválido (use ban ou cadeia).` };
    if (!Number.isInteger(tempo) || tempo < 0 || tempo > 99999) return { erro: `Alvo ${n}: tempo inválido.` };
    if (!Number.isInteger(avisos) || avisos < 0 || avisos > 10) return { erro: `Alvo ${n}: avisos inválidos (0 a 10).` };

    const alvo = {
      contaId, nick, cmd, tempo, avisos,
      motivo: limparMotivo(bruto.motivo),
      regra: String(bruto.regra ?? '').slice(0, 60),
      removido: bruto.removido === true,
      adicionadoNoJogo: bruto.adicionadoNoJogo === true
    };
    // Mantém o _id dos alvos que já existiam (o resultado da execução aponta para ele).
    if (bruto._id && mongoose.isValidObjectId(bruto._id)) alvo._id = new mongoose.Types.ObjectId(String(bruto._id));
    alvos.push(alvo);
  }
  return { alvos };
}

// Prévia dos comandos para o painel conferir (a montagem que vale é a do Lua).
function previaComandos(alvos, templates) {
  const tpl = templatesEfetivos(templates);
  return alvos.map(a => ({ alvoId: a._id, comando: montarComando(tpl[a.cmd], a, a.cmd) }));
}

// Templates editados pela staff: chave curta e template válido.
function validarTemplates(objeto) {
  const entradas = Object.entries(objeto || {});
  if (entradas.length === 0 || entradas.length > 15) return { erro: 'Informe de 1 a 15 comandos.' };
  for (const [cmd, template] of entradas) {
    if (!RE_CMD.test(cmd)) return { erro: `Nome de comando inválido: "${cmd}".` };
    if (!templateValido(template)) return { erro: `Template de "${cmd}" inválido: precisa começar com "/", ter {id} e só usar {cmd}, {id}, {tempo} e {motivo}.` };
  }
  return { templates: Object.fromEntries(entradas) };
}

module.exports = {
  RE_CONTA,
  RE_NICK,
  limparMotivo,
  motivoComSufixo,
  classificarMotivo,
  combinarMotivos,
  ITENS_TABELA,
  tabelaDa,
  validarTabela,
  grupoDe,
  templatesEfetivos,
  templateValido,
  montarComando,
  templatesComoObjeto,
  validarAlvos,
  previaComandos,
  validarTemplates
};
