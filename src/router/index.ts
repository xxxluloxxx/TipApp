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
    {
      path: '/cuentas',
      name: 'accounts',
      component: () => import('@/views/AccountsView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 1.1/9 de account-detail-ux.md: detalle de una cuenta. Sin
    // colisión de segmento literal-vs-dinámico (`/cuentas` es la única ruta
    // literal bajo ese prefijo), no requiere orden especial.
    {
      path: '/cuentas/:id',
      name: 'account-detail',
      component: () => import('@/views/AccountDetailView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 2 de account-transfers-ux.md: 1 sola ruta, sin detalle. Sin
    // colisión de segmento literal-vs-dinámico, no requiere orden especial.
    {
      path: '/transferencias',
      name: 'account-transfers',
      component: () => import('@/views/AccountTransfersView.vue'),
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
    // Sección 2 de debts-ux.md: dashboard + detalle, sin colisión de
    // segmento literal-vs-dinámico (a diferencia de /tarjetas), no hace
    // falta ningún orden especial.
    {
      path: '/deudas',
      name: 'debts',
      component: () => import('@/views/DebtsDashboardView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 4.1 de debts-ux.md: gestión de personas de deuda en ruta
    // dedicada, declarada antes de la dinámica `/deudas/:id` (mismo criterio
    // defensivo que `/tarjetas/gestionar` antes de `/tarjetas/:id`).
    {
      path: '/deudas/personas',
      name: 'debt-people',
      component: () => import('@/views/DebtPeopleView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/deudas/:id',
      name: 'debt-detail',
      component: () => import('@/views/DebtDetailView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 2/13 de fixed-expenses-ux.md: dashboard + comparación mensual.
    // Ambos segmentos literales, sin colisión con ningún `:id` dinámico, no
    // requiere orden especial.
    {
      path: '/gastos-fijos',
      name: 'fixed-expenses',
      component: () => import('@/views/FixedExpensesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/gastos-fijos/comparacion',
      name: 'fixed-expenses-comparison',
      component: () => import('@/views/FixedExpensesComparisonView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 3 de loans-ux.md: lista + detalle, sin colisión de segmento
    // literal-vs-dinámico (como Deudas/Partidos), no hace falta orden especial.
    {
      path: '/prestamos',
      name: 'loans',
      component: () => import('@/views/LoansListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/prestamos/:id',
      name: 'loan-detail',
      component: () => import('@/views/LoanDetailView.vue'),
      meta: { requiresAuth: true },
    },
    // Sección 2 de live-matches-ux.md: dashboard + detalle, sin colisión de
    // segmento literal-vs-dinámico (como Deudas), no hace falta orden especial.
    {
      path: '/partidos',
      name: 'matches',
      component: () => import('@/views/LiveMatchesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/partidos/:id',
      name: 'match-detail',
      component: () => import('@/views/MatchDetailView.vue'),
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
