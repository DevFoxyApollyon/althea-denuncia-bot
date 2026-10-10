const mongoose = require('mongoose');

// Anotações da staff sobre um caso. Só aparecem no painel da staff do site:
// não vão para o tópico do Discord nem para o denunciante.
const notaInternaSchema = new mongoose.Schema({
  denunciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Denuncia', required: true, index: true },
  guildId: { type: String, required: true },
  autorId: { type: String, required: true },
  texto: { type: String, required: true, maxlength: 1000 },
  criadaEm: { type: Date, default: Date.now },
  // Some junto com a denúncia.
  expiraEm: { type: Date, default: null, index: { expires: 0 } }
});

module.exports = mongoose.model('NotaInterna', notaInternaSchema);
