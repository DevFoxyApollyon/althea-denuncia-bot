const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { fecharConexoes } = require('./helpers/env');

const RAIZ = path.join(__dirname, '..');
const PASTAS = ['utils', 'models', 'services', 'Handlers', 'commands', 'jobs'];

function listarJs(pasta) {
  return fs.readdirSync(path.join(RAIZ, pasta), { withFileTypes: true }).flatMap(item => {
    const caminho = path.join(pasta, item.name);
    if (item.isDirectory()) return listarJs(caminho);
    return item.name.endsWith('.js') ? [caminho] : [];
  });
}

const arquivos = PASTAS.flatMap(listarJs);

const ler = (arquivo) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

test.after(fecharConexoes);

test('todos os módulos carregam sem erro', () => {
  for (const arquivo of arquivos) {
    assert.doesNotThrow(() => require(path.join(RAIZ, arquivo)), `falha ao carregar ${arquivo}`);
  }
});

test('todo require relativo aponta para um arquivo que existe', () => {
  for (const arquivo of ['index.js', ...arquivos]) {
    for (const [, alvo] of ler(arquivo).matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      assert.doesNotThrow(
        () => require.resolve(path.join(RAIZ, path.dirname(arquivo), alvo)),
        `${arquivo} importa ${alvo}, que não existe`
      );
    }
  }
});

test('todo pacote importado está declarado no package.json', () => {
  const declarados = new Set(Object.keys(require('../package.json').dependencies));
  const nativos = new Set(builtinModules);

  for (const arquivo of ['index.js', ...arquivos]) {
    for (const [, alvo] of ler(arquivo).matchAll(/require\(['"]([^.'"][^'"]*)['"]\)/g)) {
      const pacote = alvo.startsWith('@') ? alvo.split('/').slice(0, 2).join('/') : alvo.split('/')[0];
      if (nativos.has(pacote) || pacote.startsWith('node:')) continue;
      assert.ok(declarados.has(pacote), `${arquivo} usa "${pacote}", que não está em dependencies`);
    }
  }
});

test('roteador resolve customIds exatos e por prefixo', () => {
  const { resolverRota } = require('../Handlers/interactionHandler');
  assert.equal(typeof resolverRota('botao', 'reivindicar'), 'function');
  assert.equal(typeof resolverRota('botao', 'log_aceitar_123456'), 'function');
  assert.equal(typeof resolverRota('modal', 'corrigir_modal_aceite_123456'), 'function');
  assert.equal(typeof resolverRota('modal', 'feedback:modal:abc:9'), 'function');
  assert.equal(typeof resolverRota('menu', 'feedback:select:abc'), 'function');
  assert.equal(resolverRota('botao', 'nao_existe'), null);
  assert.equal(resolverRota('botao', 'toString'), null, 'não pode casar com propriedades herdadas');
  assert.equal(resolverRota('modal', 'reivindicar'), null, 'rota de botão não vale para modal');
  assert.equal(resolverRota(null, 'reivindicar'), null);
});

test('toda rota aponta para uma função', () => {
  const { ROTAS } = require('../Handlers/interactionHandler');
  for (const [tipo, { exatos, prefixos }] of Object.entries(ROTAS)) {
    for (const [id, handler] of Object.entries(exatos)) assert.equal(typeof handler, 'function', `${tipo}:${id}`);
    for (const [prefixo, handler] of prefixos) assert.equal(typeof handler, 'function', `${tipo}:${prefixo}*`);
  }
});

test('todo botão, menu e modal criado no código tem rota', () => {
  const { resolverRota } = require('../Handlers/interactionHandler');
  // Tratados por coletores na própria mensagem, não pelo roteador.
  const porColetor = new Set(['rank_export', 'rank_next', 'rank_prev', 'rank_period', 'download_rank', 'copy_rank']);
  const construtores = { ButtonBuilder: 'botao', ModalBuilder: 'modal', StringSelectMenuBuilder: 'menu' };
  const padrao = /new (ButtonBuilder|ModalBuilder|StringSelectMenuBuilder)\(\)\s*\.setCustomId\(\s*['"]([^'"]+)['"]/g;

  let conferidos = 0;
  for (const arquivo of arquivos) {
    for (const [, construtor, id] of ler(arquivo).matchAll(padrao)) {
      if (porColetor.has(id)) continue;
      assert.equal(typeof resolverRota(construtores[construtor], id), 'function', `${arquivo}: "${id}" não tem rota`);
      conferidos++;
    }
  }
  assert.ok(conferidos > 15, `poucos componentes encontrados (${conferidos}); o padrão de busca quebrou?`);
});

test('comandos de barra têm definição válida e nomes únicos', () => {
  const { comandos } = require('../commands/slash');
  const nomes = comandos.map(comando => comando.data.toJSON().name);
  assert.deepEqual([...nomes].sort(), ['denuncia', 'painel', 'rank', 'status']);
  for (const comando of comandos) {
    assert.equal(typeof comando.executar, 'function', comando.data.name);
    assert.ok(comando.data.toJSON().description.length <= 100);
  }
});

test('normalizarIds aceita vários separadores e descarta lixo', () => {
  const { normalizarIds } = require('../utils/usuariosIsentos');
  assert.deepEqual(
    normalizarIds('123456789012345678, 987654321098765432;abc 12 123456789012345678'),
    ['123456789012345678', '987654321098765432']
  );
});

test('filtro de links libera YouTube e bloqueia convites', () => {
  const { contemLinkProibido } = require('../utils/strikeWords');
  assert.equal(contemLinkProibido('ola tudo bem'), false);
  assert.equal(contemLinkProibido('veja https://youtube.com/watch?v=1'), false);
  assert.equal(contemLinkProibido('https://discord.gg/abc'), true);
});

test('cache de config: lê do cache e invalida', async () => {
  const { globalCache } = require('../utils/smartCache');
  const { getConfig, setConfig, peekConfig, invalidateConfig } = require('../utils/configCache');

  const config = { guildId: '1', roles: { administrador: '2' } };
  setConfig('1', config);
  assert.equal(await getConfig('1'), config, 'não deve consultar o banco quando está em cache');
  assert.equal(peekConfig('1'), config);

  invalidateConfig('1');
  assert.equal(peekConfig('1'), null);
  assert.equal(await getConfig(''), null);
  assert.doesNotThrow(() => globalCache.getStats());
});

test('salvar a Config invalida o cache', async () => {
  const Config = require('../models/Config');
  const { setConfig, peekConfig } = require('../utils/configCache');
  const doc = new Config({ guildId: '42' });

  setConfig('42', { guildId: '42' });
  // Dispara os hooks pós-gravação sem precisar de banco.
  await new Promise((resolve, reject) =>
    Config.schema.s.hooks.execPost('save', doc, [doc], (erro) => (erro ? reject(erro) : resolve()))
  );
  assert.equal(peekConfig('42'), null);
});
