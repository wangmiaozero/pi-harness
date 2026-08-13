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
      path: '/config',
      name: 'config',
      component: () => import('@renderer/views/ConfigView.vue'),
      meta: { title: 'Config', i18nKey: 'nav.config' }
    },
    {
      path: '/diagnostics',
      name: 'diagnostics',
      component: () => import('@renderer/views/DiagnosticsView.vue'),
      meta: { title: 'Diagnostics', i18nKey: 'nav.diagnostics' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@renderer/views/SettingsView.vue'),
      meta: { title: 'Settings', i18nKey: 'nav.settings' }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

export default router
