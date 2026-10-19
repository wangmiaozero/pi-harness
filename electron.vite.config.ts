import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  // `--mode nomascot` compiles the optional theme-art module out of the app:
  // the Settings section is hidden, the pet runtime is skipped, and the
  // sprite data module is swapped for an empty stub so its assets never
  // enter the bundle. Driven by the `*:nomascot` scripts in package.json.
  const updateFixture = mode === 'update-e2e' || mode === 'update-e2e-nomascot'
  if (updateFixture && process.env.PI_HARNESS_NATIVE_UPDATE_TEST !== '1')
    throw new Error('Update fixtures require an explicit local/native test build')
  const trustFile = updateFixture
    ? process.env.PI_HARNESS_UPDATE_TEST_TRUST
    : resolve(import.meta.dirname, 'resources/release-public-keys.json')
  if (!trustFile) throw new Error('An ephemeral public test trust store is required')
  if (updateFixture) {
    const trust = JSON.parse(readFileSync(trustFile, 'utf8'))
    if (
      trust.schemaVersion !== 1 ||
      !Array.isArray(trust.keys) ||
      !trust.keys.length ||
      trust.keys.some(
        (key: { publicKey?: string }) => !key.publicKey?.startsWith('-----BEGIN PUBLIC KEY-----')
      )
    )
      throw new Error('The test identity must contain public keys only')
  }
  const mascotEnabled = !['nomascot', 'update-e2e-nomascot'].includes(mode)
  const featureDefines = { __MASCOT_ENABLED__: JSON.stringify(mascotEnabled) }

  return {
    main: {
      define: featureDefines,
      plugins: updateFixture
        ? [
            {
              name: 'reject-published-update-fixtures',
              generateBundle() {
                this.emitFile({
                  type: 'asset',
                  fileName: 'update-test-identity.json',
                  source: '{"testOnly":true}\n'
                })
              }
            }
          ]
        : [],
      build: {
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/main/index.ts'),
            'universal-worker': resolve(import.meta.dirname, 'src/main/universal/worker.ts'),
            'session-index-worker': resolve(
              import.meta.dirname,
              'src/main/sessions/session-index-worker.ts'
            )
          },
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
        alias: {
          '@shared': resolve(import.meta.dirname, 'src/shared'),
          '@release-trust': trustFile
        }
      }
    },
    preload: {
      define: featureDefines,
      build: {
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/preload/index.ts'),
            overlay: resolve(import.meta.dirname, 'src/preload/overlay.ts')
          }
        }
      },
      resolve: {
        alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
      }
    },
    renderer: {
      define: featureDefines,
      root: 'src/renderer',
      resolve: {
        alias: {
          ...(mascotEnabled
            ? {}
            : {
                // Must stay above the generic '@renderer' entry so the exact
                // match wins and the mascot sprite assets are excluded.
                '@renderer/pet/manifests-data': resolve(
                  import.meta.dirname,
                  'src/renderer/src/pet/manifests-stub.ts'
                )
              }),
          '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
          '@shared': resolve(import.meta.dirname, 'src/shared')
        }
      },
      plugins: [vue(), tailwindcss()],
      server: {
        // Desktop-only: never auto-open a system/IDE browser. Electron loads this URL.
        // 31415 ≈ π (3.1415); fail if occupied so Electron does not follow a fallback port.
        open: false,
        strictPort: true,
        port: 31415
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'src/renderer/index.html'),
            overlay: resolve(import.meta.dirname, 'src/renderer/overlay.html')
          }
        }
      }
    }
  }
})
