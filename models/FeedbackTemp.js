const secondaryConnection = require('../utils/secondaryDb');

const { Schema } = require('mongoose');

const feedbackTempSchema = new Schema({
    denunciaId: {
        type: String,
        required: true,
        unique: true
    },
    messageId: {
        type: String,
        required: true
    },
    channelId: {
        type: String,
        required: true
    },
    criadoEm: {
        type: Date,
        default: Date.now,
        expires: 86400
    }
});

module.exports = secondaryConnection.model('FeedbackTemp', feedbackTempSchema); 