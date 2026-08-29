import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { SessionInfo, SessionProjectGroup } from '@shared/types/workspace'
import { buildSessionForkTree, groupSessionsByProject } from '@shared/workspace/session-tree'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { callApi, getApi } from '@renderer/composables/useApi'

export const useSessionStore = defineStore('sessions', () => {
  const items = shallowRef<SessionInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentId = ref<string | null>(null)
  const currentProjectKey = ref<string | null>(null)

  const projects = computed(() => groupSessionsByProject(items.value))
  const currentProject = computed(
    () => projects.value.find((p) => p.projectKey === currentProjectKey.value) ?? null
  )
  const current = computed(() => items.value.find((s) => s.id === currentId.value) ?? null)
  const forkTree = computed(() => {
    const project = currentProject.value
    return buildSessionForkTree(project?.sessions ?? items.value)
  })

  async function refresh(force = false) {
    loading.value = true
    error.value = null
    try {
      const persisted = await callApi(() => getApi().sessions.list(force))
      const persistedIds = new Set(persisted.map((session) => session.id))
      const transients = items.value.filter(
        (session) => session.transient && !persistedIds.has(session.id)
      )
      items.value = [...transients, ...persisted]
      if (currentId.value && !items.value.some((session) => session.id === currentId.value)) {
        currentId.value = null
      }
      const selected = items.value.find((session) => session.id === currentId.value)
      if (selected?.projectKey) currentProjectKey.value = selected.projectKey
      if (!currentProjectKey.value && items.value[0]?.projectKey) {
        currentProjectKey.value = items.value[0].projectKey
      }
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  function selectProject(project: SessionProjectGroup) {
    currentProjectKey.value = project.projectKey
  }

  function selectProjectKey(projectKey: string | null) {
    currentProjectKey.value = projectKey
  }

  function selectSession(id: string | null) {
    currentId.value = id
    const session = items.value.find((s) => s.id === id)
    if (session?.projectKey) currentProjectKey.value = session.projectKey
  }

  function addTransientSession(sessionId: string, cwd: string, firstMessage: string) {
    if (items.value.some((session) => session.id === sessionId)) return
    const timestamp = new Date().toISOString()
    items.value = [
      {
        path: '',
        id: sessionId,
        cwd,
        created: timestamp,
        modified: timestamp,
        messageCount: 1,
        firstMessage,
        projectRoot: cwd,
        projectKey: projectIdentityKey(cwd),
        transient: true
      },
      ...items.value
    ]
  }

  function removeTransientSession(sessionId: string) {
    items.value = items.value.filter(
      (session) => session.id !== sessionId || session.transient !== true
    )
  }

  return {
    items,
    loading,
    error,
    currentId,
    currentProjectKey,
    projects,
    currentProject,
    current,
    forkTree,
    refresh,
    selectProject,
    selectProjectKey,
    selectSession,
    addTransientSession,
    removeTransientSession
  }
})
