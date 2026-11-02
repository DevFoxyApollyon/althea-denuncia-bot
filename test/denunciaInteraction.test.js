const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');

test.after(fecharConexoes);

const { interactionHasRole, criarTopicoPrivado } = require('../commands/denuncia');

test('verificação de cargo aceita membros em cache e membros da API', async () => {
  const cachedMemberInteraction = {
    member: { roles: { cache: { has: roleId => roleId === 'cargo-1' } } }
  };
  const apiMemberInteraction = {
    member: { roles: ['cargo-1'] }
  };

  assert.equal(await interactionHasRole(cachedMemberInteraction, 'cargo-1'), true);
  assert.equal(await interactionHasRole(apiMemberInteraction, 'cargo-1'), true);
});

test('verificação de cargo busca o membro quando interaction.member é nulo', async () => {
  let fetchedUserId;
  const interaction = {
    member: null,
    user: { id: 'usuario-1' },
    guild: {
      members: {
        fetch: async userId => {
          fetchedUserId = userId;
          return { roles: { cache: { has: roleId => roleId === 'cargo-1' } } };
        }
      }
    }
  };

  assert.equal(await interactionHasRole(interaction, 'cargo-1'), true);
  assert.equal(fetchedUserId, 'usuario-1');
});

test('tópico privado: põe denunciante e acusados; se o Discord recusar alguém, apaga e volta para público', async () => {
  const { ChannelType } = require('discord.js');
  const criarCanal = (falharEm = null) => {
    const registro = { criados: [], adicionados: [], apagados: 0 };
    const canal = {
      registro,
      threads: {
        async create(opcoes) {
          registro.criados.push(opcoes);
          return {
            members: {
              async add(id) {
                if (id === falharEm) throw Object.assign(new Error('Missing Access'), { code: 50001 });
                registro.adicionados.push(id);
              }
            },
            async delete() { registro.apagados += 1; }
          };
        }
      }
    };
    return canal;
  };

  const ok = criarCanal();
  const topico = await criarTopicoPrivado(ok, 'Denúncia: 1039', ['1', '2', '2']);
  assert.ok(topico);
  assert.equal(ok.registro.criados[0].type, ChannelType.PrivateThread);
  assert.equal(ok.registro.criados[0].invitable, false);
  assert.deepEqual(ok.registro.adicionados, ['1', '2']);

  // Acusado que não vê o canal fica de fora; o tópico continua privado.
  const acusadoSemAcesso = criarCanal('2');
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    assert.ok(await criarTopicoPrivado(acusadoSemAcesso, 'Denúncia: 1039', ['1', '2']));
  } finally {
    console.warn = avisoOriginal;
  }
  assert.deepEqual(acusadoSemAcesso.registro.adicionados, ['1']);
  assert.equal(acusadoSemAcesso.registro.apagados, 0);

  // Denunciante recusado: apaga e volta para público.
  const falha = criarCanal('1');
  console.warn = () => {};
  try {
    assert.equal(await criarTopicoPrivado(falha, 'Denúncia: 1039', ['1', '2']), null);
  } finally {
    console.warn = avisoOriginal;
  }
  assert.equal(falha.registro.apagados, 1);

  // Cargos de administrador e responsável: marcados por edição (sem notificar) e
  // quem o bot já conhece com o cargo entra direto.
  const mensagens = [];
  const adicionados = [];
  const comCargos = {
    threads: {
      async create() {
        return {
          guild: { roles: { cache: new Map([['300000000000000001', { members: new Map([['400000000000000001', {}]]) }]]) } },
          members: { async add(id) { adicionados.push(id); } },
          async send(payload) {
            const mensagem = { ...payload, apagada: false, async edit(novo) { Object.assign(mensagem, novo); }, async delete() { mensagem.apagada = true; } };
            mensagens.push(mensagem);
            return mensagem;
          },
          async delete() {}
        };
      }
    }
  };
  assert.ok(await criarTopicoPrivado(comCargos, 'x', ['1'], ['300000000000000001', undefined, '300000000000000002']));
  await new Promise(resolve => setTimeout(resolve, 20)); // a staff entra em segundo plano
  assert.equal(mensagens.length, 1);
  assert.equal(mensagens[0].content, '<@&300000000000000001> <@&300000000000000002>');
  assert.deepEqual(mensagens[0].allowedMentions, { roles: ['300000000000000001', '300000000000000002'] });
  assert.equal(mensagens[0].apagada, true);
  assert.deepEqual(adicionados, ['1', '400000000000000001']);

  const semPermissao = { threads: { async create() { throw new Error('Missing Permissions'); } } };
  console.warn = () => {};
  try {
    assert.equal(await criarTopicoPrivado(semPermissao, 'x', ['1']), null);
  } finally {
    console.warn = avisoOriginal;
  }
});

