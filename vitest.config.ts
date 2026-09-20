import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  define: { __MASCOT_ENABLED__: true, __TAURI_SHELL__: true },
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@platform': resolve(import.meta.dirname, 'src/platform')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'runtime/src/**/*.test.ts'],
    globals: false
  }
})
