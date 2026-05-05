const js = require('@eslint/js');
const globals = require('globals');

const sharedLanguageOptions = {
  ecmaVersion: 'latest',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
  },
  globals: {
    ...globals.browser,
    ...globals.node,
    ...globals.commonjs,
    __DEV__: 'readonly',
    fetch: 'readonly',
    FormData: 'readonly',
    AbortController: 'readonly',
  },
};

module.exports = [
  {
    linterOptions: {
      noInlineConfig: true,
    },
    ignores: [
      '**/android/**',
      '**/archive/**',
      '**/assets/**',
      '**/BuddyBoard_Client_Packet/**',
      '**/docs/**',
      '**/functions/**',
      '**/node_modules/**',
      '**/public/**',
      '**/scripts/api-mock.js',
      '**/src/seed/**',
      '**/tmp/**',
      '**/web-dist/**',
    ],
  },
  {
    files: ['App.js', 'screens/**/*.js', 'src/**/*.js', 'tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: sharedLanguageOptions,
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': 'off',
      'no-unused-vars': 'off',
      'no-useless-catch': 'off',
    },
  },
  {
    files: [
      'app.config.js',
      'babel.config.js',
      'metro.config.js',
      'postcss.config.js',
      'tailwind.config.js',
      'eslint.config.js',
      'scripts/**/*.js',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ...sharedLanguageOptions,
      sourceType: 'commonjs',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': 'off',
      'no-unused-vars': 'off',
      'no-useless-catch': 'off',
    },
  },
];