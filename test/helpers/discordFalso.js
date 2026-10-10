// Um Discord de mentira, só com o que os fluxos de denúncia usam. Serve para
// exercitar o site e os handlers reais sem falar com a API do Discord.
const { Collection } = require('discord.js');

let proximoId = 9000000000000000n;
const novoId = () => String(proximoId++);

function criarUsuario(id, username) {
  return {
    id,
    username,
    tag: username,
    globalName: username,
    bot: false,
    dms: [],
    displayAvatarURL: () => null,
    toString: () => `<@${id}>`,
    async send(payload) {
      this.dms.push(payload);
      return { id: novoId() };
    }
  };
}

function criarMensagem(canal, autor, payload) {
  const dados = typeof payload === 'string' ? { content: payload } : payload || {};
  const anexos = new Collection();
  for (const arquivo of dados.files || []) {
    const id = novoId();
    const nome = arquivo.name || 'arquivo';
    anexos.set(id, {
      id,
      name: nome,
      size: arquivo.attachment?.length ?? 0,
      contentType: nome.endsWith('.png') ? 'image/png' : 'application/octet-stream',
      url: `https://cdn.discordapp.com/attachments/${canal.id}/${id}/${nome}?ex=novo`
    });
  }

  const mensagem = {
    id: novoId(),
    channel: canal,
    channelId: canal.id,
    guild: canal.guild,
    author: autor,
    content: dados.content || '',
    embeds: dados.embeds || [],
    components: dados.components || [],
    attachments: anexos,
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    apagada: false,
    get url() {
      return `https://discord.com/channels/${canal.guild.id}/${canal.id}/${this.id}`;
    },
    async edit(novo) {
      const alteracoes = typeof novo === 'string' ? { content: novo } : novo;
      for (const chave of ['content', 'embeds', 'components']) {
        if (alteracoes[chave] !== undefined) this[chave] = alteracoes[chave];
      }
      return this;
    },
    async delete() {
      this.apagada = true;
      canal.mensagens.delete(this.id);
    },
    async fetch() {
      return this;
    },
    async startThread({ name }) {
      const topico = criarCanal(canal.guild, { nome: name, topico: true, parentId: canal.id });
      canal.guild.client.canais.set(topico.id, topico);
      return topico;
    }
  };
  return mensagem;
}

function criarCanal(guild, { id = novoId(), nome = 'canal', topico = false, parentId = null } = {}) {
  const canal = {
    id,
    name: nome,
    guild,
    parentId,
    locked: false,
    archived: false,
    mensagens: new Collection(),
    isTextBased: () => true,
    isThread: () => topico,
    async send(payload) {
      const mensagem = criarMensagem(canal, guild.client.user, payload);
      canal.mensagens.set(mensagem.id, mensagem);
      return mensagem;
    },
    async setName(novoNome) {
      canal.name = novoNome;
      return canal;
    },
    async setLocked(valor = true) {
      canal.locked = valor;
      return canal;
    },
    async setArchived(valor = true) {
      canal.archived = valor;
      return canal;
    },
    async bulkDelete() {},
    members: { add: async () => {}, remove: async () => {} },
    permissionsFor: () => ({ has: () => true })
  };

  canal.messages = {
    cache: canal.mensagens,
    async fetch(alvo) {
      if (typeof alvo === 'string') {
        const mensagem = canal.mensagens.get(alvo);
        if (!mensagem) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return mensagem;
      }
      return canal.mensagens.clone();
    }
  };

  return canal;
}

function criarMembro(guild, user, { cargos = [], apelido = null } = {}) {
  const roles = new Collection(cargos.map(id => [id, { id, position: 1, name: id }]));
  return {
    id: user.id,
    user,
    guild,
    nickname: apelido,
    displayName: apelido || user.username,
    roles: { cache: roles, highest: { position: 1, name: 'cargo' } },
    permissions: { has: () => false },
    toString: () => `<@${user.id}>`
  };
}

function criarDiscordFalso({ guildId = '5000000000000000001', nome = 'Servidor de teste' } = {}) {
  const usuarios = new Collection();
  const canais = new Collection();
  const membros = new Collection();

  const client = {
    canais,
    user: criarUsuario('5000000000000000999', 'Althea'),
    guilds: { cache: new Collection() },
    channels: {
      cache: canais,
      async fetch(id) {
        const canal = canais.get(id);
        if (!canal) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
        return canal;
      }
    },
    users: {
      cache: usuarios,
      async fetch(id) {
        const usuario = usuarios.get(id);
        if (!usuario) throw Object.assign(new Error('Unknown User'), { code: 10013 });
        return usuario;
      }
    }
  };
  client.user.bot = true;

  const guild = {
    id: guildId,
    name: nome,
    client,
    premiumTier: 0,
    iconURL: () => null,
    channels: { cache: canais, fetch: (id) => client.channels.fetch(id) },
    roles: { cache: new Collection(), fetch: async () => null },
    members: {
      cache: membros,
      async fetch(alvo) {
        const id = typeof alvo === 'string' ? alvo : alvo?.user;
        const membro = membros.get(id);
        if (!membro) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return membro;
      }
    }
  };
  client.guilds.cache.set(guild.id, guild);
  client.guilds.fetch = async (id) => client.guilds.cache.get(id);

  return {
    client,
    guild,
    adicionarCanal(opcoes) {
      const canal = criarCanal(guild, opcoes);
      canais.set(canal.id, canal);
      return canal;
    },
    adicionarMembro(id, username, opcoes) {
      const user = criarUsuario(id, username);
      usuarios.set(id, user);
      const membro = criarMembro(guild, user, opcoes);
      membros.set(id, membro);
      return membro;
    },
    // Usuário do Discord que não está no servidor.
    adicionarUsuarioDeFora(id, username) {
      const user = criarUsuario(id, username);
      usuarios.set(id, user);
      return user;
    }
  };
}

module.exports = { criarDiscordFalso, novoId };
