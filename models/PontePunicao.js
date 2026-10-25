const mongoose = require('mongoose');
const { modelSecundario } = require('../utils/persistencia');
const { STATUS_PUNICAO } = require('../services/ponteSamp/constantes');

// Um jogador a punir. Remover só marca "removido" (o histórico fica).
const alvoSchema = new mongoose.Schema({
  // Vazio quando a denúncia veio só com o nick: o jogo descobre o ID pelo /vercontanick.
  contaId: { type: String, default: '' },
  nick: { type: String, default: '' },
  cmd: { type: String, required: true },
  tempo: { type: Number, default: 0, min: 0, max: 99999 },
  // Avisos da punição (o /tempban já dá um; os demais vão por /agendaaviso).
  avisos: { type: Number, default: 0, min: 0, max: 10 },
  motivo: { type: String, default: '', maxlength: 60 },
  // Grupo da tabela de punições que definiu comando e tempo (vazio = sem regra, conferir).
  regra: { type: String, default: '', maxlength: 80 },
  removido: { type: Boolean, default: false },
  adicionadoNoJogo: { type: Boolean, default: false }
});

const resultadoSchema = new mongoose.Schema({
  alvoId: { type: mongoose.Schema.Types.ObjectId },
  comando: { type: String, default: '' },
  ok: { type: Boolean, default: false },
  // false: o comando foi aceito, mas o servidor não anunciou o ban no chat (conferir à mão).
  confirmado: { type: Boolean, default: true },
  erro: { type: String, default: '' },
  // Lidos do /vercontaid no momento da punição (histórico).
  nome: { type: String, default: '' },
  contaId: { type: String, default: '' },
  discord: { type: String, default: '' },
  resposta: { type: String, default: '' },
  organizacao: { type: String, default: '' },
  em: { type: Date, default: Date.now },
  pc: { type: String, default: '' },
  // Punição retirada depois (desbanir / tirar cadeia), por qual PC.
  retiradaEm: { type: Date, default: null },
  retiradaPor: { type: String, default: '' }
}, { _id: false });

// Punição de uma denúncia aceita, esperando o clique da staff no painel do jogo.
// Uma por denúncia: o primeiro aceite cria, o segundo só informa.
const pontePunicaoSchema = new mongoose.Schema({
  denunciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Denuncia', required: true, unique: true },
  guildId: { type: String, required: true },
  status: { type: String, enum: STATUS_PUNICAO, default: 'aceita' },
  origem: { type: String, enum: ['topico', 'canal_staff'], required: true },
  aceitoPor: { id: { type: String, default: '' }, nome: { type: String, default: '' } },
  aceitoEm: { type: Date, default: Date.now },
  // Quem aceitou no botão da Cadeia Staff (pode ser outra pessoa, se o tópico aceitou antes).
  cadeiaStaffPor: { id: { type: String, default: '' }, nome: { type: String, default: '' } },
  msgDiscord: {
    texto: { type: String, default: '' },
    link: { type: String, default: '' },
    acusado: { type: String, default: '' },
    motivo: { type: String, default: '' },
    provas: { type: String, default: '' }
  },
  mensagens: {
    topicoMsgId: { type: String, default: '' },
    canalMsgId: { type: String, default: '' },
    topicoId: { type: String, default: '' },
    canalId: { type: String, default: '' }
  },
  alvos: { type: [alvoSchema], default: [] },
  // Trava otimista: toda edição exige a versão que o painel leu.
  versao: { type: Number, default: 0 },
  executandoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'PonteInstalacao', default: null },
  // Quem está aplicando: vazio/pc = painel do jogo; gamemode = pedidos em pontepedidosgm.
  executor: { type: String, enum: ['', 'pc', 'gamemode'], default: '' },
  // Embed "🎮 Punição para o jogo" (modo gamemode), no Relatório de punições.
  mensagemGm: {
    canalId: { type: String, default: '' },
    msgId: { type: String, default: '' }
  },
  executandoDesde: { type: Date, default: null },
  aplicadaEm: { type: Date, default: null },
  aplicadaPor: {
    instalacaoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    nomePc: { type: String, default: '' }
  },
  resultado: { type: [resultadoSchema], default: [] },
  // Anotação interna da staff (não vai para o Discord): o que foi conferido, se é reincidente etc.
  nota: {
    texto: { type: String, default: '', maxlength: 300 },
    por: { type: String, default: '' },
    em: { type: Date, default: null }
  },
  criadoEm: { type: Date, default: Date.now }
});

pontePunicaoSchema.index({ guildId: 1, status: 1, criadoEm: -1 });

module.exports = modelSecundario('PontePunicao', pontePunicaoSchema, 'pontepunicoes');
