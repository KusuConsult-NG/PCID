import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-test/**',
      '**/node_modules/**',
      '**/coverage/**',
      // Next's build output and the generated ambient declarations that come
      // with it: neither is written here, so neither is linted here.
      '**/.next/**',
      'apps/*/next-env.d.ts',
      // End-to-end run artefacts: traces, screenshots and the provisioned
      // credentials for a database that no longer exists.
      'apps/*/e2e/.artefacts/**',
      'apps/*/e2e/.results/**',
      'docs/openapi.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
    rules: {
      // Unused values are usually a sign a refactor left something behind.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` erases the type checking the authorisation model depends on.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // The service workers. Plain JavaScript by necessity - they are served as
    // they are written, not bundled - and they run in a worker global that has
    // neither `window` nor Node's globals.
    files: ['apps/*/public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Tests may reach into internals to prove a control holds.
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
);
