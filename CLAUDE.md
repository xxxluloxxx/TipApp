# CLAUDE.md — TipApp

Contexto del proyecto para futuras sesiones. Este archivo es un índice de
alto nivel: para el detalle de cada feature, consultar su doc en
`docs/features/*.md` (fuente de verdad de UX/decisiones puntuales) antes de
tocar esas pantallas.

## Qué es TipApp

App **mono-usuario** de control de gastos, ingresos y deudas personales.
Cada usuario registra movimientos (gastos/ingresos) imputados a una **cuenta**
propia (billetera, banco, efectivo…) y, en gastos, clasificados en categorías
(default o custom). El saldo de cada cuenta es un acumulado all-time
(saldo inicial + ingresos − gastos + impacto de caja de deudas vinculadas),
no un corte mensual. Además lleva un registro de **deudas/préstamos** 1:1
(a quién le prestó / quién le prestó) con saldo corriente por
contraparte+dirección. Opcionalmente, presupuestos por categoría/mes. Es una
**PWA instalable**.

**Fuera de alcance en v1**: gastos compartidos/grupales tipo Splitwise (no hay
grupos, miembros, splits ni settlement entre usuarios reales). "Deudas/
Préstamos" y "Préstamos" **no son** eso: son registros personales 1:1, sin
login/invitación de la contraparte.

**Feature de utilidad no financiera (intencional)**: **"Iron"** (consumo de
tabaco). Convive a propósito con el dominio financiero en la misma PWA (mismo
login). No es una inconsistencia de producto.

**Feature eliminada (2026-11-17)**: **"Partidos en vivo" + cupones de apuestas**
(rutas `/partidos`, Edge Functions `add-match`/`search-matches`/`create-bet-slip`/
`poll-matches`, tablas `live_matches`/`bet_slip*`/`push_subscriptions`, Web Push,
OCR con Tesseract). Su cron `poll_matches_every_20s` llenó `cron.job_run_details`
(1,4 GB) y el proyecto superó la cuota free de 500 MB (`exceed_db_size_quota`,
HTTP 402: Auth/API bloqueadas). Migración `20261117100000_remove_live_matches.sql`.
Las migraciones `20260717*`/`20260718*` quedan como historial. **Si se agrega otro
cron frecuente de `pg_cron`, programar también una limpieza de
`cron.job_run_details`.** Secretos de Edge Functions ya sin uso (borrar si
siguen): `FLASHSCORE_FSIGN`, `VAPID_*`, `CRON_SECRET`.

## Stack

- **Vue 3 + TypeScript** (`<script setup lang="ts">`), **Vite**.
- **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions, free
  tier). RLS **obligatorio** en toda tabla accesible desde el cliente (la
  `anon key` es pública). Proyecto remoto real: ref `jgdenlrceubawwmknzcb`.
- **Vercel** (free tier): deploys automáticos por push a `main`.
- **Tailwind CSS v4** (config CSS-first vía `@theme` en `src/assets/main.css`,
  sin `tailwind.config.js`) + **shadcn-vue** (Reka UI). Tokens en
  `docs/design-system.md`.
- Fuente **Inter** self-hosted (`@fontsource/inter`, sin CDN).

Todo elegido para permanecer dentro de los planes gratuitos.

## Convenciones y principios (no negociables)

- **Seguridad primero**: RLS siempre activo (policies explícitas por
  operación, `user_id = auth.uid()`); `service_role key` **nunca** en el
  frontend (solo en Edge Functions).
- **Estado siempre derivado en el servidor**: saldos/totales/estados salen de
  **vistas SQL** (`account_balances`, `debt_balances`, `loan_progress`,
  etc.), **nunca** resumiendo listas cacheadas en cliente
  (que están capadas a 200 filas). Las comparaciones mes a mes usan queries
  acotadas por rango de fecha, no la lista en memoria.
- **Navegación**: **drawer lateral** (`Sheet`) con todas las secciones, más una
  **barra inferior fija** (`BottomNav.vue`) con Inicio/Transacciones/Cuentas
  (pedido del usuario). Sin sidebar persistente en desktop, sin flecha
  "Volver" en headers (se eliminó en commit `60ec21d`).
- **Accesibilidad**: color nunca como único indicador de estado (badges con
  ícono+texto, hallazgo CVD rojo↔verde); área táctil mínima 44×44px;
  `text-base` (16px) piso en `<input>` (evita auto-zoom iOS); foco visible.
- **Secretos fuera del repo**: `.env.local` gitignored, `.env.example`
  plantilla, variables sensibles solo en Vercel / `supabase secrets`.
- **Incremental y verificable**: features chicas de punta a punta; `npm run
  build` (`vue-tsc --build` + `vite build`) limpio antes de cerrar.
