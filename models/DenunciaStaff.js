const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Denúncia da staff (/provastaff): a staff registra a punição com as provas no canal
// fixo; o responsável aceita (vai para a Cadeia Staff e, de lá, para o jogo) ou recusa.
// Fica no banco principal; dura o prazo padrão (utils/retencaoDados.js).
const denunciaStaffSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  autor: { id: { type: String, default: '' }, nome: { type: String, default: '' } },
  contas: { type: [String], default: [] },
  motivo: { type: String, default: '' },
  punicao: { type: String, default: '' },
  provas: { type: String, default: '' },
  arquivos: { type: Number, default: 0 },
  // Mensagem do registro no canal fixo e o tópico das provas.
  channelId: { type: String, default: '' },
  messageId: { type: String, default: '', index: true },
  threadId: { type: String, default: '', index: true },
  status: { type: String, enum: ['pendente', 'aceita', 'recusada'], default: 'pendente' },
  decididoPor: { id: { type: String, default: '' }, nome: { type: String, default: '' }, em: { type: Date, default: null } },
  // O que o responsável confirmou no aceite (vai para a Cadeia Staff e para o jogo).
  acusadoAceite: { type: String, default: '' },
  motivoAceite: { type: String, default: '' },
  cadeia: {
    canalId: { type: String, default: '' },
    msgId: { type: String, default: '', index: true },
    status: { type: String, enum: ['', 'aceita', 'recusada'], default: '' }
  },
  criadoEm: { type: Date, default: Date.now }
});

denunciaStaffSchema.index({ guildId: 1, criadoEm: -1 });

module.exports = model('DenunciaStaff', denunciaStaffSchema, 'denunciastaffs');
