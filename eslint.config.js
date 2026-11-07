const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    { ignores: ['node_modules/**'] },
    js.configs.recommended,
    {
        files: ['site/public/**/*.js', 'site/ponte/painel/**/*.js'],
        languageOptions: { sourceType: 'module', globals: { ...globals.browser } }
    },
    {
        ignores: ['site/public/**', 'site/ponte/painel/**'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-irregular-whitespace': 'off',
            'no-useless-escape': 'off'
        }
    }
];