- **`npx shadcn-vue add <x>`**: revisar SIEMPRE el diff de `src/assets/
  main.css` después — el comando suele meter boilerplate no pedido (imports
  de Google Fonts, `@layer base` duplicado). Revertir con `git checkout`.

## Patrones de mutación

- **Optimista con rollback** (mayoría): mutación local inmediata + toast
  "Reintentar" si falla (gastos, ingresos, categorías, deudas, cuentas,
  cuotas de préstamo, etc.).
- **NO optimista** (dependen de un RPC atómico server-side que devuelve ids
  reales): `create_debt`, `create_loan`,
  `create_account_transfer` (+ update/delete), `pay_fixed_expense_instance`. El cliente no puede fabricar los ids/filas
  dependientes de antemano.

## Inventario de features

| Feature | Rutas | Doc de UX |
|---|---|---|
| Auth + Gastos (MVP) | `/login`, `/registro`, `/` | `expenses-mvp-ux.md` |
| Categorías | `/categorias` | `categories-mvp-ux.md` |
| Dashboard de Inicio | `/` (hero, dona, tendencia) | `dashboard-redesign-ux.md` |
| Estadísticas / Reportes | `/estadisticas`, `/reportes` | `dashboard-redesign-ux.md` |
| Ajustes (tema + color acento) | `/ajustes` | `theme-toggle-ux.md`, `accent-color-ux.md` |
| Tarjetas de crédito | `/tarjetas`, `/tarjetas/transacciones`, `/tarjetas/:id`, `/tarjetas/gestionar` | `credit-cards-ux.md` |
| Cuentas + Ingresos | `/cuentas`, `/cuentas/:id` | `accounts-income-ux.md`, `account-detail-ux.md` |
| Transferencias | `/transferencias` | `account-transfers-ux.md` |
| Deudas/Préstamos (1:1) | `/deudas`, `/deudas/:id`, `/deudas/personas` | `debts-ux.md` |
| Gastos fijos | `/gastos-fijos` | `fixed-expenses-ux.md` |
| Préstamos (en cuotas) | `/prestamos`, `/prestamos/:id` | `loans-ux.md` |
| Ahorro programado | `/ahorros` | `savings-plans-ux.md` |
| Iron (consumo de tabaco) | `/iron`, `/iron/historial`, `/iron/tendencias` | `iron-ux.md` |

Otros docs: `nav-drawer-ux.md` (la barra inferior `BottomNav.vue` se agregó después, sin doc propio), `icon-color-chip-ux.md`, `design-system.md`.

## Decisiones clave no obvias del código

Cosas que muerden si no se conocen de antemano:

- **Deudas ≠ Gastos fijos en impacto contable**: pagar/ampliar una **deuda**
  vinculada a una cuenta ajusta `account_balances` pero **nunca** genera fila
  en `expenses`/`incomes` ni aparece en Transacciones (prestar plata no es un
  gasto). En cambio, marcar un **gasto fijo** como pagado **sí** genera un
  `expenses` real. **Préstamos** (en cuotas) está **100% aislado**: ni toca
  `expenses`/`incomes` ni `account_balances`.
- **Transferencias**: el monto transferido nunca genera `expenses`/`incomes`
  (misma plata del usuario, solo cambia de cuenta). La **comisión**, si `> 0`,
  sí genera un `expenses` real (categoría "Comisiones bancarias"). La comisión
  impacta el saldo **solo** vía ese expense — `account_balances` resta únicamente
  `amount` en la cuenta origen para no contarla dos veces.
- **`update_account_transfer` es la única edición del proyecto que NO preserva
  el `id`** (borra + recrea, devuelve id nuevo). El frontend nunca debe asumir
  que el id de una transferencia sobrevive a una edición.
- **`debt_people` ≠ `card_people`**: son entidades separadas (se revirtió el
  reuso). Personas de deuda se gestionan en `/deudas/personas`; personas de
  tarjeta en `/tarjetas/gestionar`.
- **`categories.color`/`accounts.color`/`icon` son `text` libre sin check en
  BD**; la paleta/set fijos son restricción solo de frontend (`src/lib/
  colors.ts`, `accountIcons.ts`).
- **Categorías default** tienen `user_id null` (solo lectura para todos);
  custom tienen `user_id`. Categoría "General" de cuenta y "Comisiones
  bancarias"/"Ajuste de saldo" se resuelven **por nombre**, nunca por id
  hardcodeado.

## Arquitectura (referencia rápida)