test('status da denúncia: a linha em branco do fim continua no fim', () => {
  const { atualizarTextoDeStatus } = require('../utils/atualizarStatus');
  const original = '|| <@1> ||\n➱ **Denunciante**: `1039`\n➱ **Tópico**: <#9>\n➱ **Status**: `Pendente`\n⠀';
  assert.equal(atualizarTextoDeStatus(original, 'aceita'), '|| <@1> ||\n➱ **Denunciante**: `1039`\n➱ **Tópico**: <#9>\n➱ **Status**: `Aceita ✅`\n⠀');
  // Sem a linha em branco, nada muda no formato de sempre.
  assert.equal(atualizarTextoDeStatus('➱ **Motivo**: `x`\n➱ **Status**: `Pendente`', 'recusada'), '➱ **Motivo**: `x`\n➱ **Status**: `Recusada ❌`');
});

test('tópico privado: acusado identificado depois da abertura entra no tópico', async () => {
  const { ChannelType } = require('discord.js');
  const { porNoTopicoPrivado } = require('../utils/restricaoTopicos');
  const adicionados = [];
  const privado = { type: ChannelType.PrivateThread, members: { async add(id) { if (id === '300000000000000003') throw new Error('Unknown Member'); adicionados.push(id); } } };
  assert.equal(await porNoTopicoPrivado(privado, ['300000000000000001', '300000000000000001', 'conta-1039', '300000000000000003']), 1);
  assert.deepEqual(adicionados, ['300000000000000001']);
  const publico = { type: ChannelType.PublicThread, members: { async add() { throw new Error('não deveria'); } } };
  assert.equal(await porNoTopicoPrivado(publico, ['300000000000000001']), 0);
});

test('aceite com acusado fora do banco: abre tópico público na mensagem do canal', async () => {
  const { ChannelType } = require('discord.js');
  const { abrirTopicoPublicoDoAceite } = require('../Handlers/statusDenuncia/acoesStatus');
  const enviados = [];
  let criado = null;
  const mensagem = {
    hasThread: false,
    async startThread(opcoes) { criado = opcoes; return { async send(payload) { enviados.push(payload); } }; }
  };
  const canais = {
    '900000000000000001': { type: ChannelType.PrivateThread },
    '900000000000000002': { messages: { async fetch() { return mensagem; } } }
  };
  const client = { channels: { async fetch(id) { return canais[id]; } } };
  const denuncia = { threadId: '900000000000000001', channelId: '900000000000000002', messageId: '1', denunciante: '1039' };

  assert.ok(await abrirTopicoPublicoDoAceite(client, denuncia, { acusadoId: '1039+2471', motivo: 'RDM', dataPunicao: '01/11/2026', staff: '<@5>' }));
  assert.equal(criado.name, 'Denúncia: 1039 (decisão)');
  assert.match(enviados[0].content, /Denúncia aceita/);
  assert.match(enviados[0].content, /`1039\+2471`/);
  assert.match(enviados[0].content, /RDM/);

  // Tópico público (ou mensagem que já tem tópico): não abre outro.
  canais['900000000000000001'] = { type: ChannelType.PublicThread };
  assert.equal(await abrirTopicoPublicoDoAceite(client, denuncia, { acusadoId: '1', motivo: 'x', dataPunicao: 'x' }), null);
});

