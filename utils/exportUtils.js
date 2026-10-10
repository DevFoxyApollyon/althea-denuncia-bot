const archiver = require('archiver');
const { PassThrough } = require('stream');

// Funções usadas tanto pela exportação manual (botão "Finalizar") quanto pela
// automática (jobs/autoFinalizador.js). Antes existia uma cópia em cada arquivo.

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeFileName(name = '') {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function getHighestRole(member) {
  if (!member) return { name: '', color: '#99aab5' };
  const highestRole = member.roles.cache
    .filter(role => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .first();

  return {
    name: highestRole ? highestRole.name : '',
    color: highestRole && highestRole.color !== 0
      ? '#' + highestRole.color.toString(16).padStart(6, '0')
      : '#99aab5'
  };
}

// "nivel" é a compressão do ZIP (1 a 9). Arquivos sem conteúdo são ignorados.
function buildZipBuffer(files, { nivel = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: nivel } });
    const stream = new PassThrough();
    const chunks = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    archive.on('warning', (err) => console.warn('[ZIP WARNING]', err?.message || err));
    archive.on('error', reject);
    archive.pipe(stream);

    for (const file of files) {
      if (file.content) archive.append(file.content, { name: file.name });
    }

    archive.finalize();
  });
}

module.exports = { escapeHtml, safeFileName, getHighestRole, buildZipBuffer };
