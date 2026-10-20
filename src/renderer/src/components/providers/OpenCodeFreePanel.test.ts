import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { i18n } from '@renderer/i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { OpenCodeFreeState, OpenCodeModel } from '@shared/providers/opencode-free'
import OpenCodeFreePanel from './OpenCodeFreePanel.vue'

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => 'opencode-progress'),
    dismiss: vi.fn()
  }
}))

const model = (id: string, price: OpenCodeModel['price'] = 'free'): OpenCodeModel => ({
  id,
  name: id,
  price,
  available: true,
  api: 'openai-completions',
  cost:
    price === 'unknown'
      ? null
      : {
          input: price === 'paid' ? 1 : 0,
          output: price === 'paid' ? 2 : 0,
          cacheRead: 0,
          cacheWrite: 0
        },
  contextWindow: 200000,
  maxTokens: 32000,
  input: ['text'],
  reasoning: false,
  streaming: 'not_verified',
  tools: 'not_verified',
  checkedAt: null,
  status: 'not_verified',
  errorCode: null
})
const current = (): OpenCodeFreeState => ({
  schemaVersion: 2,
  enabled: true,
  authMode: 'inference',
  hasCredential: true,
  credentials: [{ id: 'default', name: 'Personal' }],
  activeCredentialId: 'default',
  connectionStatus: 'CONNECTED',
  httpStatus: 200,
  allowedPaidModels: [],
  authorizedModels: ['free-model', 'paid-model', 'unsupported'],
  selectedModel: null,
  refreshedAt: Date.now(),
  error: null,
  models: [
    model('free-model'),
    model('paid-model', 'paid'),
    model('test', 'unknown'),
    { ...model('unsupported', 'paid'), api: null }
  ]
})
function verified(state: OpenCodeFreeState, id: string): OpenCodeFreeState {
  return {
    ...state,
    error: null,
    allowedPaidModels: [...state.allowedPaidModels, id],
    models: state.models.map((model) =>
      model.id === id
        ? { ...model, status: 'ready', streaming: 'verified', tools: 'verified' }
        : model
    )
  }
}
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
  delete window.piSwitch
  vi.clearAllMocks()
})
async function setup(state = current()) {
  const api = {
    state: vi.fn(async () => state),
    setWorkspaceVisibility: vi.fn(
      async (input: { showInWorkspace: boolean; modelIds: string[] }) => {
        // Model Electron's structured-clone boundary: Vue proxy arrays must never cross it.
        const form = structuredClone(input)
        return { ...state, showInWorkspace: form.showInWorkspace, workspaceModelIds: form.modelIds }
      }
    ),
    refresh: vi.fn(async () => state),
    cancel: vi.fn(async () => undefined),
    revealCredential: vi.fn(async () => 'fixture-saved-key'),
    saveCredential: vi.fn(async () => state),
    activateCredential: vi.fn(async (id: string) => {
      state = { ...state, activeCredentialId: id, enabled: true }
      return state
    }),
    configure: vi.fn(async (form: { enabled: boolean }) => {
      state = { ...state, enabled: form.enabled }
      return state
    }),
    test: vi.fn(async (id: string, _options?: { confirmInference: true; allowPaid: boolean }) => {
      if (id !== 'connection') state = verified(state, id)
      return state
    }),
    select: vi.fn(async () => state)
  }
  window.piSwitch = {
    openCodeFree: api,
    models: { list: vi.fn(async () => []) },
    providers: { list: vi.fn(async () => []) }
  } as unknown as PiSwitchAPI
  const wrapper = mount(OpenCodeFreePanel, {
    attachTo: document.body,
    global: { plugins: [createPinia(), i18n] }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, api, state }
}
function button(name: string, root: ParentNode = document.body): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
  )
  expect(found, `button ${name}`).toBeTruthy()
  return found!
}
const t = (key: string) => String(i18n.global.t(`openCode.${key}`))
describe('OpenCode keys and model verification UI (mock IPC)', () => {
  it('loads the catalog on entry and refreshes once after a successful key switch, never after pause', async () => {
    const source = current()
    source.credentials!.push({ id: 'other', name: 'Work' })
    const { wrapper, api } = await setup(source)
    expect(api.refresh).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="opencode-credential-other"] button').trigger('click')
    await flushPromises()
    expect(api.activateCredential).toHaveBeenCalledWith('other')
    expect(api.refresh).toHaveBeenCalledTimes(2)
    expect(api.activateCredential.mock.invocationCallOrder[0]).toBeLessThan(
      api.refresh.mock.invocationCallOrder[1]
    )
    button(t('pauseKey')).click()
    await flushPromises()
    expect(api.refresh).toHaveBeenCalledTimes(2)
    expect(api.test).not.toHaveBeenCalled()
  })
  it('does not refresh after a rejected switch and retains the newly active key on refresh failure', async () => {
    const source = current()
    source.credentials!.push({ id: 'other', name: 'Work' })
    const { wrapper, api } = await setup(source)
    api.activateCredential.mockRejectedValueOnce(new Error('private data'))
    await wrapper.get('[data-testid="opencode-credential-other"] button').trigger('click')
    await flushPromises()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    api.refresh.mockRejectedValueOnce(new Error('private data'))
    await wrapper.get('[data-testid="opencode-credential-other"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="opencode-credential-other"]').text()).toContain(t('current'))
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('private data')
  })
  it('refreshes automatically after saving the first key', async () => {
    const source = {
      ...current(),
      enabled: false,
      hasCredential: false,
      credentials: [],
      activeCredentialId: null
    }
    const { api } = await setup(source)
    expect(api.refresh).not.toHaveBeenCalled()
    api.saveCredential.mockResolvedValueOnce(current())
    button(t('addKey')).click()
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[autocomplete="off"]'
    )!
    input.value = 'fixture-only-key'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLButtonElement>('[role="dialog"] [role="switch"]')!.click()
    await flushPromises()
    button(t('save')).click()
    await flushPromises()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(api.saveCredential.mock.invocationCallOrder[0]).toBeLessThan(
      api.refresh.mock.invocationCallOrder[0]
    )
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(api.test).not.toHaveBeenCalled()
  })
  it('verifies a free model and enables it in one click without a paid confirmation', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('[data-testid="opencode-model-free-model"] [role="switch"]').trigger('click')
    await flushPromises()
    expect(api.test).toHaveBeenCalledWith(
      'free-model',
      expect.objectContaining({
        confirmInference: true,
        allowPaid: false
      })
    )
    expect(api.setWorkspaceVisibility).toHaveBeenCalledWith({
      showInWorkspace: true,
      modelIds: ['free-model']
    })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
  it('requires one paid confirmation on enable and does not enable failed models', async () => {
    const { wrapper, api, state } = await setup()
    await wrapper.get('[data-testid="opencode-model-paid-model"] [role="switch"]').trigger('click')
    await flushPromises()
    expect(api.test).not.toHaveBeenCalled()
    expect(button(t('confirmVerify')).disabled).toBe(true)
    document.body.querySelector<HTMLButtonElement>('[role="dialog"] [role="switch"]')!.click()
    await flushPromises()
    button(t('confirmVerify')).click()
    await flushPromises()
    expect(api.test).toHaveBeenCalledWith(
      'paid-model',
      expect.objectContaining({ confirmInference: true, allowPaid: true })
    )
    expect(api.setWorkspaceVisibility).toHaveBeenCalledWith({
      showInWorkspace: true,
      modelIds: ['paid-model']
    })
    api.test.mockResolvedValueOnce({ ...state, error: 'FREE_TIER_RESTRICTED' })
    await wrapper.get('[data-testid="opencode-model-free-model"] [role="switch"]').trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenCalledTimes(1)
  })
  async function startBatch(wrapper: VueWrapper, paid = true) {
    button(t('verifyAll'), wrapper.element).click()
    await flushPromises()
    if (paid) {
      expect(button(t('confirmVerify')).disabled).toBe(true)
      document.body.querySelector<HTMLButtonElement>('[role="dialog"] [role="switch"]')!.click()
      await flushPromises()
    }
    button(t('confirmVerify')).click()
    await flushPromises()
  }
  it('verifies the complete catalog sequentially across filters, skips unknown/unsupported models and summarizes mixed results', async () => {
    const { wrapper, api, state } = await setup()
    button(t('values.free'), wrapper.element).click()
    let finish!: (result: OpenCodeFreeState) => void
    api.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await startBatch(wrapper)
    expect(api.test).toHaveBeenCalledTimes(1)
    expect(api.test).toHaveBeenCalledWith(
      'free-model',
      expect.objectContaining({
        confirmInference: true,
        allowPaid: false
      })
    )
    const failed = {
      ...state,
      error: 'FREE_TIER_RESTRICTED',
      models: state.models.map((model) =>
        model.id === 'free-model'
          ? { ...model, status: 'restricted' as const, errorCode: 'FREE_TIER_RESTRICTED' }
          : model
      )
    }
    api.test.mockResolvedValueOnce(verified(failed, 'paid-model'))
    finish(failed)
    await flushPromises()
    expect(api.test).toHaveBeenCalledTimes(2)
    expect(api.test).toHaveBeenLastCalledWith(
      'paid-model',
      expect.objectContaining({
        confirmInference: true,
        allowPaid: true
      })
    )
    expect(toast.warning).toHaveBeenCalledWith(
      i18n.global.t('openCode.batchResult', { passed: 1, failed: 1, skipped: 2, remaining: 0 }),
      { id: 'opencode-progress', duration: 8000 }
    )
    expect(api.setWorkspaceVisibility).not.toHaveBeenCalled()
    expect(api.select).not.toHaveBeenCalled()
  })
  it('never starts a queued model after cancellation and reports partial results', async () => {
    const { wrapper, api, state } = await setup()
    let finish!: (result: OpenCodeFreeState) => void
    api.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await startBatch(wrapper)
    button(t('cancel'), wrapper.element).click()
    await flushPromises()
    expect(api.cancel).toHaveBeenCalledTimes(1)
    finish({ ...state, error: 'REQUEST_CANCELLED' })
    await flushPromises()
    expect(api.test).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith(
      i18n.global.t('openCode.batchCancelled', { passed: 0, failed: 0, skipped: 2, remaining: 2 }),
      { id: 'opencode-progress', duration: 8000 }
    )
    expect(button(t('verifyAll'), wrapper.element).disabled).toBe(false)
  })
  it('cancels on leaving the panel and never sends the remaining requests', async () => {
    const { wrapper, api, state } = await setup()
    let finish!: (result: OpenCodeFreeState) => void
    api.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await startBatch(wrapper)
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    finish(verified(state, 'free-model'))
    await flushPromises()
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.test).toHaveBeenCalledTimes(1)
    expect(toast.dismiss).toHaveBeenCalledWith('opencode-progress')
  })
  it('does not reuse the batch approval after a price or active key changes', async () => {
    const { wrapper, api, state } = await setup()
    api.test.mockResolvedValueOnce({
      ...verified(state, 'free-model'),
      models: verified(state, 'free-model').models.map((model) =>
        model.id === 'paid-model'
          ? { ...model, cost: { input: 9, output: 99, cacheRead: 0, cacheWrite: 0 } }
          : model
      )
    })
    await startBatch(wrapper)
    expect(api.test).toHaveBeenCalledTimes(1)
    api.test.mockClear()
    api.test.mockResolvedValueOnce({
      ...verified(state, 'free-model'),
      activeCredentialId: 'different'
    })
    await startBatch(wrapper)
    expect(api.test).toHaveBeenCalledTimes(1)
  })
  it('explains why a batch has no candidates instead of hiding every skip behind a count', async () => {
    const source = { ...current(), authorizedModels: [] }
    const { wrapper, api } = await setup(source)
    button(t('verifyAll'), wrapper.element).click()
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(t('errors.INSUFFICIENT_PERMISSION'))
    expect(dialog.textContent).toContain(t('errors.PROTOCOL_NOT_VERIFIED'))
    expect(button(t('confirmVerify')).disabled).toBe(true)
    expect(api.test).not.toHaveBeenCalled()
  })
  it('uses the key card as the single place to pause and resume without sending inference', async () => {
    const { wrapper, api } = await setup()
    expect(wrapper.find(`[role="switch"][aria-label="${t('enabled')}"]`).exists()).toBe(false)
    button(t('pauseKey')).click()
    await flushPromises()
    expect(api.configure).toHaveBeenCalledWith({
      enabled: false,
      authMode: 'inference',
      consent: true
    })
    expect(wrapper.get('[data-testid="opencode-credential-default"]').text()).toContain(
      t('keyPaused')
    )
    button(t('resumeKey')).click()
    await flushPromises()
    expect(api.activateCredential).toHaveBeenCalledWith('default')
    expect(wrapper.get('[data-testid="opencode-credential-default"]').text()).toContain(
      t('current')
    )
    expect(api.test).not.toHaveBeenCalled()
    expect(api.select).not.toHaveBeenCalled()
  })
  it('can turn off a previously saved workspace visibility preference after mounting', async () => {
    const { wrapper, api } = await setup({
      ...current(),
      showInWorkspace: true,
      workspaceModelIds: ['free-model']
    })
    const visibility = wrapper.get(`[role="switch"][aria-label="${t('workspaceVisibility')}"]`)
    expect(visibility.attributes('aria-checked')).toBe('true')
    await visibility.trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenCalledWith({
      showInWorkspace: false,
      modelIds: ['free-model']
    })
    expect(visibility.attributes('aria-checked')).toBe('false')
  })
  it('starts hidden and saves the workspace toggle and individual model choices', async () => {
    const { wrapper, api } = await setup()
    const visibility = wrapper.get(`[role="switch"][aria-label="${t('workspaceVisibility')}"]`)
    expect(visibility.attributes('aria-checked')).toBe('false')
    await visibility.trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenLastCalledWith({
      showInWorkspace: true,
      modelIds: []
    })
    await wrapper.get('[data-testid="opencode-model-free-model"] [role="switch"]').trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenLastCalledWith({
      showInWorkspace: true,
      modelIds: ['free-model']
    })
    await visibility.trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenLastCalledWith({
      showInWorkspace: false,
      modelIds: ['free-model']
    })
  })
  it('shows immediate loading feedback while the connection request is pending', async () => {
    const { api, state } = await setup()
    let finish!: (value: OpenCodeFreeState) => void
    api.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    button(t('moreActions')).click()
    await flushPromises()
    button(t('test')).click()
    await flushPromises()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(button(t('moreActions')).getAttribute('aria-expanded')).toBe('false')
    expect(toast.loading).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    finish(state)
    await flushPromises()
    expect(toast.success).toHaveBeenCalledWith(t('errors.CONNECTED'), {
      id: 'opencode-progress',
      duration: 5000,
      description: 'HTTP 200'
    })
  })
  it('explains a blocked selection without calling the model-selection IPC', async () => {
    const { wrapper, api } = await setup()
    button(t('select'), wrapper.get('[data-testid="opencode-model-unsupported"]').element).click()
    await flushPromises()
    expect(toast.warning).toHaveBeenCalledWith(t('errors.PROTOCOL_NOT_VERIFIED'), {
      description: 'unsupported',
      duration: 5000
    })
    expect(api.select).not.toHaveBeenCalled()
  })
  it('shows a connection result as a toast only after clicking test', async () => {
    const { wrapper, api } = await setup()
    expect(toast.success).not.toHaveBeenCalled()
    button(t('moreActions')).click()
    await flushPromises()
    button(t('test')).click()
    await flushPromises()
    expect(api.test).toHaveBeenCalledWith('connection')
    expect(toast.success).toHaveBeenCalledWith(t('errors.CONNECTED'), {
      id: 'opencode-progress',
      duration: 5000,
      description: 'HTTP 200'
    })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(t('lastResult'))
  })
  it('shows model rejection in an error toast instead of treating a resolved IPC call as success', async () => {
    const { wrapper, api, state } = await setup()
    api.test.mockResolvedValueOnce({
      ...state,
      error: 'FREE_TIER_RESTRICTED',
      httpStatus: 403,
      models: state.models.map((m) =>
        m.id === 'free-model'
          ? { ...m, status: 'restricted', errorCode: 'FREE_TIER_RESTRICTED' }
          : m
      )
    })
    await wrapper
      .get('[data-testid="opencode-model-free-model"] button:not([role="switch"])')
      .trigger('click')
    await flushPromises()
    button(t('confirmVerify')).click()
    await flushPromises()
    expect(toast.error).toHaveBeenCalledWith(t('errors.FREE_TIER_RESTRICTED'), {
      id: 'opencode-progress',
      duration: 5000,
      description: 'free-model · HTTP 403'
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="opencode-model-free-model"]').text()).toContain(
      t('values.restricted')
    )
  })
  it.each(['MODEL_UNAVAILABLE', 'OPERATION_IN_PROGRESS'])(
    'explains %s without blaming connectivity',
    async (code) => {
      const { wrapper, api } = await setup(verified(current(), 'paid-model'))
      api.setWorkspaceVisibility.mockRejectedValueOnce(
        Object.assign(new Error(code), {
          payload: { code: 'VALIDATION_ERROR', message: code, userMessage: code }
        })
      )
      await wrapper
        .get('[data-testid="opencode-model-paid-model"] [role="switch"]')
        .trigger('click')
      await flushPromises()
      expect(toast.error).toHaveBeenCalledWith(t(`errors.${code}`))
      expect(
        wrapper
          .get('[data-testid="opencode-model-paid-model"] [role="switch"]')
          .attributes('aria-checked')
      ).toBe('false')
      expect(api.test).not.toHaveBeenCalled()
    }
  )
  it('enables a verified paid model alongside older hidden choices without another inference request', async () => {
    const source = verified(current(), 'paid-model')
    source.workspaceModelIds = ['test', 'retired-model']
    source.showInWorkspace = true
    const { wrapper, api } = await setup(source)
    await wrapper.get('[data-testid="opencode-model-paid-model"] [role="switch"]').trigger('click')
    await flushPromises()
    expect(api.setWorkspaceVisibility).toHaveBeenCalledWith({
      showInWorkspace: true,
      modelIds: ['test', 'retired-model', 'paid-model']
    })
    expect(
      wrapper
        .get('[data-testid="opencode-model-paid-model"] [role="switch"]')
        .attributes('aria-checked')
    ).toBe('true')
    expect(api.test).not.toHaveBeenCalled()
    expect(api.select).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
  it('reports rejected requests as a safe error toast', async () => {
    await setup().then(({ api }) =>
      api.test.mockRejectedValueOnce(new Error('private upstream data'))
    )
    button(t('moreActions')).click()
    await flushPromises()
    button(t('test')).click()
    await flushPromises()
    expect(toast.error).toHaveBeenCalledWith(t('failed'), {
      id: 'opencode-progress',
      duration: 5000
    })
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('private upstream data')
  })
  it('hides unknown catalog entries and explains unsupported paid models', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid="opencode-model-test"]').exists()).toBe(false)
    const row = wrapper.get('[data-testid="opencode-model-unsupported"]')
    expect(row.text()).toContain(t('viewReason'))
    expect(row.get('button:not([role="switch"])').attributes('disabled')).toBeUndefined()
    await row.get('button:not([role="switch"])').trigger('click')
    expect(toast.warning).toHaveBeenCalledWith(t('errors.PROTOCOL_NOT_VERIFIED'), {
      description: 'unsupported',
      duration: 5000
    })
    expect(
      wrapper
        .get('[data-testid="opencode-model-paid-model"] button:not([role="switch"])')
        .attributes('disabled')
    ).toBeUndefined()
  })
  it('requires a per-model paid confirmation, while free verification needs no paid permission', async () => {
    const { wrapper, api } = await setup()
    await wrapper
      .get('[data-testid="opencode-model-paid-model"] button:not([role="switch"])')
      .trigger('click')
    await flushPromises()
    expect(api.test).not.toHaveBeenCalled()
    expect(button(t('confirmVerify')).disabled).toBe(true)
    const dialog = document.body.querySelector('[role="dialog"]')!
    dialog.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
    await flushPromises()
    button(t('confirmVerify')).click()
    await flushPromises()
    expect(api.test).toHaveBeenCalledWith(
      'paid-model',
      expect.objectContaining({ confirmInference: true, allowPaid: true })
    )
    await wrapper
      .get('[data-testid="opencode-model-free-model"] button:not([role="switch"])')
      .trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[role="dialog"] [role="switch"]')).toBeNull()
    button(t('confirmVerify')).click()
    await flushPromises()
    expect(api.test).toHaveBeenLastCalledWith(
      'free-model',
      expect.objectContaining({
        confirmInference: true,
        allowPaid: false
      })
    )
  })
  it('reveals a saved key only on request and clears it when hidden or closed', async () => {
    const { api } = await setup()
    expect(api.revealCredential).not.toHaveBeenCalled()
    button(`${t('editKey')} Personal`).click()
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="password"]'
    )!
    expect(input.value).toBe('')
    button(t('show')).click()
    await flushPromises()
    expect(api.revealCredential).toHaveBeenCalledWith('default')
    expect(input.value).toBe('fixture-saved-key')
    expect(input.type).toBe('text')
    button(t('hide')).click()
    await flushPromises()
    expect(input.value).toBe('')
    button(t('cancel')).click()
    await flushPromises()
    expect(document.body.textContent).not.toContain('fixture-saved-key')
  })
  it('discards a saved-key response after its dialog closes and reopens', async () => {
    const { api } = await setup()
    let resolve!: (key: string) => void
    api.revealCredential.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    button(`${t('show')} Personal`).click()
    await flushPromises()
    button(t('cancel')).click()
    await flushPromises()
    button(t('addKey')).click()
    await flushPromises()
    resolve('fixture-late-key')
    await flushPromises()
    expect(
      document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')?.value
    ).toBe('')
    expect(
      document.body.querySelector('[role="dialog"] input[type="text"][autocomplete="off"]')
    ).toBeNull()
  })
})
