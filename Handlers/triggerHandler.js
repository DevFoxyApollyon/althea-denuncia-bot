const GATILHOS = [
  {
    gatilho: '<:brp2_emoji_56:835893933095256105>',
    resposta: '<:brp2_emoji_56:835893933095256105>',
    tipo: 'emoji'
  },
  {
    gatilho: '<:6543internetge:1324879657392406571>',
    resposta: '<:brp2_emoji_56:835893933095256105>',
    tipo: 'emoji'
  },
  {
    gatilho: 'fafaf2111', 
    resposta: 'Para obter ajuda, abra um ticket em <#ID_DO_CANAL>.',
    tipo: 'texto'
  },
  {
    gatilho: '817925285563203594', // Substitua pelo ID do cargo
    resposta: '<:brp2_emoji_56:835893933095256105>',
    tipo: 'cargo'
  },
  {
    gatilho: '657014871228940336', // Substitua pelo ID da pessoa
    resposta: '<:brp2_emoji_56:835893933095256105>',
    tipo: 'usuario'
  }
];

const CANAL_ESPECIFICO_ID = '1453400696769482905';

async function handleMessageTriggers(message) {
  if (message.author.bot || message.channel.id !== CANAL_ESPECIFICO_ID) return;

  const conteudo = message.content.toLowerCase();

  const triggerEncontrado = GATILHOS.find(t => {
    if (t.tipo === 'emoji') {
      return message.content.includes(t.gatilho);
    } else if (t.tipo === 'cargo') {
      return message.mentions.roles.has(t.gatilho);
    } else if (t.tipo === 'usuario') {
      return message.mentions.users.has(t.gatilho);
    } else {
      return conteudo.includes(t.gatilho.toLowerCase());
    }
  });

  if (triggerEncontrado) {
    try {
      await message.reply(triggerEncontrado.resposta);
    } catch (error) {
      console.error('Erro ao responder gatilho:', error);
    }
  }
}

module.exports = { handleMessageTriggers };