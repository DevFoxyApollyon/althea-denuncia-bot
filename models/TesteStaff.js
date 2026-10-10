const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Teste que o responsável monta para a staff de um servidor: um vídeo e
// perguntas de múltipla escolha. Um por servidor.
const testeStaffSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  titulo: { type: String, default: 'Teste da staff', maxlength: 80 },
  instrucoes: { type: String, default: '', maxlength: 600 },
  // Identificador do vídeo no YouTube (o link completo nunca é guardado).
  video: { type: String, default: '' },
  // Porcentagem mínima de acertos para ser aprovado.
  notaMinima: { type: Number, default: 70 },
  perguntas: [{
    _id: false,
    id: { type: String, required: true },
    texto: { type: String, required: true, maxlength: 300 },
    opcoes: { type: [String], default: [] },
    // Posição da alternativa certa em "opcoes".
    correta: { type: Number, required: true }
  }],
  atualizadoPor: { type: String, default: null },
  atualizadoEm: { type: Date, default: Date.now }
});

module.exports = modelPermanente('TesteStaff', testeStaffSchema);
