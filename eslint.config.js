import pluginVue from 'eslint-plugin-vue'
import babelParser from '@babel/eslint-parser'
import js from '@eslint/js'
import globals from 'globals'
import { typeReferences } from './scripts/eslint-typescript.mjs'

const parserOptions = {
  requireConfigFile: false,
  babelOptions: { plugins: ['@babel/plugin-syntax-typescript'] }
}

export default [
  {
    name: 'pi-harness/ignores',
    ignores: [
      'out/**',
      'src/renderer/out/**',
      'dist/**',
      'runtime/dist/**',
      'release/**',
      'task/**',
      '.runtime-cache/**',
      'node_modules/**',
      'build/**',
      'resources/**',
      'src-tauri/**',
      'src/renderer/src/i18n/locales/**'
    ]
  },

  ...pluginVue.configs['flat/recommended'],

  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, __MASCOT_ENABLED__: 'readonly' }
    },
    plugins: { 'typescript-syntax': { rules: { 'type-references': typeReferences } } },
    rules: { 'typescript-syntax/type-references': 'error' }
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: { parser: babelParser, parserOptions },
    rules: { 'no-undef': 'off', 'no-redeclare': 'off' }
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { ...parserOptions, parser: babelParser } },
    rules: { 'no-undef': 'off', 'no-redeclare': 'off' }
  },
  {
    files: ['**/*.d.ts', '**/*.d.mts'],
    languageOptions: {
      parserOptions: {
        babelOptions: { plugins: [['@babel/plugin-syntax-typescript', { dts: true }]] }
      }
    }
  },
  {
    files: ['e2e/**/*.ts'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] }
  },

  {
    name: 'pi-harness/rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn'
    }
  }
]
