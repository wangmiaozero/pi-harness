import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
        external: [
          'electron',
          'chokidar',
          '@earendil-works/pi-coding-agent',
          '@earendil-works/pi-agent-core',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-tui'
        ]
      }
    },
    resolve: {
      alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
        '@shared': resolve(import.meta.dirname, 'src/shared')
      }
    },
    plugins: [vue(), tailwindcss()],
    server: {
      // Desktop-only: never auto-open a system/IDE browser. Electron loads this URL.
      open: false,
      strictPort: true
    },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') }
      }
    }
  }
})
