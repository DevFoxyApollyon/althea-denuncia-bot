const { Schema } = require('mongoose');
const persistencia = require('../utils/persistencia');

const staffProfileSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    feedback: {
      count: { type: Number, default: 0 },
      soma: { type: Number, default: 0 }, 
      ultimaNota: { type: Number, default: null },
      ultimoEm: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

staffProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

staffProfileSchema.virtual('mediaFeedback').get(function () {
  return this.feedback.count ? this.feedback.soma / this.feedback.count : null;
});

staffProfileSchema.statics.registrarFeedback = function (guildId, userId, nota) {
  return this.updateOne(
    { guildId, userId },
    {
      $inc: { 'feedback.count': 1, 'feedback.soma': nota },
      $set: { 'feedback.ultimaNota': nota, 'feedback.ultimoEm': new Date() }
    },
    { upsert: true }
  );
};

module.exports = persistencia.model('StaffProfile', staffProfileSchema);