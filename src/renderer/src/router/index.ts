import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/settings/overview'
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: () => import('@renderer/views/WorkspaceView.vue'),
      meta: { title: 'Workspace', i18nKey: 'nav.workspace' }
    },
    {
      path: '/git',
      name: 'git',
      component: () => import('@renderer/views/GitView.vue'),
      meta: { title: 'Git', i18nKey: 'nav.git' }
    },
    {
      path: '/ai-sessions',
      name: 'ai-sessions',
      component: () => import('@renderer/views/UniversalSessionsView.vue'),
      meta: { title: 'AI Sessions', i18nKey: 'nav.aiSessions' }
    },
    {
      path: '/providers',
      redirect: (to) => ({
        path: '/models',
        query: { ...to.query, tab: 'providers' }
      })
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('@renderer/views/ModelManagementView.vue'),
      meta: { title: 'Models', i18nKey: 'nav.models' }
    },
    {
      path: '/skills',
      name: 'skills',
      component: () => import('@renderer/views/SkillsView.vue'),
      meta: { title: 'Skills', i18nKey: 'nav.skills' }
    },
    {
      path: '/settings',
      component: () => import('@renderer/views/SettingsLayout.vue'),
      meta: { title: 'Settings', i18nKey: 'nav.settings' },
      children: [
        { path: '', redirect: '/settings/general' },
        {
          path: 'overview',
          name: 'settings-overview',
          component: () => import('@renderer/views/OverviewView.vue'),
          meta: { title: 'Overview', i18nKey: 'nav.overview' }
        },
        {
          path: 'config',
          name: 'config',
          component: () => import('@renderer/views/ConfigView.vue'),
          meta: { title: 'Config', i18nKey: 'nav.config' }
        },
        {
          path: 'diagnostics',
          name: 'diagnostics',
          component: () => import('@renderer/views/DiagnosticsView.vue'),
          meta: { title: 'Diagnostics', i18nKey: 'nav.diagnostics' }
        },
        {
          path: 'ai',
          name: 'settings-ai',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'ai' },
          meta: { i18nKey: 'agentSettings.ai' }
        },
        {
          path: 'voice',
          name: 'settings-voice',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'voice' },
          meta: { i18nKey: 'agentSettings.voice' }
        },
        {
          path: 'shortcuts',
          name: 'settings-shortcuts',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'shortcuts' },
          meta: { i18nKey: 'agentSettings.shortcuts' }
        },
        {
          path: 'instructions',
          name: 'settings-instructions',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'instructions' },
          meta: { i18nKey: 'agentSettings.instructions' }
        },
        {
          path: 'mcp',
          name: 'settings-mcp',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'mcp' },
          meta: { i18nKey: 'agentSettings.mcp' }
        },
        {
          path: 'subagents',
          name: 'settings-subagents',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'subagents' },
          meta: { i18nKey: 'agentSettings.subagents' }
        },
        {
          path: 'remote',
          name: 'settings-remote',
          component: () => import('@renderer/views/AgentSettingsView.vue'),
          props: { section: 'remote' },
          meta: { i18nKey: 'agentSettings.remote' }
        },
        {
          path: ':section',
          name: 'settings',
          component: () => import('@renderer/views/SettingsView.vue'),
          meta: { title: 'Settings', i18nKey: 'nav.settings' }
        }
      ]
    },
    { path: '/config', redirect: '/settings/config' },
    { path: '/diagnostics', redirect: '/settings/diagnostics' },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

export default router
