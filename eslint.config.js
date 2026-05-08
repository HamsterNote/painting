import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      '.expo/',
      '**/lib/**',
      '**/dist/**',
      'build/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.vscode/',
      '.idea/',
      '.sisyphus/',
      'jest.mockRN.js',
    ],
  },
  {
    files: ['**/*.config.{js,cjs}'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    plugins: {
      jest: jest,
    },
    languageOptions: {
      globals: {
        ...globals.jest,
      },
      parser: tseslint.parser,
    },
    rules: {
      ...jest.configs.recommended.rules,
      'no-undef': 'off',
    },
  },
  {
    files: ['playwright.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parser: tseslint.parser,
    },
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['apps/playground/**/*.{ts,tsx}', 'packages/painting/src/**/*.{ts,tsx}'],
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      react: react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...prettier.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react/react-in-jsx-scope': 'off',
    },
  },
];
