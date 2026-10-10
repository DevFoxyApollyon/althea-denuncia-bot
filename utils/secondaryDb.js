const mongoose = require('mongoose');
const { log } = require('./logger');

const secondaryDbUri = process.env.SECONDARY_DB_URI;

// A presença da variável é conferida em utils/env.js antes de o bot subir;
// aqui o erro só aparece se este módulo for carregado por um script avulso.
if (!secondaryDbUri) {
    throw new Error('SECONDARY_DB_URI não definida nas variáveis de ambiente.');
}

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

secondaryConnection.asPromise().catch((err) => {
    log.error('Erro Database: ' + err.message);
});

secondaryConnection.on('connected',    () => log.success('Database secundária conectada.'));
secondaryConnection.on('reconnected',  () => log.success('Database secundária reconectada.'));
secondaryConnection.on('disconnected', () => log.warn('Database secundária desconectada. Tentando reconectar...'));
secondaryConnection.on('close',        () => log.warn('Conexão com database secundária encerrada.'));
secondaryConnection.on('error',        (err) => log.error('Erro na database secundária: ' + err.message));

module.exports = secondaryConnection;
