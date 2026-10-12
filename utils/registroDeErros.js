// Guarda na memória os últimos erros e avisos do bot e do site, para o
// responsável ver numa tela do admin sem precisar abrir o log da hospedagem.
// Tudo o que passa por console.error e console.warn entra aqui. Some quando o
// bot reinicia.
const MAXIMO = 200;
const TAMANHO_MAXIMO = 600;
const registros = [];
let instalado = false;

// Tira as cores do terminal e esconde o que não pode aparecer numa tela:
// senha de banco, tokens e chaves.
function limpar(texto) {
  return String(texto)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1***@')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[token oculto]')
    .replace(/((?:token|secret|senha|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***')
    .trim()
    .slice(0, TAMANHO_MAXIMO);
}

function emTexto(argumento) {
  if (argumento instanceof Error) return argumento.stack?.split('\n').slice(0, 3).join(' | ') || argumento.message;
  if (typeof argumento === 'string') return argumento;
  try { return JSON.stringify(argumento); } catch { return String(argumento); }
}

function registrar(nivel, argumentos) {
  const texto = limpar(argumentos.map(emTexto).join(' '));
  if (!texto) return;

  // O mesmo erro repetido em seguida vira uma linha só, com contador.
  const ultimo = registros[registros.length - 1];
  if (ultimo && ultimo.texto === texto && ultimo.nivel === nivel) {
    ultimo.vezes += 1;
    ultimo.em = new Date();
    return;
  }
  registros.push({ nivel, texto, em: new Date(), vezes: 1 });
  if (registros.length > MAXIMO) registros.shift();
}

// Passa a copiar para a lista tudo o que for para console.error e console.warn.
function instalarRegistroDeErros() {
  if (instalado) return;
  instalado = true;
  for (const [metodo, nivel] of [['error', 'erro'], ['warn', 'aviso']]) {
    const original = console[metodo].bind(console);
    console[metodo] = (...argumentos) => {
      try { registrar(nivel, argumentos); } catch { /* registrar nunca pode derrubar o bot */ }
      original(...argumentos);
    };
  }

  // Parte do bot escreve erros e avisos pelo console.log, com a etiqueta ERRO ou
  // AVISO na linha: esses também entram.
  const logOriginal = console.log.bind(console);
  console.log = (...argumentos) => {
    try {
      const nivel = nivelDaLinha(argumentos);
      if (nivel) registrar(nivel, argumentos);
    } catch { /* registrar nunca pode derrubar o bot */ }
    logOriginal(...argumentos);
  };
}

// "erro", "aviso" ou null, conforme a etiqueta que a linha traz.
function nivelDaLinha(argumentos) {
  const inicio = limpar(argumentos.map(emTexto).join(' ')).slice(0, 80);
  if (/\bERRO\b/.test(inicio)) return 'erro';
  if (/\bAVISO\b/.test(inicio)) return 'aviso';
  return null;
}

// Mais recentes primeiro.
const ultimosRegistros = (limite = 100) => registros.slice(-limite).reverse().map(item => ({ ...item }));

module.exports = { instalarRegistroDeErros, ultimosRegistros, registrar, limpar };
