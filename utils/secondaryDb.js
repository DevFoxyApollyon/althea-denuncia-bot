const mongoose = require('mongoose');

const secondaryDbUri = process.env.SECONDARY_DB_URI;

const secondaryConnection = mongoose.createConnection(secondaryDbUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2,
    heartbeatFrequencyMS: 10000,
});

secondaryConnection.on('connected', () => {
    console.log('✅ [DB Secundário] Conectado com sucesso.');
});
secondaryConnection.on('disconnected', () => {
    console.warn('⚠️ [DB Secundário] Desconectado. Tentando reconectar...');
});
secondaryConnection.on('reconnected', () => {
    console.log('🔄 [DB Secundário] Reconectado com sucesso.');
});
secondaryConnection.on('error', (err) => {
    console.error('❌ [DB Secundário] Erro na conexão:', err.message);
});

module.exports = secondaryConnection;