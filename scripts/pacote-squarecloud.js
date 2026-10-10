// Monta o zip para enviar à SquareCloud:  npm run pacote
//
// O zip leva o projeto sem node_modules (a hospedagem instala sozinha) e com um
// .env próprio da hospedagem: igual ao seu, mas com o endereço público do site
// e sem a porta local. O .env da sua máquina não é alterado.
//
// O arquivo gerado contém os segredos do .env: não compartilhe nem suba no git.
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'althea-squarecloud.zip');
const FORA_DO_ZIP = ['node_modules/**', '.git/**', '.env', '.env.*', '*.zip', '.bash*', 'test/**'];

function lerConfig() {
  const texto = fs.readFileSync(path.join(RAIZ, 'squarecloud.app'), 'utf8');
  return Object.fromEntries(texto.split(/\r?\n/).filter(linha => linha.includes('=')).map(linha => {
    const [chave, ...resto] = linha.split('=');
    return [chave.trim(), resto.join('=').trim()];
  }));
}

// Troca o endereço do site pelo da hospedagem e tira a porta local: na
// SquareCloud o site precisa escutar na porta 80, que já é o padrão do código.
function envDaHospedagem(siteUrl) {
  const linhas = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)
    .filter(linha => !/^\s*SITE_PORT\s*=/.test(linha))
    .map(linha => (/^\s*SITE_URL\s*=/.test(linha) ? `SITE_URL=${siteUrl}` : linha));
  if (!linhas.some(linha => linha.startsWith('SITE_URL='))) linhas.push(`SITE_URL=${siteUrl}`);
  return linhas.join('\n');
}

async function montar() {
  const { SUBDOMAIN: subdominio } = lerConfig();
  if (!subdominio) throw new Error('Defina SUBDOMAIN no arquivo squarecloud.app.');
  const siteUrl = `https://${subdominio}.squareweb.app`;

  const zip = archiver('zip', { zlib: { level: 9 } });
  const pronto = new Promise((resolve, reject) => {
    const arquivo = fs.createWriteStream(SAIDA);
    arquivo.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(arquivo);
  });

  zip.glob('**/*', { cwd: RAIZ, dot: true, ignore: FORA_DO_ZIP });
  zip.append(envDaHospedagem(siteUrl), { name: '.env' });
  await zip.finalize();
  await pronto;

  console.log(`Zip pronto: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Endereço do site: ${siteUrl}`);
  console.log(`Cadastre no Discord (OAuth2 > Redirects): ${siteUrl}/auth/retorno`);
}

montar().catch((erro) => {
  console.error(`Não foi possível montar o zip: ${erro.message}`);
  process.exit(1);
});