test('reivindicar: staff não pega denúncia em que é parte nem contra quem a denunciou', async () => {
  const Denuncia = require('../models/Denuncia');
  const { conflitoDeInteresse } = require('../Handlers/statusDenuncia/reivindicar');
  const staff = '500000000000000001';
  const denuncia = { guildId: '1', criadoPor: '500000000000000002', acusadoUserIds: ['500000000000000003'] };

  const existsOriginal = Denuncia.exists;
  let filtro = null;
  try {
    Denuncia.exists = async (f) => { filtro = f; return null; };
    assert.match(await conflitoDeInteresse({ ...denuncia, criadoPor: staff }, staff), /denunciante/);
    assert.match(await conflitoDeInteresse({ ...denuncia, acusadoUserIds: [staff] }, staff), /acusado/);
    assert.equal(await conflitoDeInteresse(denuncia, staff), null);
    assert.deepEqual(filtro.criadoPor, { $in: ['500000000000000003'] });
    assert.equal(filtro.acusadoUserIds, staff);

    Denuncia.exists = async () => ({ _id: 'x' });
    assert.match(await conflitoDeInteresse(denuncia, staff), /denunciou você/);
    // Sem acusado identificado não há o que conferir no banco.
    assert.equal(await conflitoDeInteresse({ ...denuncia, acusadoUserIds: [] }, staff), null);
  } finally {
    Denuncia.exists = existsOriginal;
  }
});

test('tópico privado: canais da staff recebem o link da mensagem principal e o botão de entrar', async () => {
  const { ChannelType } = require('discord.js');
  const { manageStatusMessages } = require('../Handlers/statusDenuncia/mensagensStatus');
  const criarCanal = (id, extra = {}) => {
    const enviados = [];
    return {
      id, enviados, ...extra,
      isTextBased: () => true,
      messages: { async fetch() { return { size: 0, find: () => undefined }; } },
      async send(payload) {
        const mensagem = { id: `m${enviados.length}`, payload, async edit(novo) { mensagem.editado = novo; } };
        enviados.push(mensagem);
        return mensagem;
      }
    };
  };
  const logs = criarCanal('700000000000000001');
  const analise = criarCanal('700000000000000002');
  const topico = criarCanal('700000000000000003', {
    type: ChannelType.PrivateThread,
    guild: { id: '700000000000000009', channels: { async fetch(id) { return id === analise.id ? analise : null; } } }
  });
  const denuncia = { channelId: '700000000000000004', messageId: '700000000000000005', acusado: '1039', motivo: 'RDM' };
  const principal = 'https://discord.com/channels/700000000000000009/700000000000000004/700000000000000005';

  await manageStatusMessages(topico, 'analise', '<@1>', {
    messageUrl: 'https://discord.com/channels/x/700000000000000003/1', logsChannel: logs, analysisChannelId: analise.id, denuncia
  });
  const botaoDe = (componentes) => componentes.map(linha => linha.toJSON().components[0].custom_id);
  assert.ok(logs.enviados[0].payload.content.includes(principal));
  assert.deepEqual(botaoDe(logs.enviados[0].payload.components), ['entrar_topico:700000000000000003']);
  assert.ok(analise.enviados[0].payload.includes(principal));
  assert.deepEqual(botaoDe(analise.enviados[0].editado.components), ['entrar_topico:700000000000000003']);

  // Aceita: "Entrar no tópico" ao lado de Aceitar e Recusar no Log Admin.
  await manageStatusMessages(topico, 'aceita', '<@1>', { messageUrl: 'x', logsChannel: logs, denuncia, acusadoId: '1039', motivo: 'RDM', dataPunicao: '01/11' });
  const linhaDoLog = logs.enviados.at(-1).payload.components;
  assert.equal(linhaDoLog.length, 1);
  assert.deepEqual(linhaDoLog[0].toJSON().components.map(botao => botao.custom_id),
    ['log_aceitar_700000000000000005', 'log_recusar_700000000000000005', 'entrar_topico:700000000000000003']);

  await manageStatusMessages(topico, 'recusada', '<@1>', { messageUrl: 'x', denuncia });
  assert.match(topico.enviados.at(-1).payload, /Link para compartilhar:\*\* https:\/\/discord\.com\/channels\/700000000000000009\/700000000000000004\/700000000000000005/);
});

test('relatório de punições: botão Entrar no tópico só com tópico privado', () => {
  const { montarMensagemGm } = require('../services/ponteSamp/discordGm');
  const base = { _id: 'p1', status: 'aplicada', alvos: [], msgDiscord: {}, mensagens: { topicoId: '700000000000000003' } };
  const ids = (msg) => msg.components.flatMap(linha => linha.toJSON().components.map(botao => botao.custom_id));
  assert.deepEqual(ids(montarMensagemGm({ ...base, mensagens: { ...base.mensagens, topicoPrivado: true } }, [], {})), ['entrar_topico:700000000000000003']);
  assert.deepEqual(ids(montarMensagemGm(base, [], {})), []);
});
