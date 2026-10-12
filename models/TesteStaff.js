const mongoose = require('mongoose');
const { modelPermanente } = require('../utils/persistencia');

// Testes que o responsável monta para a staff de um servidor. Cada servidor
// pode ter vários, cada um com título próprio, respondido e corrigido em separado.
const testeStaffSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  titulo: { type: String, default: 'Teste da staff', maxlength: 80 },
  instrucoes: { type: String, default: '', maxlength: 600 },
  // Vídeo de abertura do teste. Identificador do YouTube (o link completo nunca é guardado).
  video: { type: String, default: '' },
  // Porcentagem mínima de acertos para ser aprovado.
  notaMinima: { type: Number, default: 70 },
  // Só os publicados aparecem para a staff; rascunho fica só com o responsável.
  ativo: { type: Boolean, default: true },
  // Obrigatório: sem aprovação em dia neste teste, a staff não reivindica denúncias.
  obrigatorio: { type: Boolean, default: false },
  // Por quantos dias a aprovação vale. 0 = não vence.
  validadeDias: { type: Number, default: 0, min: 0, max: 730 },
  perguntas: [{
    _id: false,
    id: { type: String, required: true },
    texto: { type: String, required: true, maxlength: 300 },
    // Vídeo próprio da pergunta (opcional), para ela ser respondida olhando a cena.
    video: { type: String, default: '' },
    opcoes: { type: [String], default: [] },
    // Posição da alternativa certa em "opcoes".
    correta: { type: Number, required: true }
  }],
  atualizadoPor: { type: String, default: null },
  atualizadoEm: { type: Date, default: Date.now },
  criadoEm: { type: Date, default: Date.now }
});

const TesteStaff = modelPermanente('TesteStaff', testeStaffSchema);

// Antes era um teste só por servidor, com um índice único no banco que impede
// criar o segundo. Ele é removido uma vez; se já não existe, nada acontece.
let indiceAntigoRemovido = null;
TesteStaff.removerIndiceAntigo = () => {
  indiceAntigoRemovido ||= TesteStaff.collection.indexes()
    .then(async (indices) => {
      if (!indices.some(indice => indice.name === 'guildId_1' && indice.unique)) return;
      await TesteStaff.collection.dropIndex('guildId_1');
      await TesteStaff.collection.createIndex({ guildId: 1 });
    })
    // Coleção ainda não criada, ou banco fora do ar: tenta de novo na próxima vez.
    .catch(() => { indiceAntigoRemovido = null; });
  return indiceAntigoRemovido;
};

module.exports = TesteStaff;
