const mongoose = require('mongoose');

const StrikeSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },

  strikes: [
    {
      timestamp: { type: Date, default: Date.now }
    }
  ],

  strikesLink: [
    {
      timestamp: { type: Date, default: Date.now }
    }
  ],

  strikesEmoji: [
    {
      timestamp: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

StrikeSchema.methods.cleanOldStrikes = function() {
  const now = Date.now();
  this.strikes = this.strikes.filter(s => (now - s.timestamp.getTime()) < 24 * 60 * 60 * 1000);
};

StrikeSchema.methods.cleanOldStrikesLink = function() {
  const now = Date.now();
  this.strikesLink = this.strikesLink.filter(s => (now - s.timestamp.getTime()) < 24 * 60 * 60 * 1000);
};

StrikeSchema.methods.cleanOldStrikesEmoji = function() {
  const now = Date.now();
  this.strikesEmoji = this.strikesEmoji.filter(s => (now - s.timestamp.getTime()) < 24 * 60 * 60 * 1000);
};

// Registro sem strike novo há 24 horas é apagado pelo próprio MongoDB.
// (Os strikes antigos de quem continua ativo saem pelos métodos cleanOld* acima.)
StrikeSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('Strike', StrikeSchema);