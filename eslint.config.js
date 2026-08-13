import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs([
  {
    name: 'pi-switch/ignores',
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      'build/**',
      'resources/**',
      'src-tauri/**',
      'src/renderer/src/i18n/locales/**'
    ]
  },

  ...pluginVue.configs['flat/recommended'],

  vueTsConfigs.recommended,

  {
    name: 'pi-switch/rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn'
    }
  }
])
