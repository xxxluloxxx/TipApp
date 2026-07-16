import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/registro',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// Guard global (sección 4.2 de expenses-mvp-ux.md). `initialize()` está
// memoizada en el store, así que aunque el guard corra en cada navegación,
// la resolución real de sesión (getSession + suscripción) ocurre una sola
// vez por carga de la app.
router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  await authStore.initialize()

  const isAuthenticated = authStore.status === 'authenticated'

  if (to.meta.requiresAuth && !isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.meta.guestOnly && isAuthenticated) {
    return { name: 'home' }
  }

  return true
})

export default router
