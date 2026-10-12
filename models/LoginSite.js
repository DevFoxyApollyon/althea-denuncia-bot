const mongoose = require('mongoose');
const { model } = require('../utils/persistencia');

// Cada entrada no site pela conta do Discord: quem, quando e de qual IP.
// Também é a lista de sessões da pessoa: cada login tem um identificador que
// vai dentro do cookie, e encerrar a sessão marca esse registro. Dura 30 dias.
const loginSiteSchema = new mongoose.Schema({
  usuarioId: { type: String, required: true },
  nome: { type: String, default: '' },
  ip: { type: String, default: '' },
  // Navegador e sistema, como o próprio navegador informa.
  agente: { type: String, default: '', maxlength: 300 },
  em: { type: Date, default: Date.now },
  // Identificador da sessão (o mesmo que está no cookie). Logins antigos não têm.
  sid: { type: String, default: null, index: true },
  // Última vez que a sessão foi usada (atualizado de tempos em tempos).
  vistaEm: { type: Date, default: null },
  // Preenchido quando a pessoa encerra a sessão por outro aparelho ou sai da conta.
  encerradaEm: { type: Date, default: null },
  // A conta nunca tinha entrado deste IP (só é marcado para quem já tinha outros logins).
  ipNovo: { type: Boolean, default: false }
});

loginSiteSchema.index({ em: -1 });
loginSiteSchema.index({ usuarioId: 1, em: -1 });

module.exports = model('LoginSite', loginSiteSchema);
