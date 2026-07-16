# CLAUDE.md — TipApp

Contexto resumido del proyecto para futuras sesiones de Claude Code.

## Qué es TipApp

TipApp v1 es una app de **control de gastos personales de un solo usuario**:
cada usuario registra sus propios gastos, los clasifica en categorías
(default o custom) y, opcionalmente, define presupuestos por categoría/mes.
Con vocación de PWA instalable.

**Fuera de alcance explícito en v1**: gastos compartidos/grupales tipo
Splitwise — no hay grupos, miembros de grupo, splits de gasto entre personas,
ni conceptos de deuda/settlement. Es una iteración futura, no confundir el
modelo de datos actual (mono-usuario) con eso.

El proyecto se construye de forma incremental: primero se validó el pipeline
de deploy con un esqueleto mínimo, luego backend (Supabase) y sistema de
diseño en paralelo, y a continuación pantallas de features reales, PWA y
router/estado global — cada iteración separada y verificable.

## Stack elegido y por qué

- **Vue 3 + TypeScript** (`<script setup lang="ts">`): framework reactivo
  moderno, tipado fuerte, buen soporte de PWA vía plugins de Vite.
- **Vite**: dev server rápido, build simple, integración directa con
  `vite-plugin-pwa` cuando se agregue soporte PWA (todavía no instalado).
- **Supabase** (Postgres + Auth + Storage + Realtime, plan gratuito): backend
  como servicio para no operar infraestructura propia en esta etapa. RLS
  (Row Level Security) es obligatorio en toda tabla accesible desde el
  cliente, ya que la `anon key` es pública. Proyecto remoto real ya creado y
  en uso desde el frontend (ver sección siguiente).
- **Vercel** (plan gratuito): hosting con deploys automáticos por push,
  preview deploys por rama/PR, y manejo simple de variables de entorno.
- **Tailwind CSS v4 + shadcn-vue (Reka UI)**: sistema de diseño utilitario y
  componentes accesibles reusables. Ya instalado y configurado con los tokens
  definidos por `ui-ux-designer` (ver abajo).

Todo el stack se eligió priorizando permanecer dentro de los límites de los
planes gratuitos de Supabase y Vercel.

## Estado actual (esta iteración)

Se agregó **gestión de categorías propias del usuario** (crear/editar/
eliminar) sobre la base ya existente de autenticación + listado de gastos +
alta/edición de gastos. No fue necesaria ninguna migración: el esquema de
`categories` ya tenía `icon`/`color` y RLS completo para las operaciones de
escritura sobre categorías propias, y `expenses.category_id` ya tiene
`on delete restrict`, lo que ya bloqueaba a nivel de BD borrar una categoría
con gastos asociados. Todo el trabajo de esta iteración fue diseño (UX) +
frontend.

