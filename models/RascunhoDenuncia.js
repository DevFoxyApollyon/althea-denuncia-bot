const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Denúncia que a pessoa começou a escrever e ainda não enviou. Fica guardada
// na conta dela, para continuar em outro aparelho. Um por pessoa e servidor;
// é apagado ao enviar a denúncia e some sozinho depois de 15 dias parado.
const rascunhoDenunciaSchema = new mongoose.Schema({
  usuarioId: { type: String, required: true },
  guildId: { type: String, required: true },
  platform: { type: String, default: '', maxlength: 10 },
  acusado: { type: String, default: '', maxlength: 100 },
  categoria: { type: String, default: '', maxlength: 40 },
  detalhes: { type: String, default: '', maxlength: 75 },
  provas: { type: String, default: '', maxlength: 1000 },
  atualizadoEm: { type: Date, default: Date.now }
});

rascunhoDenunciaSchema.index({ usuarioId: 1, guildId: 1 }, { unique: true });

module.exports = model('RascunhoDenuncia', rascunhoDenunciaSchema);
