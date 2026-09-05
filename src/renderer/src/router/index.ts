import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: () => import('@renderer/views/OverviewView.vue'),
      meta: { title: 'Overview', i18nKey: 'nav.overview' }
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
      path: '/providers',
      name: 'providers',
      component: () => import('@renderer/views/ProvidersView.vue'),
      meta: { title: 'Providers', i18nKey: 'nav.providers' }
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('@renderer/views/ModelsView.vue'),
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
