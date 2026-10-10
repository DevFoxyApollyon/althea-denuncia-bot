const test = require('node:test');
const assert = require('node:assert/strict');
const { fecharConexoes } = require('./helpers/env');

test.after(fecharConexoes);

const { interactionHasRole } = require('../commands/denuncia');

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
