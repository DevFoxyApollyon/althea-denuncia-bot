// Em qual banco cada modelo fica e por quanto tempo seus registros duram.
//
// Banco principal: tudo o que é do dia a dia das denúncias (denúncias,
// mensagens, ações da staff, strikes, chat, configurações).
// Banco secundário: o vínculo entre Discord e ID do jogo, as notificações do
// navegador e as sugestões.
const mongoose = require('mongoose');
const secondaryConnection = require('./secondaryDb');
const primaryConnection = require('./primaryDb');
const { aplicarRetencaoAoSchema, COLECOES_PERMANENTES, COLECOES_COM_REGRA_PROPRIA } = require('./retencaoDados');

function registrar(conexao, nome, schema, colecao, permanente) {
  if (conexao.models[nome]) return conexao.models[nome];

  // Mesmo nome que o mongoose dá à coleção quando ela não é informada.
  const nomeDaColecao = colecao || mongoose.pluralize()(nome);
  const regraPropria = COLECOES_COM_REGRA_PROPRIA.includes(nomeDaColecao);
  if (!permanente && !regraPropria) aplicarRetencaoAoSchema(schema, nomeDaColecao);

  const modelo = conexao.model(nome, schema, colecao);
  if (modelo.collection.name !== nomeDaColecao) {
    throw new Error(`Coleção "${modelo.collection.name}": nome diferente do previsto ("${nomeDaColecao}").`);
  }
  // A lista em retencaoDados.js é a que vale na hora de limpar o banco: um
  // modelo só é permanente de verdade se a coleção dele estiver lá.
  if (permanente !== COLECOES_PERMANENTES.includes(nomeDaColecao)) {
    throw new Error(`Coleção "${nomeDaColecao}": o modelo e a lista COLECOES_PERMANENTES discordam sobre ela ser permanente.`);
  }
  return modelo;
}

const model = (nome, schema, colecao) => registrar(primaryConnection, nome, schema, colecao, false);
const modelPermanente = (nome, schema, colecao) => registrar(primaryConnection, nome, schema, colecao, true);
const modelSecundario = (nome, schema, colecao) => registrar(secondaryConnection, nome, schema, colecao, false);
const modelSecundarioPermanente = (nome, schema, colecao) => registrar(secondaryConnection, nome, schema, colecao, true);

module.exports = { model, modelPermanente, modelSecundario, modelSecundarioPermanente, primaryConnection, secondaryConnection };
