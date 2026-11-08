// Validação dos alvos, do motivo e da tabela de punições.
const mongoose = require('mongoose');
const { REGRAS_PUNICAO, SUFIXO_MOTIVO, CMDS_PUNICAO, CMD_PADRAO, TEMPO_PADRAO } = require('./constantes');

const RE_CONTA = /^\d{1,9}$/;
const RE_NICK = /^[A-Za-z0-9_[\].$@=()]{3,24}$/;
const MAX_ALVOS = 30;

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
function combinarMotivos(todos) {
  // Só registro não pune no jogo: com ban ou cadeia junto, fica de fora; sozinho, o
  // resultado é "registro" com o texto dos motivos.
  const itens = todos.filter(m => m.cmd !== 'registro');
  if (!itens.length) {
    const nomes = todos.map(m => m.nome);
    return { cmd: 'registro', tempo: 0, avisos: 0, regra: nomes.join(' + ').slice(0, 60), motivos: nomes, texto: todos.map(m => m.texto).filter(Boolean).join(' + ').slice(0, 120) };
  }
  const bans = itens.filter(m => m.cmd === 'ban');
  const usados = bans.length ? bans : itens;
  const cmd = bans.length ? 'ban' : (itens[0]?.cmd || CMD_PADRAO);
  const permanente = bans.some(m => m.tempo === 0);
  const tempo = permanente ? 0 : Math.min(99999, usados.reduce((t, m) => t + m.tempo, 0));
  // Permanente (/blackban) não leva aviso: a conta não volta a jogar.
  const avisos = permanente ? 0 : Math.min(10, usados.reduce((t, m) => t + (m.avisos || 0), 0));
  const nomes = usados.map(m => m.nome);
  const regra = (usados.length === 1 ? `${nomes[0]}: ${usados[0].grupo}` : nomes.join(' + ')).slice(0, 60);
  return { cmd, tempo, avisos, regra, motivos: nomes };
}

// "Banimento de 5 dias + 1 aviso", "Banimento permanente", "Cadeia de 120 minutos".
function grupoDe(cmd, tempo, avisos, texto = '') {
  if (cmd === 'registro') return `${texto || 'Neutro'} (neutro)`;
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
    return { nome: r.nome, sinonimos, cmd: r.cmd, tempo: r.tempo, avisos: r.avisos || 0, texto: r.texto || '', grupo: grupoDe(r.cmd, r.tempo, r.avisos || 0, r.texto) };
  });
}

// Valida a tabela de motivos (site ou Discord). Devolve { regras } ou { erro }.
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
    if (cmd === 'registro') {
      // Só registro: sem tempo nem avisos, com o texto que aparece como punição.
      // Neutro: só visual. O texto é opcional (sem ele, aparece "Neutro").
      const texto = String(bruto?.texto || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Neutro';
      vistos.add(nome);
      regras.push({ nome, sinonimos: sinonimos.filter(s => s !== nome), cmd, tempo: 0, avisos: 0, texto });
      continue;
    }
    if (!CMDS_PUNICAO.includes(cmd)) return { erro: `Motivo ${nome}: tipo inválido (ban, cadeia ou neutro).` };
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

// Valida a lista de alvos (aceite ou Editar). Devolve { alvos } ou { erro }.
function validarAlvos(lista) {
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
    if (!CMDS_PUNICAO.includes(cmd)) return { erro: `Alvo ${n}: tipo "${cmd}" inválido (use ban ou cadeia).` };
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
  validarAlvos
};
