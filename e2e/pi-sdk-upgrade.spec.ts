import { test, expect } from './fixtures'

// Pi's sandbox remains upstream-owned. This checks its worker/wasm assets in
// Electron and in the optional packaged executable, without changing tool presets.
test('loads the Pi sandbox worker and wasm from the installed dependency graph', async ({
  electronApp
}) => {
  const result = await electronApp.evaluate(async ({ app }) => {
    const { createRequire, findPackageJSON } = process.getBuiltinModule('module')!
    const { pathToFileURL } = process.getBuiltinModule('url')!
    const path = process.getBuiltinModule('path')!
    const fs = process.getBuiltinModule('fs')!
    const appRequire = createRequire(path.join(app.getAppPath(), 'package.json'))
    const directory = appRequire.resolve
      .paths('@earendil-works/pi-coding-agent')!
      .map((root) => path.join(root, '@earendil-works/pi-coding-agent'))
      .find((root) => fs.existsSync(path.join(root, 'package.json')))!
    const piRoot = fs.realpathSync(directory)
    const piRequire = createRequire(path.join(piRoot, 'package.json'))
    const packageFile = findPackageJSON(
      '@earendil-works/pi-codemode',
      pathToFileURL(path.join(piRoot, 'package.json'))
    )!
    const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    // Playwright's Main evaluation has no dynamic-import callback. Require the
    // declared public ESM entry; Node supports synchronous ESM loading here.
    const sandboxModule = piRequire(
      path.join(path.dirname(packageFile), manifest.exports['.'].import)
    )
    const sandbox = new sandboxModule.CodemodeSandbox({
      wasm: sandboxModule.loadQuickJSWasm(piRequire.resolve('quickjs-wasi/quickjs.wasm')),
      timeoutMs: 5000
    })
    try {
      return await sandbox.execute('text(7 * 6)')
    } finally {
      await sandbox.close()
    }
  })
  expect(JSON.stringify(result)).toContain('42')
  expect(result).toMatchObject({ ok: true })
})
