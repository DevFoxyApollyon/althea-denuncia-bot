const mongoose = require('mongoose');

// Par de chaves (VAPID) que identifica o site para os serviços de notificação
// dos navegadores. É criado sozinho na primeira vez e fica no banco, para
// continuar o mesmo quando o bot reinicia ou troca de máquina.
const chavePushSchema = new mongoose.Schema({
  _id: { type: String, default: 'vapid' },
  publica: { type: String, required: true },
  privada: { type: String, required: true }
});

module.exports = mongoose.model('ChavePush', chavePushSchema);