**Backend** — migraciones en `supabase/migrations/`, aplicadas al remoto real
(`supabase db push`). Tablas núcleo: `profiles`, `categories`, `expenses`,
`incomes`, `accounts`, `budgets`, `credit_cards`/`card_people`/`card_expenses`,
`debts`/`debt_movements`/`debt_people`, `account_transfers`,
`fixed_expenses`/`fixed_expense_instances`, `loans`/`loan_installments`/
`loan_debtors`/`loan_debtor_payments`, `savings_plans`/
`savings_plan_installments`, `iron_*`. Vistas derivadas
(`security_invoker=true`) para todos los saldos/estados. RPCs atómicas para las
operaciones no-optimistas (ver arriba). Sin Edge Functions ni crons hoy. Tipos en
`src/types/database.types.ts` — regenerar tras cambios de esquema:
`npx supabase gen types typescript --project-id jgdenlrceubawwmknzcb >
src/types/database.types.ts`.

**Frontend** — Pinia stores por dominio (`src/stores/`), Vue Router con guard
global `beforeEach` (espera resolución de sesión, evita flash). Cliente tipado
`src/lib/supabase.ts` (nunca `service_role`). Helpers en `src/lib/`
(`charts.ts` — gráficos SVG a mano, sin librería, para que el tema cambie
gratis; `date.ts`, `currency.ts`, `colors.ts`, `transactionItems.ts`,
etc.). Límites defensivos `MAX_* = 200` sin paginación.

**PWA** — `vite-plugin-pwa` en modo `injectManifest` (SW a mano en `src/sw.ts`),
`registerType: autoUpdate`, sin `runtimeCaching` de Supabase (siempre red).

## Deuda técnica conocida

- **La mayoría de las features no se probaron manualmente end-to-end en el
  navegador contra el Supabase real** — caveat recurrente de casi todas las
  iteraciones. La verificación típica fue build + revisión de código + pruebas
  SQL/RPC directas contra el remoto (Préstamos sí tuvo un E2E headless real,
  20/20 checks). Ver checklist en "Próximos pasos".
- **Usuarios de prueba sin borrar** en `auth.users` del remoto
  (`claude-search-matches-test-*`, `claude-loans-e2e-test-*`) — inofensivos
  (sin acceso a datos ajenos), pendientes de borrado manual si se quiere dejar
  `auth.users` prolijo.
- **Sin paginación**: todos los listados usan `MAX_* = 200` defensivo. Las
  tablas que más crecen (`expenses`, `account_transfers`, `fixed_expense_
  instances`) no tienen archivado.
- **CVD**: par de colores de categoría Vivienda `#8b5cf6` / Transporte
  `#3b82f6` no separa bien para daltonismo (mitigado por nombre en texto).
  Revalidar la paleta con `validate_palette.js` si se siembra otra categoría.
- **Orden de categorías default** no garantizado (sin columna `sort_order`,
  todas comparten `created_at` del seed).
- **Sin estrategia offline real de datos**: la shell carga de cache pero toda
  pantalla que dependa de Supabase muestra su estado de error sin red.
- **Casos borde de Préstamos** sin probar: editar (campos bloqueados post-alta),
  eliminar (cascade completo), tab Historial con préstamo 100% pagado.
- **Auth en producción**: evaluar SMTP propio y política de `enable_confirmations`
  / longitud mínima de contraseña (default 6 vs. validación de cliente 8) antes
  de invitar usuarios reales.

## Próximos pasos (orden sugerido)

1. **Prueba manual E2E en el navegador** contra el Supabase real, recorriendo:
   auth → dashboard → transacciones (alta/edición/borrado) → categorías →
   tarjetas → cuentas (+ detalle, ajuste de saldo, gráfico 30 días) →
   transferencias (con/sin comisión, editar → id nuevo, borrar → reversión) →
   deudas (+ personas, movimiento vinculado a cuenta sin fila en Transacciones)
   → gastos fijos (generación perezosa, marcar pagado → expense real) →
   préstamos → ahorro programado → instalación
   real como PWA en celular (Chrome Android / Safari iOS).
2. **Presupuestos** (`budgets`, la tabla ya existe): pantalla por categoría/mes
   con barra de progreso — diseñar primero con `ui-ux-designer`.
3. **Reportes reales**: reemplazar el placeholder "Próximamente" de `/reportes`.
4. **`sort_order` en `categories`** si el orden fijo necesita quedar garantizado.
5. **Migración de paleta de categorías** (fix CVD Vivienda/Transporte) — trabajo
   conjunto `supabase-backend-expert` + `ui-ux-designer`.
6. **`AppShell` compartido / sidebar desktop** si se quiere, una vez estable el
   número de secciones.
7. **Estrategia offline** (opcional): cachear último snapshot de datos.
8. **Futuro, fuera de v1**: gastos compartidos/grupales tipo Splitwise
   (requiere rediseño de esquema y UX; no mezclar con el modelo mono-usuario).
