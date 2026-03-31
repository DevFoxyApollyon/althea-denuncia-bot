const mongoose = require('mongoose');
const chalk = require('chalk');

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[SUCESSO]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[AVISO]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[ERRO]')} ${msg}`),
};

const secondaryDbUri = process.env.SECONDARY_DB_URI;

const secondaryConnection = mongoose.createConnection(secondaryDbUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS:          60000,
    connectTimeoutMS:         15000,
    maxPoolSize:              10,
    minPoolSize:              2,
    heartbeatFrequencyMS:     30000,
    retryWrites:              true,
    retryReads:               true,
});

secondaryConnection.on('connected', () => {
    log.success('Database secundária conectada.');
});

secondaryConnection.on('disconnected', () => {
    log.warn('Database secundária desconectada. Tentando reconectar...');
});

secondaryConnection.on('reconnected', () => {
    log.success('Database secundária reconectada.');
});

secondaryConnection.on('error', (err) => {
    log.error('Erro na database secundária: ' + err.message);
});

secondaryConnection.on('close', () => {
    log.warn('Conexão com database secundária encerrada.');
});

module.exports = secondaryConnection;