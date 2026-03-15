const mongoose = require('mongoose');

// URL do banco de dados secundário (ajuste conforme necessário)
const secondaryDbUri = process.env.SECONDARY_DB_URI;

// Cria conexão separada
const secondaryConnection = mongoose.createConnection(secondaryDbUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Exporta a conexão para uso nos modelos secundários
module.exports = secondaryConnection;