- Especificación funcional/UX completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/categories-mvp-ux.md`
  (`ui-ux-designer`) — consultar antes de tocar la pantalla `/categorias` o
  el Sheet de alta/edición de categoría. Decisiones clave: ruta dedicada
  `/categorias` (no Sheet/modal, es una pantalla de gestión de baja
  frecuencia, no un formulario puntual); sin selector de ícono en el
  formulario en v1 (el campo `icon` se muestra para las default pero queda
  `NULL` para las custom, porque nada más en el frontend lo consume
  todavía); paleta de color como grid fijo de 10 swatches (los mismos hex ya
  sembrados en las categorías default) en vez de un color picker libre;
  guardado de categoría **no optimista** (a diferencia de gastos) porque
  queda un caso real de conflicto server-only (nombre duplicado en carrera,
  índice único de Postgres); borrado de categoría sí optimista, con
  "Eliminar" deshabilitado de antemano (no reactivamente) cuando la
  categoría tiene gastos asociados, calculado con un conteo dedicado al
  cargar la pantalla — sin ningún flujo de reasignación masiva de gastos
  (fuera de alcance, la restricción de BD ya cubre el caso real).
- `src/stores/categories.ts` (nuevo, `vue-frontend-expert`): store separado
  de `expenses.ts` (antes las categorías vivían ahí) — dueño único del
  estado de categorías (`categories`, `defaultCategories`,
  `customCategories`, `expenseCounts`), con `fetchCategories`,
  `fetchExpenseCounts` (conteo por categoría propia vía el embed de
  PostgREST `categories?select=id,expenses(count)`, no reutiliza la lista
  de `expenses.ts` que tiene `LIMIT 200` y subcontaría en cuentas grandes),
  `addCategory`/`updateCategory` (no optimistas, devuelven
  `{ category }` o `{ errorCode }` para que el Sheet decida la rama de UI
  sin try/catch) y `deleteCategory` (optimista con rollback). `expenses.ts`
  importa este store puntualmente (una sola dirección de dependencia, sin
  ciclo) para resolver la categoría del gasto optimista; re-exporta
  `Category` para no romper imports existentes.
- `src/views/CategoriesView.vue` (nuevo) y
  `src/components/CategoryFormSheet.vue` (nuevo): pantalla `/categorias` y
  su Sheet de alta/edición, siguiendo el doc de UX al pie de la letra
  (estados de carga/vacío/error, validación de nombre duplicado en cliente
  contra defaults+propias con backstop del error Postgres `23505`, grid de
  swatches con `Check` + `aria-pressed`, `AlertDialog` de confirmación de
  borrado igual que en gastos).
- `src/router/index.ts`: nueva ruta `/categorias` (`name: 'categories'`,
  `requiresAuth`). `src/views/HomeView.vue`: nuevo item "Categorías" (ícono
  `Tag`) en el `DropdownMenu` del header, entre el bloque de identidad y
  "Cerrar sesión", cada uno con su propio separador.
- `src/lib/colors.ts`: se exportó `hexToRgb` (antes privado) y se agregó
  `withAlpha(hex, alpha)` para el fondo semitransparente del swatch de
  categoría en `CategoriesView.vue`.
- `npm run build` (`vue-tsc --build` + `vite build`) verificado sin errores
  tras estos cambios.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente contra el Supabase real en el navegador (mismo
  caveat ya existente para gastos, ver abajo) — en particular, el query de
  conteo embebido (`categories?select=id,expenses(count)`) no se ejecutó
  contra datos reales en esta sesión (sin acceso de red), solo se validó
  que compila con los tipos existentes (con un cast puntual documentado en
  `src/stores/categories.ts`, porque `database.types.ts` no modela la forma
  del agregado embebido de PostgREST). Recomendado probarlo manualmente
  antes de dar la feature por cerrada.
- El campo `icon` sigue sin ser editable por el usuario (deliberado, ver
  arriba) — si en el futuro se decide agregarlo, el doc de UX ya deja
  anotado el camino de menor esfuerzo (un `<Input>` de texto libre, no un
  picker dedicado).

Primera feature real de punta a punta implementada previamente: **autenticación +
listado de gastos + alta/edición de gastos**, conectada al Supabase remoto
real. `src/App.vue` ya NO es la demo del sistema de diseño — es el shell
raíz de la app (splash de sesión + `<router-view>` + `<Toaster>`).

### Frontend de features (Vue Router + Pinia + Supabase client) — implementado y verificado

- Especificación funcional/UX completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/expenses-mvp-ux.md`
  (`ui-ux-designer`) — fuente de verdad de cada decisión de copy/validación/
  estado; consultar antes de tocar estas pantallas.
