const mongoose = require('mongoose');
const { globalCache } = require('../utils/smartCache');
const { modelPermanente } = require('../utils/persistencia');

const configSchema = new mongoose.Schema({
  guildId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  channels: {
    pc: { type: String, required: false, default: '' },
    mobile: { type: String, required: false, default: '' },
    logs: { type: String, required: false, default: '' }, 
    log: { type: String, required: false, default: '' }, 
    backup: { type: String, required: false, default: '' },
    armazem: { type: String, required: false, default: '' },
    registro: { type: String, required: false, default: '' },
    cloud: { type: String, required: false, default: '' },
    canalDenuncia: { type: String, required: false, default: '' },
    analysis: { type: String, required: false, default: '' },
    topDaily: { type: String, required: false, default: '' },
    // Histórico das punições aplicadas pelo painel do jogo (vazio: usa o Log Admin).
    relatorioPunicoes: { type: String, required: false, default: '' },
    // Canal fixo do /provastaff (provas da staff).
    provasStaff: { type: String, required: false, default: '' }
  },
  manutencaoDenuncia: { type: Boolean, default: false },
  bloquearReivindicacaoComPendentes: { type: Boolean, default: true },
  // Site só para consulta: ninguém (fora o responsável) envia ou altera nada por ele.
  siteSomenteLeitura: { type: Boolean, default: false },
  // Marca o responsável no tópico quando o motivo é crítico (zaralho, dark RP, hack, mods proibidos).
  alertaMotivoCritico: { type: Boolean, default: true },
  // Espera de 1 minuto entre uma denúncia e outra da mesma pessoa.
  esperaEntreDenuncias: { type: Boolean, default: true },
  // Quantos minutos dura a espera entre denúncias (1 a 60).
  minutosEntreDenuncias: { type: Number, default: 1, min: 1, max: 60 },
  // Aviso no tópico, no Log Admin e por DM quando a denúncia reivindicada fica parada.
  avisoReivindicacao: { type: Boolean, default: true },
  // Depois de quantos minutos reivindicada o aviso sai (5 a 120).
  minutosAvisoReivindicacao: { type: Number, default: 15, min: 5, max: 120 },
  // Tópico das denúncias arquiva depois deste tempo sem mensagem (valores do Discord).
  minutosArquivarTopico: { type: Number, default: 1440, enum: [60, 1440, 4320, 10080] },
  // Espera de 1 minuto entre uma reivindicação e outra da staff. Sem valor, vale o
  // que estava no .env (CLAIM_COOLDOWN_GUILD_IDS); ver utils/esperas.js.
  esperaEntreReivindicacoes: { type: Boolean, default: undefined },
  // Denúncia com todos os acusados identificados abre em tópico privado. Desligado,
  // abre em tópico público (só as partes e a staff falam nele, como antes).
  topicosPrivados: { type: Boolean, default: true },
  // Aceitar e Recusar da Cadeia Staff pedem a senha pessoal da staff (30 min liberado).
  senhaCadeiaStaff: { type: Boolean, default: false },
  // Mensagem do painel do /provastaff (sai e volta no fim do canal a cada registro).
  provasStaffPainelMsgId: { type: String, default: '' },
  // /provastaff só registra motivo que está na tabela de motivos.
  provasExigirMotivo: { type: Boolean, default: true },
  // Quantos minutos dura a espera para reivindicar (1 a 60).
  minutosEntreReivindicacoes: { type: Number, default: 1, min: 1, max: 60 },
  // Denúncia reivindicada e parada vai sozinha para análise depois deste tempo.
  analiseAutomatica: { type: Boolean, default: true },
  // Quantos minutos depois de reivindicar (5 a 240).
  minutosAnaliseAutomatica: { type: Number, default: 30, min: 5, max: 240 },
  roles: {
    permitido: { type: String, required: false, default: '' },
    pc: { type: String, required: false, default: '' },
    administrador: { type: String, required: false, default: '' },
    responsavel_admin: { type: String, required: false, default: '' },
    // Fundador: com o cargo escolhido, só ele entra no Painel do bot (site e /painel)
    // e nas Configurações do site. Sem cargo escolhido, vale o responsável, como antes.
    fundador: { type: String, required: false, default: '' }
  },
  
  lastUpdated: { 
    type: Date,  
    default: Date.now 
  },
  updatedBy: { 
    type: String, 
    required: false,
    default: 'Sistema'
  }
});

configSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();
  next();
});

// Mantém o cache de utils/configCache.js coerente com o banco.
function invalidarCache(guildId) {
  if (guildId) globalCache.delete(`config:${guildId}`);
}

configSchema.post('save', function(doc) {
  invalidarCache(doc?.guildId);
});

configSchema.post(['findOneAndUpdate', 'updateOne', 'deleteOne', 'findOneAndDelete'], function() {
  invalidarCache(this.getQuery?.()?.guildId);
});

module.exports = modelPermanente('Config', configSchema);