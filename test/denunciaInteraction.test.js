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

  const falha = criarCanal('2');
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await criarTopicoPrivado(falha, 'Denúncia: 1039', ['1', '2']), null);
  } finally {
    console.warn = avisoOriginal;
  }
  assert.equal(falha.registro.apagados, 1);

  const semPermissao = { threads: { async create() { throw new Error('Missing Permissions'); } } };
  console.warn = () => {};
  try {
    assert.equal(await criarTopicoPrivado(semPermissao, 'x', ['1']), null);
  } finally {
    console.warn = avisoOriginal;
  }
});