- Cliente Supabase tipado: `src/lib/supabase.ts` (`createClient<Database>`,
  lee `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, throw descriptivo si
  faltan, nunca usa `service_role`).
- Helpers: `src/lib/date.ts` (encabezados de grupo "Hoy"/"Ayer"/fecha en
  español, valor de `<input type=date>`, validación de fecha futura),
  `src/lib/currency.ts` (formato `es-AR`), `src/lib/colors.ts` (contraste de
  texto sobre el color hex de cada categoría).
- Pinia: `src/stores/auth.ts` (estado `pending|authenticated|unauthenticated`,
  `initialize()` memoizada + `onAuthStateChange`, `signIn/signUp/signOut`,
  perfil desde `profiles`) y `src/stores/expenses.ts` (gastos + categorías
  default/custom, `monthTotal` computado, `fetchAll/fetchCategories` y
  `addExpense/updateExpense/deleteExpense` con **actualización optimista**:
  mutación local inmediata + confirmación/rollback en segundo plano vía toast
  con acción "Reintentar").
- Vue Router (`src/router/index.ts`): rutas `/login`, `/registro`, `/`
  (`home`), guard global `beforeEach` que espera la resolución de sesión
  (evita flash de contenido), redirige por `meta.requiresAuth`/`guestOnly`
  preservando `?redirect=`.
- Vistas: `src/views/LoginView.vue`, `RegisterView.vue` (maneja los dos casos
  de `signUp`: auto-confirm vs. confirmación de email pendiente),
  `HomeView.vue` (hero de total del mes, listado agrupado por día, estados
  vacío/carga/error, FAB de agregar, logout vía dropdown). Sheet compartido
  de alta/edición: `src/components/ExpenseFormSheet.vue`.
- Componente `Alert`/`AlertDescription`/`AlertTitle` agregado a mano en
  `src/components/ui/alert/` (no existía previamente en la Fase 1 del
  design system pero es imprescindible para errores inline de login/
  registro) siguiendo el mismo patrón `cva`/`cn`/`data-slot` que el resto de
  `src/components/ui/`.
- `npm run build` (type-check con `vue-tsc --build` + `vite build`)
  verificado sin errores.

**Deuda técnica conocida**:
- El orden fijo de las categorías default en el Select (Comida, Transporte,
  ...) se asume ordenando por `created_at` asc, porque no existe una columna
  `sort_order`/`position` en `categories`. Como las 10 quedaron con el mismo
  `created_at` (un solo INSERT del seed), el orden real depende de cómo
  Postgres devuelve las filas — funciona hoy pero no está garantizado. Si el
  orden de categorías importa a futuro, agregar `sort_order` con
  `supabase-backend-expert`.
- Edición y borrado de gastos se implementaron también (no eran requisito de
  esta iteración) reusando el mismo patrón optimista — sin verificación
  manual exhaustiva de todos sus casos borde.
- No se probó manualmente el flujo completo contra el proyecto Supabase real
  (signup → confirmar si aplica → login → alta de gasto → logout) en el
  navegador; la verificación de esta iteración fue build + revisión de
  código. Recomendado como siguiente paso antes de dar la feature por
  cerrada en producción.

### Backend (Supabase) — proyecto remoto real, creado y en uso

Proyecto remoto "TipApp" (ref `jgdenlrceubawwmknzcb`) ya creado, linkeado y
con las migraciones aplicadas (`db push` hecho) — ya NO es solo un esquema
local sin desplegar. El frontend de esta iteración se conecta a este
proyecto real con las env vars ya configuradas en `.env.local` y en Vercel.

- Esquema en `/home/lulo/Proyectos/Propios/TipApp/supabase/migrations/`:
  - `20260716142005_profiles_init.sql` — `profiles` 1:1 con `auth.users`,
    trigger `handle_new_user()` que crea el profile automáticamente al
    registrarse.
  - `20260716142006_categories_init.sql` — `categories` con `user_id`
    nullable (`NULL` = categoría default del sistema, no editable; no-NULL =
    categoría custom del usuario dueño), seed de 10 categorías default.
  - `20260716142008_expenses_init.sql` — `expenses` (monto `numeric(12,2)
    check > 0`, categoría, fecha, descripción, dueño), con validación de que
    la categoría sea accesible por el usuario.
  - `20260716142009_budgets_init.sql` — `budgets` opcional por
    categoría/mes.
  - `20260716142010_rls_policies.sql` — RLS activado + políticas explícitas
    por operación (select/insert/update/delete) en las 4 tablas: cada
    usuario solo ve/edita sus propios `expenses`/`budgets`/`profile`, y sus
    categorías custom (las default son de solo lectura para todos).
- **Auth**: email/password (elegido por simplicidad de MVP frente a magic
  link/OTP; ver justificación completa en el historial de la sesión que
  definió el esquema).
- Migraciones validadas originalmente contra una instancia Supabase local
  real (Docker), y ya aplicadas también al proyecto remoto vía
  `supabase db push`.
- Tipos TypeScript en
  `/home/lulo/Proyectos/Propios/TipApp/src/types/database.types.ts`,
  consumidos por el cliente tipado del frontend (`src/lib/supabase.ts`) y
  por los stores de Pinia. Si el esquema remoto cambia, regenerar con
  `npx supabase gen types typescript --project-id jgdenlrceubawwmknzcb > src/types/database.types.ts`.
- `/home/lulo/Proyectos/Propios/TipApp/.env.local` (no versionado) ya tiene
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` reales; `.env.example` sigue
  como plantilla vacía. Mismas env vars ya configuradas en el panel de
  Vercel (Production/Preview/Development).
- `supabase` CLI instalado como devDependency del proyecto (no global).

**Pendiente opcional** (no bloquea el uso actual, evaluar antes de invitar
usuarios reales fuera de pruebas propias):
- Configurar SMTP propio en Auth si se quiere confirmación de email
  confiable en producción (hoy corre con el proveedor de email default de
  Supabase, con límites bajos de envío).
- Evaluar si `enable_confirmations` (confirmación de email obligatoria)
  debe estar activo o no — el frontend ya contempla ambos casos (ver
  sección siguiente), así que este es un cambio de configuración libre de
  riesgo para el frontend.
- Alinear el mínimo de longitud de contraseña de Supabase Auth (default 6)
  a 8, para que coincida con la validación de cliente en `/registro`.

### Sistema de diseño (Tailwind + shadcn-vue) — instalado y verificado

- Especificación completa (paleta light/dark, tipografía, espaciado, radios,
  componentes priorizados, a11y) en
  `/home/lulo/Proyectos/Propios/TipApp/docs/design-system.md` — consultar
  antes de crear cualquier pantalla nueva, tomar los valores literalmente.
- Tailwind CSS v4 (`@tailwindcss/vite`, config CSS-first vía `@theme` en
  `/home/lulo/Proyectos/Propios/TipApp/src/assets/main.css`, sin
  `tailwind.config.js`).
- shadcn-vue 2.8.0 sobre Reka UI. Componentes instalados (Fase 1 del doc de
  diseño) en `/home/lulo/Proyectos/Propios/TipApp/src/components/ui/`:
  Button, Input, Label, Card, Select, Badge, Sheet, Alert Dialog, Dropdown
  Menu, Separator, Sonner, Skeleton. Fase 2 (Progress, Tabs, Combobox,
  Calendar) queda para cuando exista la pantalla de presupuestos.
- Fuente Inter self-hosted vía `@fontsource/inter` (sin depender de CDN
  externo).
- Tokens de color/radio en `:root`/`.dark` copiados literalmente del doc de
  diseño; `success`/`warning` agregados como tokens custom (shadcn no los
  trae de fábrica) para estados de presupuesto.
- Botones (`default`/`icon`) ajustados a `h-11`/`size-11` (44px) para cumplir
  el mínimo táctil exigido por el doc de a11y — afecta a todo botón del
  proyecto, no solo la demo.
- Fase 2 de componentes (Progress, Tabs, Combobox, Calendar) sigue pendiente
  para cuando exista la pantalla de presupuestos/reportes.
- Se agregó `Alert`/`AlertDescription`/`AlertTitle` en
  `src/components/ui/alert/` (no estaba en el inventario original de Fase 1,
  pero era imprescindible para los errores inline de login/registro) — sigue
  el mismo patrón `cva`/`cn`/`data-slot` que el resto de componentes.
- `src/App.vue` ya NO es la demo del sistema de diseño — ahora es el shell
  raíz real de la app (splash de sesión + `<router-view>` + `<Toaster>`, ver
  sección de frontend de features arriba). La demo fue completamente
  reemplazada.
- `npm run build` (incluye `vue-tsc --build`) verificado sin errores tras
  estos cambios.

**No asumir** todavía: no hay PWA (manifest/service worker), no hay
presupuestos (`budgets`) conectados a ninguna pantalla, no hay filtros de
fecha/reportes, no hay gastos compartidos/grupales.

## Próximos pasos previstos (orden sugerido)

1. **Probar manualmente el flujo end-to-end en el navegador** contra el
   Supabase real: signup → (confirmar email si `enable_confirmations` está
   activo) → login → agregar/editar/eliminar gasto → **crear/editar/
   eliminar categoría propia desde `/categorias`, incluyendo intentar
   borrar una con gastos asociados (debe quedar deshabilitado)** → logout →
   refresh de página (verificar que no hay flash de contenido). No se hizo
   en esta iteración ni en la anterior (la verificación fue build + revisión
   de código) — recomendado antes de dar cualquiera de las dos features por
   cerrada en producción.
2. **PWA real**: manifest, service worker, estrategia offline con
   `vite-plugin-pwa` — a cargo de `vue-frontend-expert`. Candidata natural a
   seguir ahora que hay pantallas reales que instalar/cachear.
3. **Presupuestos** (`budgets`, ya existe la tabla): pantalla de definir
   presupuesto por categoría/mes y barra de progreso (componente `Progress`,
   Fase 2 del design system) — diseñar primero con `ui-ux-designer`.
4. **Filtros/reportes**: vista "Este mes"/"Mes anterior" (componente `Tabs`,
   ya previsto) y filtro de rango de fechas (`Calendar`+`Popover`) sobre el
   listado all-time actual.
5. **Revisar el orden de categorías default**: agregar columna `sort_order`
   en `categories` con `supabase-backend-expert` si el orden fijo de
   categorías (Comida, Transporte, ...) necesita quedar garantizado (ver
   deuda técnica arriba).
6. **Iteración futura (fuera de alcance de v1)**: gastos compartidos/
   grupales tipo Splitwise — grupos, miembros, splits, deuda/settlement.
   Requiere rediseño de esquema (tablas de grupos/miembros) y de UX; no
   mezclar con el modelo mono-usuario actual.

## Convenciones y principios del proyecto

- Seguridad primero: RLS siempre activo (políticas explícitas por
  operación), `service_role key` nunca en el frontend.
- Secretos fuera del repo: `.env.local` gitignored, `.env.example` como
  plantilla, variables sensibles solo en el panel de Vercel.
- Incremental y verificable: features pequeñas de punta a punta, probadas
  antes de seguir con lo siguiente (build ok, flujo probado, RLS verificado).
- Free tier: priorizar soluciones dentro de los límites gratuitos de
  Supabase y Vercel.
- Mobile-first: `text-base` (16px) como piso en cualquier `<input>` (evita
  auto-zoom de iOS), área táctil mínima 44×44px, foco visible siempre, color
  nunca como único indicador de estado.
