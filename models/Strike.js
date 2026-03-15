const mongoose = require('mongoose');

const StrikeSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },
  strikes: [
    {
      timestamp: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

// Remove strikes com mais de 24h automaticamente ao buscar
StrikeSchema.methods.cleanOldStrikes = function() {
  const now = Date.now();
  this.strikes = this.strikes.filter(s => (now - s.timestamp.getTime()) < 24 * 60 * 60 * 1000);
};

module.exports = mongoose.model('Strike', StrikeSchema);