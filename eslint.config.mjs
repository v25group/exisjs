import { defineConfig } from 'eslint/config'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    ignores: [
      '**/dist/**/*',
      '**/node_modules/**/*',
      '**/.tmp-*/**/*',
      '**/.next/**/*',
      '**/*.d.ts',
      '**/coverage/**/*',
      'jest.config.js',
      'examples/**/*',
      'bench/**/*',
      '**/bin/**/*',
      '**/assets/**/*',
      'scripts/**/*',
      'packages/rs/index.js',
      'packages/rs/index.d.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-undef': 'off',
    },
  },
  {
    files: [
      'packages/**/*.test.ts',
      'packages/**/tests/**/*.ts',
      'packages/**/tests/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
)
