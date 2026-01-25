// utils/logger.js
const { getBrasiliaDate, formatTimeBR } = require('./dateUtils');

function safeStringify(obj, maxLen = 800) {
  try {
    const str = JSON.stringify(obj, (key, value) => {
      // Evita circular
      if (typeof value === 'bigint') return value.toString();
      return value;
    });
    if (str.length > maxLen) return str.slice(0, maxLen) + '... [TRUNCADO]';
    return str;
  } catch {
    return '[Objeto não serializável]';
  }
}

function shortStack(err, lines = 4) {
  if (!err?.stack) return '';
  return err.stack.split('\n').slice(0, lines).join('\n');
}

function nowPrefix(tag) {
  return `[${formatTimeBR(getBrasiliaDate())}]${tag ? ` [${tag}]` : ''}`;
}

function buildMsg(prefix, message, extra) {
  let out = `${prefix} ${message}`;

  if (extra !== undefined && extra !== null) {
    if (extra instanceof Error) {
      out += ` | ${extra.name}: ${extra.message}`;
      const s = shortStack(extra, 4);
      if (s) out += `\n${s}`;
    } else if (typeof extra === 'object') {
      out += ` | ${safeStringify(extra)}`;
    } else {
      out += ` | ${String(extra)}`;
    }
  }

  return out;
}

class Logger {
  constructor({ tag = 'BOT', debug = false } = {}) {
    this.tag = tag;
    this.debugEnabled = debug;
  }

  info(message, extra) {
    console.log(buildMsg(nowPrefix(this.tag), message, extra));
  }

  warn(message, extra) {
    console.warn(buildMsg(nowPrefix(this.tag), message, extra));
  }

  error(message, extra) {
    console.error(buildMsg(nowPrefix(this.tag), message, extra));
  }

  debug(message, extra) {
    if (!this.debugEnabled) return;
    console.log(buildMsg(nowPrefix(`${this.tag}:DEBUG`), message, extra));
  }
}

module.exports = { Logger };
