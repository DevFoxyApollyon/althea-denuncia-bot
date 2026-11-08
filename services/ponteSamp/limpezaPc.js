// O PC da staff (mod Lua) saiu da ponte: só a gamemode aplica as punições.
// Ao iniciar, apaga o que era só do PC e passa o que ficou no meio do caminho
// para a gamemode. Pode rodar quantas vezes for: sem nada do PC, não muda nada.
const { secondaryConnection } = require('../../utils/persistencia');
const PonteServidor = require('../../models/PonteServidor');
const PontePunicao = require('../../models/PontePunicao');
const PonteUso = require('../../models/PonteUso');
const PonteCodigo = require('../../models/PonteCodigo');
const PontePedidoGm = require('../../models/PontePedidoGm');
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'Ponte' });

// Ações da auditoria que só o PC fazia.
const ACOES_DO_PC = ['fila', 'executar', 'aplicar', 'cancelar', 'auth_falhou', 'hwid_diferente', 'guild_inativa',
  'ping', 'retirar', 'remover', 'limpar', 'nota', 'relatorio'];

async function limparDadosDoPc(client = null) {
  const feito = {};

  // PCs cadastrados (hash dos tokens): a coleção inteira sai.
  const colecoes = await secondaryConnection.db?.listCollections({ name: 'ponteinstalacoes' }, { nameOnly: true }).toArray().catch(() => []) || [];
  if (colecoes.length) {
    await secondaryConnection.db.dropCollection('ponteinstalacoes');
    feito.instalacoes = true;
  }

  // Auditoria do PC (e qualquer registro ligado a um PC).
  const uso = await PonteUso.collection.deleteMany({ $or: [{ acao: { $in: ACOES_DO_PC } }, { instalacaoId: { $ne: null, $exists: true } }] });
  if (uso.deletedCount) feito.registros = uso.deletedCount;

  // Campos que só o PC usava.
  const servidores = await PonteServidor.collection.updateMany(
    { $or: [{ executor: { $exists: true } }, { limitePcs: { $exists: true } }, { templates: { $exists: true } }] },
    { $unset: { executor: '', limitePcs: '', templates: '' } }
  );
  if (servidores.modifiedCount) feito.servidores = servidores.modifiedCount;
  await PonteCodigo.collection.updateMany({ limitePcs: { $exists: true } }, { $unset: { limitePcs: '' } });

  // Punição que o PC estava aplicando volta a esperar envio (agora pela gamemode). A que já
  // tem pedido com a gamemode fica como está, para não mandar duas vezes.
  const candidatas = await PontePunicao.collection.find({ status: 'executando', executor: { $in: ['', 'pc', null] } }, { projection: { _id: 1 } }).toArray();
  const comGamemode = new Set((await PontePedidoGm.distinct('punicaoId', {
    punicaoId: { $in: candidatas.map(p => p._id) }, status: { $in: ['aprovado', 'entregue', 'incerto'] }
  })).map(String));
  const presas = await PontePunicao.collection.updateMany(
    { _id: { $in: candidatas.map(p => p._id).filter(id => !comGamemode.has(String(id))) }, status: 'executando' },
    { $set: { status: 'aceita', executor: '', executandoDesde: null }, $unset: { executandoPor: '' }, $inc: { versao: 1 } }
  );
  if (presas.modifiedCount) feito.devolvidas = presas.modifiedCount;
  await PontePunicao.collection.updateMany({ executor: 'pc' }, { $set: { executor: '' } });
  await PontePunicao.collection.updateMany({ executandoPor: { $exists: true } }, { $unset: { executandoPor: '' } });

  // Punições dos últimos 30 dias esperando envio sem o embed "Enviar ao jogo" (eram da fila
  // do PC): ganham o embed no Relatório de punições.
  if (client) {
    const { postarPunicaoGm } = require('./discordGm');
    const ativos = await PonteServidor.find({ ativo: true }).lean();
    let embeds = 0;
    for (const servidor of ativos) {
      const semEmbed = await PontePunicao.find({ guildId: servidor.guildId, status: 'aceita', 'mensagemGm.msgId': { $in: ['', null] }, criadoEm: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }).sort({ criadoEm: 1 }).limit(100).lean();
      for (const punicao of semEmbed) {
        if (await postarPunicaoGm(client, punicao, servidor).catch(() => null)) embeds++;
      }
    }
    if (embeds) feito.embeds = embeds;
  }

  if (Object.keys(feito).length) log.info(`Dados do PC da staff removidos: ${JSON.stringify(feito)}`);
  return feito;
}

module.exports = { limparDadosDoPc, ACOES_DO_PC };
