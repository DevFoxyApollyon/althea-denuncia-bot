const secondaryConnection = require('./secondaryDb');
const primaryConnection = require('./primaryDb');
const { aplicarRetencaoAoSchema } = require('./retencaoDados');

function model(nome, schema, colecao) {
  aplicarRetencaoAoSchema(schema);
  return secondaryConnection.models[nome] || secondaryConnection.model(nome, schema, colecao);
}

function modelPrincipal(nome, schema, colecao) {
  aplicarRetencaoAoSchema(schema);
  return primaryConnection.models[nome] || primaryConnection.model(nome, schema, colecao);
}

module.exports = { model, modelPrincipal, primaryConnection, secondaryConnection };
