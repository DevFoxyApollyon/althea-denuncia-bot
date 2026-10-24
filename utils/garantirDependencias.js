// Reinstala as dependências quando a hospedagem manteve um discord.js antigo no
// node_modules. O upload de arquivos no modal de denúncia exige discord.js >= 14.23.
// Roda no começo do index.js, antes de qualquer require do discord.js.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const MINIMO = [14, 23, 0];

// Lido direto do disco: o "exports" do discord.js não expõe o package.json.
function versaoInstalada() {
  try {
    const caminho = path.join(RAIZ, 'node_modules', 'discord.js', 'package.json');
    return JSON.parse(fs.readFileSync(caminho, 'utf8')).version;
  } catch {
    return null;
  }
}

function atendeMinimo(versao) {
  if (!versao) return false;
  const partes = versao.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < MINIMO.length; i++) {
    if (partes[i] > MINIMO[i]) return true;
    if (partes[i] < MINIMO[i]) return false;
  }
  return true;
}

function garantirDependencias() {
  const atual = versaoInstalada();
  if (atendeMinimo(atual)) return;

  console.warn(`[DEPENDÊNCIAS] discord.js ${atual ?? 'ausente'} é antigo, rodando npm install...`);
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: RAIZ, stdio: 'inherit' });
    console.log(`[DEPENDÊNCIAS] discord.js agora em ${versaoInstalada()}.`);
  } catch (error) {
    console.error('[DEPENDÊNCIAS] Falha no npm install:', error.message);
  }
}

module.exports = { garantirDependencias, atendeMinimo };
