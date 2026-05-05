import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/',
      'client/',
      'node_modules/',
      '*.js',
      '*.cjs',
      '*.mjs',
      'scripts/*.js',
      'scripts/*.mjs',
      'server/_archive/',
    ],
  },
  // Global overrides for all TS files
  {
    rules: {
      // TypeScript compiler handles undef/redeclare — ESLint duplicates cause false positives
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
    },
  },
  {
    files: ['server/**/*.ts', 'scripts/**/*.ts', 'database/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['server/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
