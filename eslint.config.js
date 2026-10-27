const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['**/node_modules/**', 'preview/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: [
      'scripts/**/*.js',
      'tests/**/*.js',
      'server/**/*.js',
      'diagnostics/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: { globals: { ...globals.node, fetch: 'readonly' } },
  },
  {
    files: ['miniprogram/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.es2021,
        wx: 'readonly',
        Page: 'readonly',
        App: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: { 'no-eval': 'error', 'no-new-func': 'error' },
  },
  {
    files: ['scripts/preview-runtime.js'],
    languageOptions: { globals: { ...globals.browser, BUNDLE: 'readonly' } },
  },
];
