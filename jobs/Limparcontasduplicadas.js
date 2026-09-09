require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const chalk = require('chalk');
const Usuario = require('../models/Usuario');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const APAGAR = process.argv.includes('--apagar');
let executando = false;

const log = {
  info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[CONTAS DUPLICADAS]')} ${msg}`),
  success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[CONTAS DUPLICADAS]')} ${msg}`),
  warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[CONTAS DUPLICADAS]')} ${msg}`),
  error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[CONTAS DUPLICADAS]')} ${msg}`),
};

async function limparContasDuplicadas({ apagar = true, detalhar = false } = {}) {
  const duplicados = await Usuario.aggregate([
    {
      $group: {
        _id: { guildId: '$guildId', conta: '$conta' },
        total: { $sum: 1 },
        docs: { $push: { _id: '$_id', userId: '$userId', username: '$username', updatedAt: '$updatedAt' } },
      },
    },
    { $match: { total: { $gt: 1 }, '_id.conta': { $ne: null } } },
  ]);

  if (duplicados.length === 0) {
    log.info('Nenhuma conta duplicada encontrada.');
    return 0;
  }

  let totalParaApagar = 0;

  for (const grupo of duplicados) {
    const docsOrdenados = grupo.docs.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const manter = docsOrdenados[0];
    const apagarDocs = docsOrdenados.slice(1);
    totalParaApagar += apagarDocs.length;

    if (detalhar) {
      log.info(`Guild ${grupo._id.guildId} | Conta ${grupo._id.conta}`);
      log.success(`Manter: userId=${manter.userId} username=${manter.username} updatedAt=${manter.updatedAt}`);
      for (const doc of apagarDocs) {
        log.warn(`Apagar: userId=${doc.userId} username=${doc.username} updatedAt=${doc.updatedAt}`);
      }
    }

    if (apagar && apagarDocs.length > 0) {
      await Usuario.deleteMany({ _id: { $in: apagarDocs.map(doc => doc._id) } });
    }
  }

  log.success(`${apagar ? 'Apagados' : 'Encontrados'}: ${totalParaApagar} registro(s).`);
  return totalParaApagar;
}

function iniciarLimpezaContasDuplicadas() {
  cron.schedule('0 0 * * *', async () => {
    if (executando) {
      log.warn('A execução anterior ainda está em andamento.');
      return;
    }

    executando = true;
    try {
      await limparContasDuplicadas({ apagar: true, detalhar: true });
    } catch (err) {
      log.error(`Erro na limpeza: ${err.message}`);
    } finally {
      executando = false;
    }
  }, { timezone: 'America/Sao_Paulo' });

  log.info('Limpeza automática agendada para 00:00 (Brasília).');
}

async function main() {
  if (!MONGO_URI) {
    log.error('Defina MONGODB_URI (ou MONGO_URI) no .env antes de rodar este script.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  log.success('Conectado ao MongoDB.');

  await limparContasDuplicadas({ apagar: APAGAR, detalhar: true });
  if (!APAGAR) log.info('Modo de simulação (nada foi apagado).');

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    log.error(`Erro ao rodar o script: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { limparContasDuplicadas, iniciarLimpezaContasDuplicadas };