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
    {
      path: '/categorias',
      name: 'categories',
      component: () => import('@/views/CategoriesView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 8 de credit-cards-ux.md: las rutas literales
    // (/tarjetas/transacciones, /tarjetas/gestionar) van antes que la
    // dinámica (/tarjetas/:id), práctica defensiva estándar.
    {
      path: '/tarjetas',
      name: 'cards',
      component: () => import('@/views/CardsDashboardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tarjetas/transacciones',
      name: 'card-transactions',
      component: () => import('@/views/CardTransactionsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tarjetas/gestionar',
      name: 'manage-cards',
      component: () => import('@/views/ManageCardsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tarjetas/:id',
      name: 'card-detail',
      component: () => import('@/views/CardDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/transacciones',
      name: 'transactions',
      component: () => import('@/views/TransactionsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/estadisticas',
      name: 'statistics',
      component: () => import('@/views/StatisticsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reportes',
      name: 'reports',
      component: () => import('@/views/ReportsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/ajustes',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
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
