const mongoose = require('mongoose');
const { log } = require('./logger');

const primaryDbUri = process.env.MONGODB_URI;

if (!primaryDbUri) {
    throw new Error('MONGODB_URI não definida nas variáveis de ambiente.');
}

const primaryConnection = mongoose.createConnection(primaryDbUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS:          60000,
    connectTimeoutMS:         15000,
    maxPoolSize:              10,
    minPoolSize:              2,
    heartbeatFrequencyMS:     30000,
    retryWrites:              true,
    retryReads:               true,
});

primaryConnection.asPromise().catch((err) => {
    log.error('Erro Database principal: ' + err.message);
});

primaryConnection.on('connected',    () => log.success('Database principal conectada.'));
primaryConnection.on('reconnected',  () => log.success('Database principal reconectada.'));
primaryConnection.on('disconnected', () => log.warn('Database principal desconectada. Tentando reconectar...'));
primaryConnection.on('close',        () => log.warn('Conexão com database principal encerrada.'));
primaryConnection.on('error',        (err) => log.error('Erro na database principal: ' + err.message));

module.exports = primaryConnection;
