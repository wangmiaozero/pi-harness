import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

/**
 * Renderer build for the Tauri host.
 *
 * Mirrors the Electron renderer config (electron.vite.config.ts) but:
 * - serves on port 31416 (Electron owns 31415),
 * - defines `__TAURI_SHELL__: true` so the platform layer's Tauri bridge is
 *   compiled in (the Electron build keeps it `false` and Rollup drops it),
 * - outputs to `out/renderer-tauri` so both hosts can coexist on disk,
 * - skips the overlay window (Tauri round 1 does not ship it).
 */
export default defineConfig(({ mode }) => {
  const mascotEnabled = mode !== 'nomascot'
  const featureDefines = {
    __MASCOT_ENABLED__: JSON.stringify(mascotEnabled),
    __TAURI_SHELL__: JSON.stringify(true)
  }

  return {
    define: featureDefines,
    root: 'src/renderer',
    resolve: {
      alias: {
        ...(mascotEnabled
          ? {}
          : {
              '@renderer/pet/manifests-data': resolve(
                import.meta.dirname,
                'src/renderer/src/pet/manifests-stub.ts'
              )
            }),
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
        '@shared': resolve(import.meta.dirname, 'src/shared'),
        '@platform': resolve(import.meta.dirname, 'src/platform')
      }
    },
    plugins: [vue(), tailwindcss()],
    server: {
      // Desktop-only; Tauri loads this URL (tauri.conf.json devUrl).
      // 31416 sits next to Electron's 31415 (π); fail if occupied.
      open: false,
      strictPort: true,
      port: 31416
    },
    build: {
      outDir: resolve(import.meta.dirname, 'out/renderer-tauri'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
