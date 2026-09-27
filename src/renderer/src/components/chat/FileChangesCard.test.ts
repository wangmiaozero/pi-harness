import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import FileChangesCard from './FileChangesCard.vue'
import type { MessageFileChanges } from './message-file-changes'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const changes: MessageFileChanges = {
  runId: 'run-1',
  status: 'verified',
  additions: 9,
  deletions: 2,
  files: [
    file('one', 'src/one.ts', 4, 1),
    file('two', 'src/two.ts', 3, 1),
    file('three', 'src/three.ts', 2, 0),
    file('four', 'src/four.ts', 0, 0)
  ]
}

describe('FileChangesCard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('expands overflow files and opens a saved diff preview', async () => {
    const wrapper = mount(FileChangesCard, {
      props: { changes },
      global: { mocks: { $t: (key: string) => key } }
    })

    expect(wrapper.findAll('[data-testid^="message-file-change-"]')).toHaveLength(3)
    await wrapper.get('[data-testid="message-file-changes-expand"]').trigger('click')
    expect(wrapper.findAll('[data-testid^="message-file-change-"]')).toHaveLength(4)

    await wrapper.get('[data-testid="message-file-change-one"]').trigger('click')
    const workspace = useWorkspaceStore()
    expect(workspace.activeTab).toMatchObject({
      kind: 'diff',
      title: 'src/one.ts',
      filePath: '/repo/src/one.ts'
    })
    expect(workspace.activeDiffPreview).toBe('@@ -1 +1 @@\n-old\n+new')
  })

  it('shows a verification failure instead of a fabricated file list', () => {
    const wrapper = mount(FileChangesCard, {
      props: {
        changes: {
          runId: 'run-2',
          status: 'missing-evidence',
          additions: 0,
          deletions: 0,
          files: []
        }
      },
      global: { mocks: { $t: (key: string) => key } }
    })

    expect(wrapper.get('[data-testid="message-file-changes-missing"]')).toBeTruthy()
    expect(wrapper.find('[data-testid^="message-file-change-"]').exists()).toBe(false)
  })
})

function file(id: string, displayPath: string, additions: number, deletions: number) {
  return {
    artifactId: id,
    name: displayPath.split('/').at(-1)!,
    path: `/repo/${displayPath}`,
    displayPath,
    additions,
    deletions,
    patch: '@@ -1 +1 @@\n-old\n+new',
    patchTruncated: false
  }
}
