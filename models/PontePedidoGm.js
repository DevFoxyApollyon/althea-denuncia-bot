const mongoose = require('mongoose');
const { modelSecundario } = require('../utils/persistencia');
const { TIPOS_GM, STATUS_PEDIDO_GM } = require('../services/ponteSamp/constantes');

const pessoaSchema = new mongoose.Schema({
  id: { type: String, default: '' },
  nome: { type: String, default: '' },
  em: { type: Date, default: Date.now }
}, { _id: false });

// Pedido enviado à gamemode: um por alvo da punição, em cada rodada.
// "Reenviar" (incerto não aplicado) cria outro pedido com rodada + 1.
const pontePedidoGmSchema = new mongoose.Schema({
  punicaoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PontePunicao', required: true },
  alvoId: { type: mongoose.Schema.Types.ObjectId, required: true },
  rodada: { type: Number, default: 1, min: 1 },
  denunciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Denuncia', default: null },
  guildId: { type: String, required: true },
  // Conexão que recebeu o pedido (preenchida na entrega).
  conexaoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PonteConexaoGm', default: null },
  // Campos que vão para a gamemode, já no formato do protocolo.
  tipo: { type: String, enum: TIPOS_GM, required: true },
  conta: { type: Number, default: 0, min: 0, max: 999999999 },
  nick: { type: String, default: '' },
  tempo: { type: Number, default: 0, min: 0 },
  avisos: { type: Number, default: 0, min: 0 },
  somar: { type: Boolean, default: false },
  motivo: { type: String, required: true, maxlength: 60 },
  aprovadoPor: { type: String, required: true, maxlength: 24 },
  teste: { type: Boolean, default: true },
  confirmadoPor: { type: [pessoaSchema], default: [] },
  status: { type: String, enum: STATUS_PEDIDO_GM, default: 'aprovado' },
  codigo: { type: String, default: '' },
  // Unix (s) do momento da entrega; entra no selo.
  emitidoEm: { type: Number, default: 0 },
  entregueEm: { type: Date, default: null },
  // Entregue sem resposta depois disso vira "incerto".
  leaseAte: { type: Date, default: null },
  entregas: { type: Number, default: 0 },
  devolucoes: { type: Number, default: 0 },
  resultado: {
    nome: { type: String, default: '' },
    organizacao: { type: String, default: '' },
    conta: { type: Number, default: 0 }
  },
  // Aviso do incerto no Log Admin (um por pedido), com os botões de resolver.
  alertaIncertoEm: { type: Date, default: null },
  mensagemIncerto: {
    canalId: { type: String, default: '' },
    msgId: { type: String, default: '' }
  },
  // Quem resolveu um incerto pelos botões do Log Admin.
  resolvidoPor: {
    id: { type: String, default: '' },
    nome: { type: String, default: '' },
    em: { type: Date, default: null }
  },
  criadoEm: { type: Date, default: Date.now }
});

pontePedidoGmSchema.index({ punicaoId: 1, alvoId: 1, rodada: 1 }, { unique: true });
pontePedidoGmSchema.index({ guildId: 1, status: 1, criadoEm: 1 });
pontePedidoGmSchema.index({ status: 1, leaseAte: 1 });

module.exports = modelSecundario('PontePedidoGm', pontePedidoGmSchema, 'pontepedidosgm');
