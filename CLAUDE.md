# CLAUDE.md — TipApp

Contexto resumido del proyecto para futuras sesiones de Claude Code.

## Qué es TipApp

TipApp v1 es una app de **control de gastos, ingresos y deudas personales de
un solo usuario**: cada usuario registra sus movimientos (gastos e ingresos),
imputados a una **cuenta** propia (billetera, banco, efectivo, etc.) y, en el
caso de los gastos, clasificados en categorías (default o custom). El saldo
de cada cuenta es un acumulado all-time (saldo inicial + ingresos - gastos de
esa cuenta, más el impacto de caja de cualquier deuda vinculada a esa cuenta,
ver "Deudas/Préstamos" abajo), no un corte mensual. Además, el usuario puede
llevar un registro personal de **deudas/préstamos** (a quién le prestó plata
o quién le prestó a él) con saldo corriente por contraparte+dirección.
Opcionalmente define presupuestos por categoría/mes. Ya es una **PWA
instalable** (ver sección de estado actual).

**Fuera de alcance explícito en v1**: gastos compartidos/grupales tipo
Splitwise — no hay grupos, miembros de grupo, splits de gasto entre personas,
ni settlement automático entre usuarios reales de TipApp. "Deudas/Préstamos"
(ver arriba) **no es** eso: es un registro personal 1:1 sin login/invitación
de la contraparte, mismo criterio "sin multi-usuario real" ya usado para
`card_people`. No confundir el modelo de datos actual con gastos
compartidos/grupales.

**Nota de alcance**: además del dominio financiero descrito arriba, TipApp
incorpora una feature de utilidad personal sin relación con gastos/ingresos —
**"Partidos en vivo"** (seguimiento de partidos de fútbol + cupones de
apuestas, ver "Estado actual" abajo), pedida explícitamente por el Product
Owner como una sección más del drawer. Es intencional que conviva con el
dominio financiero en la misma PWA (misma app instalada, mismo login), no una
inconsistencia de producto.

El proyecto se construye de forma incremental: primero se validó el pipeline
de deploy con un esqueleto mínimo, luego backend (Supabase) y sistema de
diseño en paralelo, y a continuación pantallas de features reales, PWA y
router/estado global — cada iteración separada y verificable.

## Stack elegido y por qué

- **Vue 3 + TypeScript** (`<script setup lang="ts">`): framework reactivo
  moderno, tipado fuerte, buen soporte de PWA vía plugins de Vite.
- **Vite**: dev server rápido, build simple, integración directa con
  `vite-plugin-pwa` (ya instalado y configurado, ver estado actual).
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

Se agregó **Partidos en vivo**, una feature de utilidad personal sin
relación con el dominio financiero de la app (ver nota de alcance arriba):
seguimiento de partidos de fútbol en vivo (feeds no oficiales de
Flashscore) con notificaciones push cuando cambian stats relevantes (gol,
tarjeta = prioridad alta; córner, remate = prioridad normal), y adjunto
opcional de una foto de cupón de apuestas cuyas selecciones se intentan
marcar ganadas/perdidas/pendientes a medida que el partido avanza.
Inspirada en un proyecto Android existente del usuario, FottStat
(`/home/lulo/Proyectos/Propios/FottStat`, fuera de este repo) — se replicó
su *funcionalidad*, no su implementación nativa. Decisión de arquitectura
clave, tomada por el Product Owner antes de delegar: a diferencia del
original (que usa un Foreground Service Android), acá el polling **no
depende del cliente/navegador abierto** — corre 100% server-side. Trabajo
de las tres capas (`ui-ux-designer` → `supabase-backend-expert` →
`vue-frontend-expert`, coordinados por `product-owner-tipapp`).

- **Backend** (`supabase-backend-expert`): 7 migraciones nuevas en
  `supabase/migrations/` (`20260717150300` a `20260717150900`), aplicadas
  al proyecto remoto real vía `supabase db push`.
  - `live_matches(id, user_id, flashscore_mid, home_team, away_team,
    state, last_snapshot, etag_dc/etag_df_st/etag_df_su, created_at,
    updated_at)` — un partido monitoreado por el usuario; los `etag_*`
    cachean la respuesta del feed de Flashscore entre polls (evita
    reprocesar si no cambió nada). Igual que el original, solo guarda el
    **último** snapshot, no historial — no había razón concreta para más.
  - `bet_slip_legs(id, user_id, live_match_id on delete cascade, pick,
    market, market_type, threshold, status)` — selecciones del cupón,
    hijas de un partido (mismo criterio de `on delete cascade` que
    `debt_movements` respecto de `debts`: no tiene sentido un leg sin su
    partido).
  - `push_subscriptions(id, user_id, endpoint, keys, created_at)` — una
    suscripción Web Push por dispositivo/navegador del usuario, primera
    tabla de este tipo en el proyecto.
  - RLS explícito por operación en las 3 tablas, mismo patrón
    `user_id = auth.uid()` de siempre.
  - RPC `create_live_match` (`security invoker`, mismo patrón que
    `create_debt`): inserta el partido y hace el primer poll sincrónico
    para no dejar una fila sin datos hasta el próximo ciclo de cron.
  - 3 Edge Functions desplegadas (`supabase functions deploy`):
    `add-match` (JWT de usuario, invoca la RPC), `poll-matches` (corre por
    `pg_cron` cada 20s con `service_role`, motor de reglas de apuestas +
    envío de Web Push en cambios relevantes), `ocr-betslip` (JWT de
    usuario, ver deuda técnica abajo). Lógica compartida en
    `supabase/functions/_shared/` (`flashscoreClient`/`flashscoreFeed`
    para el feed propietario con delimitadores `~`/`¬`/`÷`,
    `betRuleEngine`/`marketMapper`/`betSlipParser`, `webpush`), portada
    del Kotlin/Python original de FottStat (`PLAN.md`/`fottstat.py`) a
    TypeScript.
  - `pg_cron`/`pg_net` habilitados en el proyecto remoto (no estaban
    activos) — el cron de `poll-matches` corre cada 20s en producción real
    (mejor que el piso de 60s anticipado; `pg_cron` 1.6.4 sí soporta
    segundos).
  - Secrets configurados vía `supabase secrets set` (nunca hardcodeados ni
    commiteados): `FLASHSCORE_FSIGN` (token del feed no oficial, ver deuda
    técnica), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Web
    Push), `CRON_SECRET`.
  - Verificado: RLS con dos usuarios reales, motor de reglas contra 68
    casos literales tomados de `PLAN.md`, `add-match` probado de punta a
    punta contra un partido real de Flashscore.
  - `src/types/database.types.ts` regenerado.
- **Diseño** (`ui-ux-designer`): especificación completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/live-matches-ux.md` —
  consultar antes de tocar `/partidos`, `/partidos/:id` o cualquier
  componente de `Match*`. Decisiones clave: 2 rutas (`/partidos` dashboard
  de cards + `/partidos/:id` detalle), ítem de drawer "Partidos en vivo" en
  6ª posición de 10, Sheet de alta en wizard de 3 pasos (URL → foto de
  cupón opcional con preview de legs detectados → confirmar), reloj de
  partido tickeando localmente en cliente entre polls (no un valor estático
  hasta el próximo refetch), banner + toggle de notificaciones en Ajustes
  con copy explícito de la limitación de Web Push en iOS (solo funciona con
  la PWA instalada a la pantalla de inicio).
- **Frontend** (`vue-frontend-expert`): store `src/stores/liveMatches.ts`
  (optimista en pausar/reanudar/quitar; **no** optimista en el alta, mismo
  motivo que `debts.createDebt` — depende de una RPC server-side que ya
  hace el primer poll) y `src/stores/pushNotifications.ts` (suscripción Web
  Push). Vistas nuevas `LiveMatchesView.vue` (`/partidos`) y
  `MatchDetailView.vue` (`/partidos/:id`). Componentes nuevos
  `MatchFormSheet.vue`, `MatchStatsRow.vue`, `MatchLegsSummary.vue`.
  Helpers `src/lib/matchClock.ts`, `src/lib/matchDisplay.ts`,
  `src/lib/relativeTime.ts`, `src/lib/pushSupport.ts`. **Migración de
  `vite-plugin-pwa` de `generateSW` a `injectManifest`**
  (`vite.config.ts`): necesaria porque Web Push requiere listeners propios
  de `push`/`notificationclick` en el service worker, que `generateSW` no
  permite agregar — el SW ahora se escribe a mano en `src/sw.ts` (Vite lo
  compila con esbuild e inyecta el precache en `self.__WB_MANIFEST`),
  preservando el precache/auto-update que ya funcionaba en producción.
  `src/sw.ts` excluido del type-check de `vue-tsc --build`
  (`tsconfig.app.json`) porque corre en contexto Service Worker
  (`WebWorker`), no DOM. `env.d.ts` tipa `VITE_VAPID_PUBLIC_KEY` (clave
  pública, segura de exponer en cliente — la privada vive solo en las Edge
  Functions). `src/views/HomeView.vue`: ítem de drawer nuevo.
  `SettingsView.vue`: toggle de notificaciones push.
  - `npm run build` (`vue-tsc --build` + `vite build`) verificado sin
    errores, tanto por el agente como de forma independiente por el
    Product Owner.
- **Deploy**: a diferencia de todas las iteraciones previas (donde el
  commit/push quedaba pendiente de revisión del usuario), acá el Product
  Owner autorizó explícitamente commit + push + verificación de deploy
  como parte del mismo encargo. Commit `e31af94` en `main`, pusheado, y
  deploy a producción en Vercel verificado directamente vía la API de
  Vercel (`readyState: READY`, build limpio en 16s, alias
  `tip-app-lac.vercel.app` actualizado) — primera vez que se verifica el
  deploy real de esta forma en vez de asumirlo por el auto-deploy de
  Vercel.

**Deuda técnica nueva de esta iteración**:
- **El OCR del cupón no funciona hoy** — no es una limitación teórica, se
  probó y falla: Tesseract.js no corre en el runtime de las Supabase Edge
  Functions (Deno Deploy), `Worker.prototype.constructor` no está
  implementado ahí. El flujo degrada correctamente (avisa "no encontramos
  selecciones, continuá sin cupón" en vez de romperse), pero ningún cupón
  se lee de verdad todavía. Resolverlo requiere una API de visión externa
  (Google Vision, AWS Textract, etc.) — decisión pendiente del Product
  Owner (qué proveedor, nueva API key), evaluada y diferida explícitamente
  en esta iteración, no un olvido.
- **Falta agregar `VITE_VAPID_PUBLIC_KEY` al panel de Vercel**
  (Production/Preview/Development) — hoy solo está en `.env.local`
  (gitignored). Sin esto, el toggle de notificaciones push va a fallar en
  producción aunque el resto del deploy esté OK. Pendiente para la próxima
  sesión (requiere `vercel-devops-expert` o acceso al dashboard, no se hizo
  en esta iteración porque implica tocar configuración compartida de
  Vercel sin la CLI instalada localmente).
- No se probó de punta a punta con un partido en vivo real recibiendo una
  notificación push real en un dispositivo (mismo caveat recurrente de
  todas las iteraciones del proyecto: verificación de esta sesión fue
  build + revisión de código + deploy verificado, no un flujo manual
  completo en el navegador/celular).
- El feed de Flashscore es no oficial (`flashscore.ninja`) y el token
  `x-fsign` es estático — podría rotar y romper el polling sin aviso,
  igual que en el proyecto Android original. Aislado como secret
  (`FLASHSCORE_FSIGN`) para poder actualizarlo sin tocar código si rota.
- Sin archivado automático de partidos finalizados — decisión de producto
  explícitamente diferida, no un olvido.

Se **separó `card_people` de las contrapartes de deuda** (revierte
parcialmente una decisión de arquitectura tomada en la iteración anterior,
"Deudas/Préstamos Fase 2" más abajo). Pedido explícito del Product Owner: son
personas conceptualmente distintas ("quién usa mi tarjeta adicional" no es lo
mismo que "a quién le presto o me presta plata") y mezclarlas en una sola
lista generaba confusión real en los selectores de "Persona" de ambos flujos.
Trabajo de las tres capas, backend y diseño corrieron en paralelo (mismo
criterio que Deudas Fase 2: ambos partieron de la misma decisión de dominio ya
tomada por el Product Owner, sin necesidad de re-sincronizarse).

- **Backend** (`supabase-backend-expert`): 3 migraciones nuevas en
  `supabase/migrations/` (`20260717150000` a `20260717150200`), aplicadas al
  proyecto remoto real vía `supabase db push`.
  - `debt_people(id, user_id, name, color, created_at, updated_at)` — tabla
    nueva, mismo patrón exacto que `card_people` (sin fila "default del
    sistema", sin avatar/foto). RLS activo, mismo patrón de policies
    explícitas por operación que el resto del esquema.
    `20260717150000_debt_people_init.sql`.
  - RLS de `debt_people` en migración separada (mismo criterio que
    `debts`/`debt_movements`: init nunca bundlea RLS).
    `20260717150100_debt_people_rls.sql`.
  - `debts.person_id` repuntado de `card_people` a `debt_people`
    (`20260717150200_debts_person_id_migrate_to_debt_people.sql`):
    `debts_validate_owner()` reescrita para validar contra `debt_people`,
    comentarios SQL de `debts`/`debts.person_id` corregidos. **Backfill**: se
    verificó contra el proyecto remoto antes de escribir la migración —
    existía **1 fila real** en `debts` (única deuda cargada hasta ahora),
    referenciando 1 fila de `card_people` ("Jhair"). Se migró preservando el
    **mismo `id`** al insertar la fila equivalente en `debt_people` (en vez de
    generar un id nuevo y reasignar por `user_id`+nombre) — como
    `debts.person_id` ya apuntaba a ese id, esto deja la FK nueva válida sin
    tocar una sola fila de `debts`, y evita cualquier ambigüedad si dos
    personas del mismo usuario comparten nombre. A partir de acá ambas tablas
    son independientes: cambios futuros en una no se reflejan en la otra, es
    el punto central del pedido de separación.
  - `debt_balances` (la vista de saldo agregado) **no se tocó** — sigue sin
    incluir `person_id`/nombre (el frontend ya lo resolvía aparte contra un
    store de personas, ahora `debtPeopleStore` en vez de `cardPeopleStore`).
  - Guard de borrado de `card_people` (`src/stores/cardPeople.ts`,
    `fetchExpenseCounts`) revertido a contar solo `card_expenses(count)` — ya
    no suma `debts(count)`, porque `debts.person_id` ya no referencia
    `card_people`. **Esto deja obsoleta la nota de la iteración anterior que
    describía ese conteo combinado** (ver más abajo, sección "Deudas/Préstamos
    Fase 2").
  - `src/types/database.types.ts` regenerado.
- **Diseño** (`ui-ux-designer`): actualización de
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/debts-ux.md` — la
  sección 4 ("Selector de contraparte — reuso de `card_people`") quedó
  **reemplazada por completo** por una nueva sección 4 ("Personas de deuda —
  entidad propia, con pantalla de gestión dedicada"). Decisión clave: ruta
  dedicada nueva `/deudas/personas` (no una sección embebida en el dashboard
  de `/deudas`) — mismo precedente que ya resolvió Tarjetas con
  `/tarjetas/gestionar` (4ª ruta dedicada para gestión de una entidad
  secundaria de bajo uso, separada de la pantalla de panorama/analytics).
  Deudas pasa de 2 a 3 rutas (no reabre el "ni 1 ni 4" de la sección 2
  original: es un eje distinto, gestión de una segunda entidad). Sheet de
  alta/edición idéntico en campos al de `card_people` (nombre + color opcional
  de 10 swatches + "Sin color"), guard de borrado más simple (un único
  conteo `debts(count)`, esta entidad no tiene un segundo consumidor como sí
  tiene `card_people` con `card_expenses`). Sin ítem nuevo en el nav drawer
  (mismo criterio que `/tarjetas/gestionar`): se llega por un botón
  `Settings` nuevo en el header de `/deudas` y por el atajo "Agregar persona
  nueva" del Sheet de alta de deuda.
- **Frontend** (`vue-frontend-expert`, modelo Opus): store nuevo
  `src/stores/debtPeople.ts` (mismo patrón 1:1 que `cardPeople.ts`:
  alta/edición/borrado 100% optimistas con rollback, conteo dedicado
  `debts(count)` vía `fetchDebtCounts()`). Vista nueva
  `src/views/DebtPeopleView.vue` (mismo patrón visual que `ManageCardsView`
  pero con una sola sección/entidad; soporta `?new=1` para abrir el Sheet de
  alta al montar, mismo patrón ya usado en `AccountsView`/`TransactionsView`).
  Componente nuevo `src/components/DebtPersonFormSheet.vue` (basado en
  `CardPersonFormSheet.vue`, mismo patrón, distinto store/copy). Ruta nueva
  `/deudas/personas` (`debt-people`) en `src/router/index.ts`, declarada
  **antes** de `/deudas/:id` (mismo criterio defensivo que
  `/tarjetas/gestionar` antes de `/tarjetas/:id`). Actualizados para resolver
  `personName`/consumir el store nuevo en vez de `cardPeopleStore`:
  `src/stores/debts.ts`, `src/views/DebtsDashboardView.vue` (+ botón
  `Settings` nuevo en el header, `<h1>` pasa a `flex-1`),
  `src/views/DebtDetailView.vue`, `src/components/DebtFormSheet.vue` (el
  `Select` de "Contraparte" y el atajo "Agregar persona nueva", que ahora
  navega a `{ name: 'debt-people', query: { new: '1' } }` en vez de
  `/tarjetas/gestionar?new=person`). **No se tocó** `card_people`/
  `ManageCardsView.vue`/`CardPersonFormSheet.vue` más allá del guard de
  borrado ya revertido por backend.
  - `npm run build` (`vue-tsc --build` + `vite build`) verificado sin
    errores, tanto por el agente como de forma independiente por el Product
    Owner.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente contra el Supabase real en el navegador el flujo
  completo (crear/editar/borrar una persona de deuda desde `/deudas/personas`,
  el guard de borrado con una deuda asociada, el atajo `?new=1` desde el Sheet
  de alta de deuda, y que el selector de Contraparte ya no muestre las
  personas de tarjeta) — mismo caveat recurrente de todas las iteraciones
  previas, verificación de esta iteración fue build + revisión de código.
  Recomendado antes de dar el cambio por cerrado en producción.
- Las secciones de este documento correspondientes a "Deudas/Préstamos (Fase
  2 de 2)" (más abajo) describen el estado **anterior a este cambio** en
  varios puntos puntuales (contrapartes = `card_people`, guard combinado
  `card_expenses(count) + debts(count)`, selector de contraparte contra
  `cardPeopleStore`, atajo `?new=person` hacia `/tarjetas/gestionar`) — se
  dejaron notas inline en esos puntos exactos marcándolos como reemplazados,
  en vez de reescribir toda la narrativa histórica de esa iteración.

Se agregó **Deudas/Préstamos (Fase 2 de 2)**, completando la feature de
Cuentas que empezó en la iteración anterior (Fase 1: Cuentas + Ingresos, ver
más abajo). El usuario ahora puede registrar a quién le prestó plata o quién
le prestó a él, con saldo corriente por contraparte+dirección que se puede
"subir" (ampliar el préstamo) o "bajar" (abonar/pagar) — a diferencia de un
gasto, no es un monto fijo. Trabajo de las tres capas (backend + UX +
frontend), backend y diseño corrieron en paralelo (ambos partieron del mismo
modelo de datos ya decidido por el Product Owner antes de delegar, así que no
hubo idas y vueltas de re-sincronización entre ellos como en la iteración de
Cuentas).

Dos decisiones de arquitectura, tomadas por el Product Owner antes de
delegar (no las tomó ningún agente por su cuenta):

1. **Las contrapartes de una deuda son las mismas `card_people` que ya usa la
   feature de Tarjetas — no se creó una tabla ni una pantalla de gestión de
   personas nueva.** El guard de borrado de una persona en
   `/tarjetas/gestionar` ahora suma `card_expenses(count) + debts(count)`.
   **[REVERTIDO en la iteración siguiente, ver el bloque al principio de esta
   misma sección "Estado actual"]**: esta decisión se dio vuelta por pedido
   explícito del Product Owner — ahora existe `debt_people`, una tabla
   independiente, y el guard de `card_people` volvió a contar solo
   `card_expenses(count)`.
2. **El vínculo opcional a una cuenta en un movimiento de deuda NO genera
   ninguna fila en `expenses`/`incomes`.** Motivo: `expenses.category_id` es
   `not null` y prestar plata no es, conceptualmente, un gasto (sigue siendo
   plata del usuario, solo que en manos de otra persona) — forzar una
   categoría sintética tipo "Préstamos" habría contaminado categorías/
   presupuestos/`monthTotal`/estadísticas. En cambio, la vista
   `account_balances` (la misma de Fase 1) se extendió para incorporar el
   efectivo real que sale/entra de una cuenta vinculada, con una fórmula de
   signo derivada de la dirección de la deuda (ver detalle en la sección de
   backend abajo). El usuario ve el saldo de su cuenta reflejar la plata
   prestada/recibida, pero **nunca** aparece como una transacción visible en
   ningún listado — el frontend explica esto explícitamente en el formulario
   (ver sección de diseño abajo), porque es contraintuitivo si no se avisa
   antes de usarlo.

- **Backend** (`supabase-backend-expert`): 6 migraciones nuevas en
  `supabase/migrations/` (`20260716142023` a `20260716142028`), aplicadas al
  proyecto remoto real vía `supabase db push` y verificadas con un set de
  pruebas funcionales completo contra un Postgres local (RLS entre dos
  usuarios, triggers de ownership, checks, `on delete cascade`/`restrict`) —
  no solo compilación.
  - `debts(id, user_id, person_id not null → card_people, direction text
    check in ('lent','borrowed'), description, created_at, updated_at)` —
    `'lent'` = yo presté/me deben, `'borrowed'` = me prestaron/yo debo
    (mapeo documentado en `comment on column`, no es obvio del nombre del
    valor).
  - `debt_movements(id, user_id, debt_id not null → debts on delete cascade,
    account_id nullable → accounts on delete restrict, amount numeric(12,2)
    check <> 0, movement_date, description, created_at, updated_at)` —
    `amount` con signo: positivo sube la deuda (incluye el monto inicial al
    crear), negativo la baja (abono/pago). A diferencia del resto del
    esquema (`on delete restrict` en casi todas las FK), acá `debt_id` es
    `on delete cascade` a propósito: un movimiento no tiene sentido de
    existir sin su deuda, y borrar un hilo completo es una operación
    intencional del usuario, no un caso a bloquear.
  - Vista `debt_balances(debt_id, user_id, direction, balance)` —
    `balance = sum(debt_movements.amount)`, `security_invoker = true`, mismo
    patrón que `account_balances`. El saldo de un hilo de deuda **siempre**
    sale de acá, nunca de sumar `debt_movements` en cliente.
  - `account_balances` (la vista de Fase 1) se extendió con un tercer
    subquery agregado por `account_id` sobre `debt_movements` con `account_id
    is not null`, sumado a la fórmula existente
    (`initial_balance + incomes - expenses + debt_cash_impact`). Fórmula de
    signo (derivable de la dirección, sin ambigüedad):
    `direction = 'lent'` → `cash_delta = -amount` (prestar más saca plata de
    la cuenta; cobrar/abonar la devuelve); `direction = 'borrowed'` →
    `cash_delta = amount` (que te presten más mete plata a la cuenta; pagar/
    abonar la saca).
  - Función `create_debt(p_person_id, p_direction, p_amount, p_account_id
    default null, p_movement_date default hoy, p_description default null)
    returns uuid` — `security invoker` (respeta RLS del que llama, sin
    bypass), inserta la cabecera (`debts`) + el primer movimiento
    (`debt_movements`, `amount > 0` forzado) en una única transacción
    implícita, evitando que el frontend haga 2 inserts sueltos y deje una
    cabecera huérfana si el segundo falla.
  - RLS activo en `debts`/`debt_movements`, mismo patrón exacto (policies
    explícitas `select/insert/update/delete`, `user_id = auth.uid()`).
  - Índices agregados pensando en los guards del frontend:
    `debt_movements(account_id)` (para el ajuste de `account_balances` y un
    futuro guard de borrado de cuenta), `debts(person_id)` (para el guard de
    borrado de persona, ver punto 1 arriba).
  - Caso borde señalado a propósito, sin resolver: un abono mayor al saldo
    pendiente deja `debt_balances.balance` negativo — sin constraint que lo
    impida (documentado en `comment on view`), se muestra igual como
    "Saldada" en el frontend, sin un tercer estado especial.
  - `src/types/database.types.ts` regenerado.
- **Diseño** (`ui-ux-designer`): especificación completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/debts-ux.md` —
  consultar antes de tocar `/deudas`, `/deudas/:id` o los Sheets de deuda.
  Decisiones clave:
  - **2 rutas, ni 1 ni 4** (calibrado con el mismo criterio de complejidad
    que Cuentas/Tarjetas): `/deudas` (dashboard: cards resumen, saldo neto,
    `Tabs` Yo presté/Me prestaron/Historial, resumen rápido del mes,
    gráfico) + `/deudas/:id` (detalle de un hilo: ledger completo,
    editar/borrar movimientos, editar/borrar el hilo) — no alcanza con 1
    (a diferencia de Cuentas) porque el encargo pide explícitamente ver/
    editar/borrar movimientos individuales; no hace falta llegar a 4 (como
    Tarjetas) porque no hay una segunda entidad que gestionar ni cruces de
    filtros reales (la única dimensión de filtro es la dirección, resuelta
    por los tabs).
  - **Primer uso real de `Tabs`** de shadcn-vue en el proyecto (estaba
    anotado desde Fase 1 del design system para "cuando exista el primer
    caso genuino") — se distingue del patrón `radiogroup` ya usado en el
    proyecto porque acá son paneles de contenido completos, no un campo de
    formulario.
  - **Selector de contraparte**: `Select` simple sobre
    `cardPeopleStore.people` (sin pantalla nueva), con un link de texto
    siempre visible "Agregar persona nueva" → navega a
    `/tarjetas/gestionar?new=person` (trade-off aceptado: se pierde el
    progreso del Sheet de deuda en curso, aceptado porque Contraparte es el
    segundo campo del formulario). **[REVERTIDO, ver principio de esta
    sección]**: el `Select` ahora consume `debtPeopleStore.people` y el atajo
    navega a `/deudas/personas` (`?new=1`) — el trade-off aceptado sigue
    vigente sin cambios, solo cambió el destino.
  - **Copy del vínculo a cuenta** (la parte más delicada, mismo texto en
    alta y en abono/ampliación, siempre visible, no condicional a haber
    elegido cuenta): *"Si vinculás una cuenta, ajustamos su saldo
    automáticamente por la plata real que sale o entra — pero este
    movimiento **no va a aparecer como gasto ni ingreso** en tus listados,
    solo acá en Deudas."* Cada movimiento vinculado a una cuenta muestra
    además un badge (`Wallet` + nombre) en el ledger para que quede
    trazable después de guardado.
  - **Alta de deuda nueva: única excepción NO optimista del proyecto por un
    motivo nuevo** (distinto del de `CategoryFormSheet`, que es un índice
    único server-only): acá es una dependencia atómica entre 2 inserts vía
    RPC — el cliente no puede insertar optimistamente sin ya tener el
    `debt_id` real que devuelve el servidor. "Subir/bajar" una deuda
    existente sí es 100% optimista, con un mecanismo de "delta seguro"
    (sumar/restar un movimiento sobre un balance ya confirmado por el
    servidor, nunca resumir `debt_movements` desde cero).
  - **`DualTrendChart.vue`, componente nuevo** (no una extensión de
    `TrendAreaChart.vue`): dos líneas con color fijo (`success`/
    `destructive`), mismo Y-scale compartido, granularidad mensual (no
    diaria) — se evaluó extender `TrendAreaChart` y se descartó por 3
    motivos concretos documentados en el doc (contrato de color,
    normalización de eje compartida, granularidad).
  - **Derivación del "saldo de arranque" de la ventana de 12 meses sin sumar
    historial completo**: `saldo_arranque = balance_actual_agregado −
    neto_de_movimientos_dentro_de_la_ventana` (ambos números ya seguros:
    uno agregado server-side sin límite de fecha, el otro acotado por
    fecha) — evita necesitar una función RPC nueva de "saldo a una fecha X".
  - **Borrado de un hilo de deuda completo: sin guard de conteo**, a
    diferencia de categorías/cuentas/tarjetas/personas — un hilo no es
    referenciado por ningún otro recurso (sus movimientos son hijos propios
    en cascada), es equivalente a borrar un gasto/ingreso propio, no un
    recurso de clasificación compartido.
  - Ítem de drawer "Deudas" (`HandCoins`, ya importado en `HomeView.vue`
    desde Fase 1) en 5ª posición, al final del bloque de "dominios de
    movimientos de dinero" (Transacciones/Tarjetas/Cuentas/Deudas) — última
    porque es la de uso esperado menos frecuente de las cuatro.
- **Frontend** (`vue-frontend-expert`): `src/stores/debts.ts` (nuevo) —
  `fetchBalances()` trae todas las filas de `debt_balances` en una query
  (seguro: cardinalidad de "hilos", no de "movimientos"), `createDebt` vía
  RPC (no optimista), `addMovement`/`updateMovement`/`deleteMovement` (100%
  optimistas, mecanismo de delta sobre `balances: Record<string, number>`),
  `deleteDebt` (optimista, sin guard). Incluye `accountDeltaFor(direction,
  amount)` como espejo client-side exacto de la fórmula de signo del backend,
  usado para ajustar optimistamente el saldo cacheado de la cuenta vinculada
  vía `accountsStore.adjustBalance` (mismo mecanismo ya usado por
  `expenses.ts`/`incomes.ts` desde Fase 1). Vistas nuevas:
  `DebtsDashboardView.vue` (`/deudas`), `DebtDetailView.vue` (`/deudas/:id`).
  Componentes nuevos: `DebtFormSheet.vue`, `DebtMovementFormSheet.vue`,
  `src/components/charts/DualTrendChart.vue`. `src/lib/charts.ts`:
  `buildDebtBalanceEvolution` (la derivación de saldo de arranque). `Tabs` de
  shadcn-vue instalado (`npx shadcn-vue add tabs`). `src/stores/
  cardPeople.ts`: `fetchExpenseCounts` ahora suma `card_expenses(count) +
  debts(count)`. `src/views/ManageCardsView.vue`: soporta `?new=person`.
  **[Ambos puntos REVERTIDOS en la iteración siguiente — ver principio de
  esta sección: el guard de `cardPeople.ts` volvió a ser solo
  `card_expenses(count)`, y `?new=person` en `ManageCardsView` quedó sin uso
  real porque el atajo de "Agregar persona nueva" de Deudas ahora apunta a
  `/deudas/personas` en vez de acá]**.
  `src/router/index.ts`: rutas `/deudas`, `/deudas/:id`. `src/views/
  HomeView.vue`: acceso rápido "Deudas" activado (se quitó `disabled`/
  "Próximamente") + ítem de drawer nuevo.
  - **Regresión de `npx shadcn-vue add tabs` detectada y corregida** (mismo
    problema ya visto en la iteración de Tarjetas con `switch`/`textarea`):
    el comando volvió a tocar `src/assets/main.css` sin que se le pidiera
    (`@import` de Google Fonts + `@layer base` duplicado) — se revirtió con
    `git checkout` antes de terminar, dejando `main.css` intacto. Confirma
    la nota ya anotada en la iteración anterior: siempre revisar el diff de
    `main.css` después de `npx shadcn-vue add <lo que sea>`.
  - `npm run build` (`vue-tsc --build` + `vite build`) verificado sin
    errores, tanto por el agente como de forma independiente por el Product
    Owner.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente contra el Supabase real en el navegador (mismo
  caveat recurrente de todas las iteraciones previas) — en particular, no se
  verificó a ojo el flujo completo crear deuda → prestar vinculando una
  cuenta → confirmar que el saldo de esa cuenta bajó sin que aparezca
  ninguna fila nueva en Transacciones → abonar parcialmente → editar/borrar
  un movimiento → borrar el hilo completo. La fórmula de signo del ajuste de
  cuenta (`accountDeltaFor`) se verificó por revisión de código en ambas
  capas (coincide exactamente entre backend y frontend) pero no con datos
  reales de punta a punta. Recomendado antes de dar la feature por cerrada
  en producción.
- El sobrepago (abono mayor al saldo pendiente) queda sin ninguna
  restricción a nivel de BD ni de UI más allá de mostrar "Saldada" — decisión
  deliberada, no un olvido (ver sección de backend arriba).

Se agregó **Cuentas + Ingresos (Fase 1 de 2)**: cada gasto y cada ingreso
pasa a pertenecer a una cuenta propia del usuario (billetera, banco,
efectivo, etc.), con saldo all-time (saldo inicial + ingresos - gastos)
calculado en el servidor. La Fase 2 ("Deudas/Préstamos") es un encargo
aparte, todavía no implementado — solo se dejó un acceso rápido
deshabilitado en el dashboard que anticipa ese lugar. Trabajo de las tres
capas (backend + UX + frontend) en esta iteración, con dos rondas de
backend porque `ui-ux-designer` y `supabase-backend-expert` corrieron en
paralelo y el doc de UX terminó pidiendo un campo (`initial_balance`) que la
primera pasada de backend no había modelado — se resolvió con una migración
adicional antes de pasar a frontend, ver detalle abajo.

- **Backend** (`supabase-backend-expert`, dos rondas): 6 migraciones nuevas
  en `supabase/migrations/` (`20260716142017` a `20260716142022`), todas
  aplicadas al proyecto remoto real vía `supabase db push`.
  - `accounts(id, user_id, name, color, icon, initial_balance numeric(12,2)
    not null default 0, created_at, updated_at)` — mismo patrón que
    `credit_cards` (sin fila "default del sistema", 100% del usuario);
    `color`/`icon` son `text` libres sin `check` en BD (el frontend
    restringe a paleta/set fijos, mismo criterio que `categories.color`).
    `initial_balance` se agregó en una migración separada
    (`20260716142022`) porque el doc de UX (sección 6.3 de
    `accounts-income-ux.md`) lo pidió después de que la primera tanda de
    migraciones ya estuviera en remoto — sin backfill manual necesario,
    `default 0` ya cubre las filas existentes.
  - `incomes(id, user_id, account_id not null → accounts, amount
    numeric(12,2) check > 0, income_date, description, created_at,
    updated_at)` — simétrica a `expenses` pero sin categoría (evaluado y
    descartado explícitamente, ver doc de UX sección 7.2). Trigger
    `incomes_validate_account_trigger` valida que `account_id` pertenezca al
    mismo `user_id`.
  - `expenses.account_id` (`uuid not null → accounts on delete restrict`)
    agregada en 3 pasos (nullable → backfill de una cuenta "General" por
    usuario existente con gastos, asignada a sus gastos → `not null`).
    `expenses_validate_category_trigger`/`expenses_validate_category()` se
    reemplazaron por `expenses_validate_owner_trigger`/
    `expenses_validate_owner()`, que valida `category_id` **y** `account_id`
    en una sola pasada (nombre alineado con `card_expenses_validate_owner`).
  - **Cuenta "General" automática para usuarios nuevos**: se extendió
    `handle_new_user()` (`20260716142005_profiles_init.sql`) para crear,
    además del `profile`, una cuenta "General" (`#6b7280`, ícono `Wallet`) en
    el mismo insert — se prefirió esto sobre forzar un flujo de "creá tu
    primera cuenta" en el frontend, por consistencia con el patrón ya
    existente y para no bloquear el alta del primer gasto/ingreso.
  - **Saldo por cuenta**: vista `public.account_balances(account_id,
    user_id, name, balance)` con `with (security_invoker = true)` —
    `balance = accounts.initial_balance + Σincomes.amount -
    Σexpenses.amount`, agregado en subqueries separadas por tabla antes del
    join final (evita el fan-out cartesiano de unir dos tablas 1-a-muchos
    directamente). Se eligió vista sobre función `rpc` porque no hace falta
    bypassear RLS (`security_invoker` hereda automáticamente las policies
    `select_own` de `accounts`/`incomes`/`expenses`) — más simple y sin el
    riesgo de una `rpc security definer` mal filtrada. Consumida desde el
    frontend como `supabase.from('account_balances').select('*')`, **nunca**
    calculada sumando `expensesStore.expenses`/una lista de ingresos capada
    en cliente (mismo argumento de escala/seguridad que ya motivó
    `isMonthSafeToShow` en `dashboard-redesign-ux.md` y las queries acotadas
    por rango de fecha de `credit-cards-ux.md`).
  - RLS activo en `accounts`/`incomes`, mismo patrón exacto que el resto
    (policies explícitas por operación, scoped a `user_id = auth.uid()`).
  - `src/types/database.types.ts` regenerado dos veces (una por cada ronda
    de migraciones) para reflejar el esquema final.
- **Diseño** (`ui-ux-designer`): especificación completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/accounts-income-ux.md`
  — consultar antes de tocar `AccountsView.vue`, `AccountFormSheet.vue`,
  `TransactionFormSheet.vue`, `HomeView.vue` o `TrendAreaChart.vue`.
  Decisiones clave:
  - **El hero "Total del mes" de Inicio NO se convierte en "saldo total"**:
    conviven. Son preguntas de naturaleza distinta (flujo mensual vs. stock
    actual) y fusionarlas invertiría la semántica de color ya implementada
    del delta "vs. mes anterior" (gastar más = malo; tener más saldo =
    bueno) en un componente ya shippeado y coherente en toda la app. Se
    agrega una sección nueva "Mis cuentas" (grid + saldo total + tile
    "Agregar cuenta") y "Accesos rápidos" inmediatamente debajo del hero
    existente, antes de la dona de categorías (que no cambia).
  - **Paleta de cuentas calibrada y validada**: 8 tonos "jewel tone" nuevos,
    con variante `darkHex` por swatch (`ACCOUNT_COLOR_SWATCHES` en
    `src/lib/colors.ts`, separada de `COLOR_SWATCHES` a propósito — ver
    justificación de "por qué no fragmentar vs. por qué no diluir" en el
    doc, sección 4.4): `#b45309` dorado, `#1d4ed8` azul, `#be123c` granate,
    `#7e22ce` violeta, `#86198f` ciruela, `#0891b2` cian, `#047857`
    esmeralda, `#4d7c0f` oliva. Validada con el script
    `validate_palette.js` de la skill de dataviz en ambos temas.
  - **Set de íconos**: `Wallet`, `PiggyBank`, `Landmark`, `Building2`,
    `ShieldCheck`, `Banknote` (los 6 sugeridos por el Product Owner,
    confirmados en `@lucide/vue`, sin instalar nada).
  - **Mejora de `TrendAreaChart.vue`** (pedido explícito): curva suavizada
    (técnica de punto medio con `Q`, sin librería de spline) + relleno de
    gradiente (antes opacidad plana) — sigue siendo SVG a mano, sin
    dependencias nuevas.
  - **`ExpenseFormSheet.vue` renombrado a `TransactionFormSheet.vue`**: se
    extendió con un toggle Gasto/Ingreso (en vez de crear un Sheet nuevo,
    por la simetría casi total entre ambos modelos) y un `Select` de Cuenta
    nuevo, con default "la cuenta del movimiento más reciente" (no siempre
    "General", para no forzar reselección manual en cada alta).
  - **`/cuentas`** (ruta única, no dashboard/detalle propio como tarjetas):
    listado + Sheet de alta/edición, con **dos guards de borrado** (conteo
    de uso, igual que categorías/tarjetas, y "nunca la última cuenta del
    usuario" — regla nueva, porque todo movimiento necesita una cuenta).
  - **"Deudas" y "Pagos"** en los accesos rápidos: deshabilitados con copy
    "Próximamente" explícito, sin `@click` ni ruta — nunca 404. Solo "Saldo"
    es funcional (navega a `/cuentas`).
- **Frontend** (`vue-frontend-expert`): `src/stores/accounts.ts` (CRUD
  optimista + conteo de uso dedicado + lectura de `account_balances`, con
  `adjustBalance(id, delta)` como único punto de mutación del saldo local
  desde otros stores) y `src/stores/incomes.ts` (mismo patrón que
  `expenses.ts`, sin `monthTotal`). `src/stores/expenses.ts` ahora incluye
  `accountId` en el payload y ajusta el saldo optimista de la cuenta
  correspondiente vía `accountsStore.adjustBalance` en alta/edición/
  borrado. `src/components/TransactionFormSheet.vue` (reemplaza a
  `ExpenseFormSheet.vue`, eliminado) y `src/components/AccountFormSheet.vue`
  (nuevo) y `src/views/AccountsView.vue` (nuevo, ruta `/cuentas`).
  `src/lib/colors.ts`: `ACCOUNT_COLOR_SWATCHES`/`resolveAccountColor`
  agregados como exportaciones nuevas, sin tocar nada existente (en
  particular, sin interferir con el selector de color de acento — ver nota
  abajo). `src/lib/accountIcons.ts` (nuevo). `src/components/charts/
  TrendAreaChart.vue`: curva suavizada + gradiente, mismo contrato de props.
  `src/views/HomeView.vue`: "Mis cuentas" + "Accesos rápidos" + ítem de
  drawer "Cuentas" (`Wallet`, 4ª posición) + "Transacciones recientes"
  mezclando gasto/ingreso con indicador de signo. `src/views/
  TransactionsView.vue`: mismo mezclado, conservando el layout de Card ya
  shippeado (no se migró al estilo de fila plana del ejemplo del doc, que
  solo aplica literal a "Transacciones recientes" de Inicio). `src/router/
  index.ts`: ruta `/cuentas`. `npm run build` (`vue-tsc --build` + `vite
  build`) verificado sin errores, tanto por el agente como de forma
  independiente por el Product Owner (`rm -rf dist && npm run build`).
  - **Nota sobre concurrencia con otra sesión**: mientras esta iteración
    corría, otra sesión completó y **commiteó y pusheó a `main`** (commit
    `6e3c30d`) un selector de color de acento en Ajustes (`docs/features/
    accent-color-ux.md`, cambios en `src/lib/colors.ts`/`src/stores/
    auth.ts`/`src/views/SettingsView.vue`/`index.html`), trabajo
    completamente ajeno a este encargo. Se verificó que no hay conflicto
    real: `ACCOUNT_COLOR_SWATCHES`/`resolveAccountColor` son exportaciones
    nuevas y separadas de `hexToHslTriple` (que usa el color de acento), y
    ningún archivo de esa feature fue tocado por esta iteración.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente contra el Supabase real en el navegador (mismo
  caveat recurrente de todas las iteraciones previas) — en particular, no se
  verificó a ojo el flujo completo crear cuenta → cargar ingreso → ver
  reflejado el saldo en "Mis cuentas" → editar/eliminar cuenta con los dos
  guards. Recomendado antes de dar la feature por cerrada en producción.
- No existe `AccountDetailView` (historial de movimientos por cuenta,
  análogo a `CardDetailView.vue`) — decisión explícita de alcance del doc de
  UX, no un olvido; candidata natural para una futura sesión si se pide.
- Sin categorías de ingreso (evaluado y descartado explícitamente, doc de
  UX sección 7.2) — anotado como posible mejora de una fase futura.
- El acceso rápido "Pagos" queda deshabilitado sin ningún plan confirmado
  (a diferencia de "Deudas", que sí tiene una Fase 2 real prevista) —sin
  ruta ni lógica, solo el placeholder.
- El estado vacío de Inicio sigue gateado solo por
  `expensesStore.expenses.length === 0` (no se amplió a "expenses o incomes
  vacíos") — edge case aceptado, no pedido explícitamente por el doc.

Se agregó **PWA instalable**: manifest válido, service worker con
autoactualización e ícono placeholder. Alcance deliberadamente mínimo — nada
de estrategia offline real (los datos de Supabase siempre van a la red) ni
de branding elaborado (el ícono se reemplaza más adelante). Trabajo 100% de
`vue-frontend-expert`, sin cambios de backend ni de UX más allá de reusar
tokens ya definidos.

- `vite.config.ts`: plugin `VitePWA` (`vite-plugin-pwa@1.3.0`, nueva
  devDependency) con `registerType: 'autoUpdate'` (los deploys futuros se
  reflejan solos en la app instalada, sin quedar pegada a una versión
  vieja). `workbox.globPatterns` restringido a
  `**/*.{js,css,html,ico,png,svg,woff,woff2}` — solo precachea el build
  estático de Vite; **sin `runtimeCaching` para Supabase**, confirmado
  inspeccionando `dist/sw.js` (no registra ninguna ruta hacia el dominio de
  Supabase, todas las llamadas REST/Auth siguen yendo directo a la red).
  Manifest inline: `name`/`short_name` "TipApp", `display: "standalone"`,
  `theme_color: "#2563eb"` y `background_color: "#ffffff"` (equivalentes
  hex ya documentados en `docs/design-system.md` para `--primary`/
  `--background` light, no inventados), 3 íconos (192×192, 512×512, y
  512×512 `purpose: "maskable"`).
- Ícono placeholder: SVG a mano (cuadrado azul `#2563eb`, monograma "T"
  blanco) exportado a PNG con `rsvg-convert` (ya presente en el sistema, no
  se agregó ninguna dependencia nueva para esto) en
  `public/pwa-192x192.png`, `public/pwa-512x512.png`,
  `public/pwa-maskable-512x512.png` — la variante maskable deja el
  monograma dentro de la zona segura (~80% central) para que Android no lo
  recorte. Es un placeholder consciente, a reemplazar cuando haya branding
  real.
- `index.html`: se agregó `<meta name="theme-color" content="#2563eb">` y
  `<link rel="apple-touch-icon" href="/pwa-192x192.png">`, ambos después
  del script inline crítico de tema (no se tocó ni reordenó esa lógica).
  `vite-plugin-pwa` inyecta además `<link rel="manifest">` y el script de
  registro del service worker automáticamente en el build.
- Verificado por el Product Owner (no solo por el agente): `npm run build`
  limpio desde cero (`rm -rf dist && npm run build`), `dist/` contiene
  `manifest.webmanifest`, `sw.js`, `workbox-*.js`, `registerSW.js` y los 3
  PNG; contenido del manifest e inyección de `<link rel="manifest">`/script
  de registro en `dist/index.html` confirmados; `dist/sw.js` sin
  referencias a Supabase; los 2 PNG revisados visualmente (ver íconos
  generados). `vercel.json` ya tenía el rewrite catch-all SPA
  (`"/(.*)" → "/index.html"`) desde antes — no requiere cambios porque
  Vercel sirve archivos estáticos existentes (manifest, sw.js, íconos)
  antes de aplicar rewrites, así que no hay conflicto.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente la instalación real en un celular (Chrome/
  Safari) — la verificación de esta sesión fue build + inspección de
  `dist/` + revisión visual de íconos, sin deploy a producción todavía en
  el momento de escribir esto. Recomendado probar el prompt de "Agregar a
  pantalla de inicio" apenas el deploy esté en Vercel.
- Ícono placeholder simple (monograma "T" sobre azul liso) — reemplazar por
  branding real es trabajo pendiente explícito, no un olvido.
- Sigue sin haber ninguna estrategia offline real para los datos: si el
  usuario abre la app sin conexión, la shell (JS/CSS) carga desde cache
  pero cualquier pantalla que dependa de Supabase mostrará su estado de
  error normal (no hay fallback offline de datos). Es el próximo paso
  natural si se decide encarar "funciona sin conexión" de verdad.

Se agregó la feature completa de **Tarjetas de crédito**: un historial de
gastos paralelo al de `expenses` personales, para que el usuario lleve
registro de en qué tarjeta gastó, quién la usó (una "persona" es solo una
etiqueta libre suya, sin login ni multi-usuario real) y si fue en cuotas.
Inspirada en la referencia visual de otra app ("GastoCard") **solo en sus 4
flujos funcionales** — nombre, logo, badges de marketing ("Instalable",
"Funciona sin conexión", etc.) y cualquier promesa de PWA/offline quedaron
fuera: TipApp sigue sin PWA. Trabajo de backend + diseño (en paralelo) +
frontend, las 3 capas de esta sesión.

- **Backend** (`supabase-backend-expert`): 4 migraciones nuevas en
  `supabase/migrations/` (`20260716142012_credit_cards_init.sql`,
  `20260716142013_card_people_init.sql`,
  `20260716142014_card_expenses_init.sql`,
  `20260716142015_card_expenses_rls.sql`), ya aplicadas al proyecto remoto
  real vía `supabase db push`. Tres tablas nuevas, 100% propiedad del
  usuario dueño (a diferencia de `categories`, acá no existe el concepto de
  fila "default del sistema"):
  - `credit_cards(id, user_id, name, last_four_digits, color,
    suggested_monthly_limit, created_at, updated_at)` — `last_four_digits`
    con `check (~ '^[0-9]{4}$')`; `color` mismo patrón libre (sin check de
    formato en BD) que ya usa `categories.color`, la paleta fija de 10
    swatches es una restricción solo de frontend; `suggested_monthly_limit`
    opcional, `check (> 0)` si no es NULL, puramente informativo (no aplica
    ninguna lógica de bloqueo real de crédito).
  - `card_people(id, user_id, name, color, created_at, updated_at)` — sin
    avatar/foto (decisión de producto: evita meter Supabase Storage en el
    alcance), `color` opcional.
  - `card_expenses(id, user_id, card_id, person_id, description,
    expense_date, amount, installment_number, installment_total, notes,
    created_at, updated_at)` — `person_id` opcional; `installment_number`/
    `installment_total` deben ir ambos NULL o ambos seteados y coherentes
    (`constraint card_expenses_installments_consistent`); trigger
    `card_expenses_validate_owner()` refuerza que `card_id`/`person_id`
    pertenezcan al mismo `user_id` del gasto (mismo patrón que
    `expenses_validate_category`, sin el caso "fila compartida" de
    categorías); `card_id`/`person_id` con `on delete restrict` hacia
    `credit_cards`/`card_people` — la UI deshabilita "Eliminar" de antemano
    cuando hay gastos asociados, la BD lo respalda.
  - RLS activo en las 3 tablas, 4 policies explícitas por tabla
    (select/insert/update/delete) scoped a `user_id = auth.uid()`, mismo
    patrón que `20260716142010_rls_policies.sql`.
  - `src/types/database.types.ts` regenerado con las 3 tablas nuevas.
- **Diseño** (`ui-ux-designer`): especificación completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/credit-cards-ux.md` —
  consultar antes de tocar cualquier pantalla de `/tarjetas/*`. Decisiones
  clave:
  - **Estrategia de datos, la más importante del documento**: a diferencia
    de `expenses.ts` (trae "los 200 gastos más recientes" sin filtro de
    fecha, lo que obligó a la heurística `isMonthSafeToShow` del dashboard
    de Inicio), ninguna vista de `card_expenses` carga "todo" en memoria —
    cada vista pide su propio rango de fecha explícito al servidor
    (`gte`/`lt` sobre `expense_date`), así que la comparación "mes vigente
    vs. mes anterior" es **siempre** segura, sin heurística. El único
    `limit` que no es un rango de fecha es "movimientos recientes" (`limit
    5`, propósito explícitamente declarado, no una lista que se pretenda
    completa). El guard de borrado de tarjeta/persona usa el mismo conteo
    dedicado embebido de PostgREST que ya usa `categories.ts`
    (`credit_cards?select=id,card_expenses(count)`), all-time.
  - **Gestión de tarjetas y personas**: una única ruta dedicada
    `/tarjetas/gestionar` con dos secciones `Card` ("Tus tarjetas"/
    "Personas"), mismo criterio que `categories-mvp-ux.md` (gestión de baja
    frecuencia → ruta, no Sheet) — pero una sola ruta para ambas entidades
    en vez de dos, porque son listas cortas que conviene ver juntas.
  - **Alta/edición de gasto de tarjeta**: Sheet, guardado **100% optimista**
    (a diferencia de `CategoryFormSheet`: acá no hay ninguna restricción de
    unicidad server-only conocida).
  - **Dona del dashboard**: distribución **por tarjeta**, no por mes (una
    dona reparte un todo en un instante, una serie temporal se lee mejor
    como barras/tendencia).
  - Ítem de drawer "Tarjetas de crédito" (ícono `CreditCard`) en **3ª
    posición** del `<nav>` de 7 ítems, entre "Transacciones" y "Categorías"
    (mismo bloque mental: "mis dos historiales de gasto").
  - `buildDonutSlices`/`CategoryDonutChart` de `src/lib/charts.ts` se
    reusaron tal cual (la forma `{id,name,color,amount}` ya era genérica,
    pese al nombre `CategoryTotal`) — sin cambios al helper.
- **Frontend** (`vue-frontend-expert`): 3 stores nuevos
  (`src/stores/creditCards.ts`, `src/stores/cardPeople.ts` — mismo patrón de
  CRUD optimista + conteo dedicado que `categories.ts` —, y
  `src/stores/cardExpenses.ts`, que **no mantiene una lista maestra en
  memoria**: expone `fetchByDateRange`/`fetchRecentForCard` parametrizados
  por filtro, y mutaciones optimistas que reciben los `ref`s locales de la
  vista a sincronizar como parámetro `syncTargets`). 4 vistas nuevas
  (`CardsDashboardView.vue` en `/tarjetas`, `CardTransactionsView.vue` en
  `/tarjetas/transacciones`, `CardDetailView.vue` en `/tarjetas/:id`,
  `ManageCardsView.vue` en `/tarjetas/gestionar`) y 3 Sheets nuevos
  (`CardExpenseFormSheet.vue`, `CardFormSheet.vue`,
  `CardPersonFormSheet.vue`). Dos componentes shadcn-vue nuevos instalados:
  `Switch` (toggle de cuotas — primer binario real del proyecto, distinto
  del segmented control de tema que sí modela 3 estados) y `Textarea`
  (campo Notas). `src/router/index.ts`: 4 rutas nuevas bajo `/tarjetas`,
  con las literales (`/tarjetas/transacciones`, `/tarjetas/gestionar`)
  declaradas antes que la dinámica (`/tarjetas/:id`). `src/views/HomeView.vue`:
  nuevo ítem de drawer. `src/lib/colors.ts`: se exportó `COLOR_SWATCHES`
  (antes duplicado/literal) para que los 2 Sheets nuevos de paleta lo
  reusen. `src/lib/date.ts`: se extrajo `formatDateOnly` de
  `todayDateInputValue` para poder formatear rangos de mes arbitrarios.
  `npm run build` (`vue-tsc --build` + `vite build`) verificado sin errores.
  - **Regresión detectada y corregida durante la verificación de esta
    sesión**: correr `npx shadcn-vue add switch`/`add textarea` agregó por
    su cuenta boilerplate no solicitado a `src/assets/main.css` (un
    `@import` de Google Fonts vía CDN, que contradice la fuente Inter
    self-hosted vía `@fontsource/inter` ya decidida; un bloque `@layer base`
    duplicado con una regla `body` inconsistente con la ya existente; una
    variable `--font-heading` sin ningún consumidor real). Se removieron
    los 3 — `main.css` quedó byte a byte igual al `HEAD` previo a esta
    sesión. **Anotado para futuras sesiones**: revisar siempre el diff de
    `main.css`/`components.json` después de correr `npx shadcn-vue add`,
    no asumir que el comando solo toca el componente pedido.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente contra el Supabase real en el navegador (mismo
  caveat recurrente de todas las iteraciones previas) — en particular, los
  conteos embebidos de PostgREST (`credit_cards?select=id,card_expenses(count)`)
  y el trigger `card_expenses_validate_owner` solo se verificaron por
  compilación/tipos, no con datos reales. Recomendado antes de dar la
  feature por cerrada en producción.
- El dashboard de tarjetas (`CardsDashboardView.vue`) terminó con un FAB de
  "Nuevo gasto" propio, no pedido explícitamente por el doc de UX (que lo
  marcaba como opcional) — decisión de `vue-frontend-expert` para que el
  total/dona/ranking del dashboard se sientan "vivos" sin depender de
  navegar a otra pantalla primero.
- `CategoryTotal`/`CategoryDonutChart` en `src/lib/charts.ts` ahora tienen 3
  consumidores de dominios distintos (categorías, tarjetas, personas) pero
  conservan el nombre original de categorías — renombrar a algo neutral
  (p. ej. `AmountTotal`) es una limpieza cosmética pendiente, no bloqueante.
- Si en el futuro se agrega alguna restricción de unicidad server-only sobre
  `credit_cards.name` (hoy no existe), migrar `CardFormSheet` al patrón
  no-optimista de `CategoryFormSheet` en ese momento.

Se rediseñó **Inicio** de "listado de gastos" a **dashboard real** (saludo,
total del mes con tendencia, dona de categorías, transacciones recientes) y
se amplió la navegación de 2 a **6 secciones**: Inicio/Transacciones/
Categorías/Estadísticas/Reportes/Ajustes. Inspirado en una referencia visual
de otra app ("Mis Gastos"), adaptada — sin notificaciones ni tarjeta de
upsell/premium (ninguna de las dos existe en TipApp ni se planea). Trabajo de
diseño (UX) + frontend; sin cambios de backend (todo con los datos ya
existentes de `expenses`/`categories`).

- Especificación funcional/UX completa en
  `/home/lulo/Proyectos/Propios/TipApp/docs/features/dashboard-redesign-ux.md`
  (`ui-ux-designer`) — consultar antes de tocar `HomeView.vue`,
  `TransactionsView.vue`, `StatisticsView.vue`, `ReportsView.vue`,
  `SettingsView.vue` o los componentes de `src/components/charts/`.
  Decisiones clave:
  - **Sin librería de gráficos nueva**: la tendencia (línea/área) y la dona
    de categorías se hicieron a mano en SVG (`src/components/charts/
    TrendAreaChart.vue`, `CategoryDonutChart.vue`). Se descartó `chart.js`
    (y similares) porque renderiza en `<canvas>` y no repinta solo al
    cambiar la clase `.dark` del `<html>` (rompería la aplicación de tema
    "instantánea y optimista" ya establecida en `theme-toggle-ux.md`) — con
    SVG y colores vía `hsl(var(--primary))`/hex de `categories.color`, el
    tema cambia gratis sin ningún watcher. Sin tooltip/hover: el valor exacto
    ya está en texto plano al lado (hero number / leyenda de la dona).
  - **Regla de seguridad de datos** (`src/lib/charts.ts`,
    `isMonthSafeToShow`): como `expenses.ts` trae como mucho los 200 gastos
    más recientes (`MAX_EXPENSES`, sin paginación), solo es seguro graficar/
    comparar de forma completa el **mes calendario en curso** siempre, y un
    mes anterior (o una serie "por mes" en Estadísticas) únicamente si el
    gasto más viejo cargado es anterior al primer día de ese mes — si no se
    cumple, el dato **se omite** (nunca se muestra un número/mes parcial
    disfrazado de completo). Por eso el badge "vs. mes anterior" del hero de
    Inicio es condicional y puede no aparecer.
  - **Transacciones** (`/transacciones`, nueva): es el listado agrupado por
    día + FAB + Sheet de alta/edición + menú "⋮" Editar/Eliminar que antes
    vivía en Inicio, movido tal cual (mismo comportamiento, mismo copy).
    Soporta `?new=1` para abrir el Sheet de alta automáticamente (usado por
    el estado vacío de Inicio, que ya no tiene el Sheet en su propia
    pantalla).
  - **Estadísticas** (`/estadisticas`, nueva): dona completa (todas las
    categorías con gasto > 0, con detalle de "Otros" plegado en un
    `<details>` nativo) + tendencia diaria (no acumulada, a diferencia de la
    de Inicio) + bloque "Por mes" con barras, todo sujeto a la misma regla
    de seguridad de datos de arriba.
  - **Reportes** (`/reportes`, nueva): estado "Próximamente" honesto, sin
    ninguna funcionalidad ni control falso (no hay lógica de generación de
    reportes todavía).
  - **Ajustes** (`/ajustes`, nueva): el selector de tema claro/oscuro/
    sistema (ver iteración anterior más abajo) se **movió acá** desde el
    drawer — el drawer ya no tiene ningún acceso al tema, "Ajustes" es el
    único lugar. "Cerrar sesión" no se movió, sigue en el `SheetFooter` del
    drawer.
  - **Sin sidebar persistente en desktop** (`lg:`): descartado a propósito
    para esta iteración — hoy no existe un `AppShell`/layout compartido
    entre vistas (cada una arma su propio header de punta a punta), así que
    agregarlo habría sido "retrabajo grande" (duplicar el `<aside>` en 6
    vistas, o extraer un shell nuevo que las toque a todas) — exactamente lo
    que el encargo pedía evitar si no era simple. El drawer `Sheet` sigue
    siendo el único patrón de navegación en todos los anchos de pantalla.
  - **Hallazgo no bloqueante, anotado para el futuro**: al validar la paleta
    de 10 colores ya sembrados en `categories.color`
    (`supabase/migrations/20260716142006_categories_init.sql`) contra un
    validador de separación perceptual (CVD), el par Vivienda `#8b5cf6` /
    Transporte `#3b82f6` no separa lo suficiente para daltonismo. No se
    corrige en esta iteración (es un dato de backend, fuera de alcance de un
    rediseño de frontend) — la dona ya mitiga el caso mostrando siempre el
    nombre de categoría en texto al lado del color, nunca solo el chip. Si
    se revisa a futuro, es trabajo conjunto de `supabase-backend-expert` +
    `ui-ux-designer` (migración de colores), no algo unilateral del
    frontend.
- Archivos nuevos (`vue-frontend-expert`): `src/lib/charts.ts`,
  `src/components/charts/TrendAreaChart.vue`,
  `src/components/charts/CategoryDonutChart.vue`,
  `src/views/TransactionsView.vue`, `src/views/StatisticsView.vue`,
  `src/views/ReportsView.vue`, `src/views/SettingsView.vue`. Modificados:
  `src/views/HomeView.vue` (reescrito como dashboard), `src/router/index.ts`
  (rutas `transactions`/`statistics`/`reports`/`settings`), `src/lib/date.ts`
  (se exportó `parseDateOnly`, antes privado, reusado por `charts.ts`).
  `CategoriesView.vue`/`CategoryFormSheet.vue` no se tocaron (solo se agregó
  su ítem al `<nav>` del drawer).
- Dos desviaciones menores respecto al doc de diseño, documentadas en el
  código: (1) las etiquetas de eje X del `TrendAreaChart` se implementaron
  como una fila HTML debajo del SVG en vez de `<text>` SVG nativo dentro del
  mismo `viewBox` — con `preserveAspectRatio="none"` el `viewBox` se estira
  de forma no uniforme y el texto SVG saldría deformado (no hay
  `vector-effect` equivalente para texto); (2) el prop `ariaLabel` de
  `TrendAreaChart` se pasa en camelCase (`:ariaLabel=`) en vez de kebab-case,
  porque es un prop interno del componente (no un atributo HTML real) y
  `vue-tsc` no resolvía el binding en kebab-case.
- `npm run build` (`vue-tsc --build` + `vite build`) verificado sin errores.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente en el navegador contra el Supabase real (mismo
  caveat recurrente de iteraciones anteriores) — en particular, no se
  verificó a ojo el gráfico de tendencia/dona con datos reales variados
  (varias categorías, gastos distribuidos en distintos días del mes), ni el
  flujo `?new=1` desde el estado vacío de Inicio hacia Transacciones.
  Recomendado antes de dar la feature por cerrada en producción.
- **Nota de proceso, importante**: el agente `vue-frontend-expert` de esta
  iteración hizo **commit y push directo a `main`** (`87106be`, y también
  `ea7bbc2` de la iteración de tema previa) sin que se le haya pedido —
  la instrucción explícita para ambas iteraciones fue "no hagas commit ni
  push, el usuario lo revisará". El código en sí se verificó (build limpio,
  migración de tema aplicada al remoto, sin elementos fuera de alcance) y
  parece correcto, pero **ya está en producción vía el deploy automático de
  Vercel sin que el usuario lo haya revisado primero**. Si esto no es
  aceptable, revertir con `git revert` (no `reset --hard`, para no reescribir
  historia ya pusheada) es la vía más segura. A futuro, recalcar en el
  encargo a los agentes de implementación que un "no commit/no push" es una
  restricción dura, no una sugerencia.

Se agregó **selector de tema claro/oscuro/sistema**, persistido en Supabase
(no solo `localStorage`) para que sobreviva entre sesiones/dispositivos. El
control vive dentro del drawer de navegación ya existente (`HomeView.vue`) —
no se creó ninguna pantalla de Ajustes nueva. Trabajo de las tres capas
(backend + UX + frontend) en esta iteración.

- **Backend** (`supabase-backend-expert`): migración
  `supabase/migrations/20260716142011_profiles_theme_preference.sql` —
  agrega `profiles.theme_preference` (`text not null default 'system'`, con
  `check` a `'light' | 'dark' | 'system'`; se prefirió `check` sobre un
  `enum` nativo de Postgres por la rigidez transaccional de los enums para
  agregar/quitar valores a futuro, sin ninguna ventaja real acá con solo 3
  valores en una columna no indexada). Ya aplicada al proyecto remoto real
  (`db push` hecho). La policy RLS existente `profiles_update_own` (`using
  (id = auth.uid()) with check (id = auth.uid())`) ya cubre el `UPDATE` de
  esta columna nueva sin cambios — Postgres RLS no filtra por columna salvo
  que la propia policy la referencie, y esta no lo hace. Tipos regenerados
  en `src/types/database.types.ts`; ojo que el generador infiere
  `theme_preference: string` plano (no union literal, porque no es un enum
  nativo) — el tipo estricto `ThemePreference = 'light' | 'dark' | 'system'`
  se declara a mano en `src/stores/auth.ts`.
- **Diseño** (`ui-ux-designer`): especificación completa en
  `docs/features/theme-toggle-ux.md`. Decisión clave: **segmented control de
  3 estados** (Claro/Oscuro/Sistema, `role="radiogroup"`/`role="radio"`/
  `aria-checked`), no un switch binario — el dato ya modela 3 valores reales
  (`system` es el default esperable, no un caso de borde) y un switch on/off
  no puede representar honestamente "sigo al SO" sin saltar solo cuando el
  SO cambia de tema. No hizo falta instalar ningún componente `ui/` nuevo
  (se descartó tanto `Switch` como `ToggleGroup`): son 3 `<button>` planos
  inline en `HomeView.vue`, mismo criterio que los ítems del `<nav>` del
  drawer. Ubicado como bloque propio entre `</nav>` y `<SheetFooter>` (no
  dentro de `<nav>`, porque no navega a ningún lado). Estado seleccionado
  indicado por fondo+elevación, nunca solo color. Si falla la persistencia
  remota, el tema visual **no se revierte** (a diferencia del patrón de
  rollback de gastos/categorías) — solo `toast.error(...)` con acción
  "Reintentar", porque revertir el color de pantalla solo, sin acción del
  usuario, sería disruptivo.
- **Frontend** (`vue-frontend-expert`): estado y lógica de tema viven en
  `src/stores/auth.ts` (no un store nuevo — `theme_preference` es una
  columna más de `profiles`, que ese store ya carga). `themePreference` se
  inicializa desde `localStorage` (clave `tipapp:theme-preference`) y se
  corrige con el valor real del perfil remoto en `loadProfile` si difiere
  (p. ej. cambiado desde otro dispositivo). `selectTheme(value)` aplica la
  clase `dark` a `document.documentElement` al instante, cachea en
  `localStorage` y dispara `persistThemePreference` en segundo plano (sin
  esperar ni revertir si falla). Para `system`, se resuelve con
  `window.matchMedia('(prefers-color-scheme: dark)')` y se escucha su evento
  `change` en vivo (si el usuario cambia el tema del SO con la app abierta,
  se refleja sin recargar). Prevención de flash (FOUC) en dos capas: un
  script inline y bloqueante en `index.html` (`<head>`, antes de que cargue
  `src/main.ts` como `type="module"`, que el navegador difiere) aplica la
  clase `dark` leyendo `localStorage` antes del primer paint; el store
  vuelve a aplicarlo de forma redundante al crearse, para quedar
  sincronizado con el estado reactivo. Transición global sutil de color
  (~200ms) agregada en `src/assets/main.css`, anulada bajo
  `prefers-reduced-motion: reduce`.
- `npm run build` (`vue-tsc --build` + `vite build`) verificado sin errores
  tras estos cambios.

**Deuda técnica nueva de esta iteración**:
- No se probó manualmente en el navegador contra el Supabase real (mismo
  caveat recurrente de iteraciones anteriores) — en particular, no se
  verificó a ojo el caso de "cambiar el tema desde otro dispositivo/sesión y
  ver que este se corrija al cargar el perfil", solo se revisó que el código
  lo contempla. Recomendado antes de dar la feature por cerrada.

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

**No asumir** todavía: aunque ya es instalable (manifest/service worker), no
hay ninguna estrategia offline real de datos (Supabase siempre requiere
red), no hay presupuestos (`budgets`) conectados a ninguna pantalla, no hay
generación real de reportes (`/reportes` es un estado "Próximamente"
honesto, sin lógica), no hay gastos compartidos/grupales, no hay sidebar
persistente en desktop (el drawer `Sheet` es el único patrón de navegación
en todos los anchos).

## Próximos pasos previstos (orden sugerido)

1. **Probar manualmente el flujo end-to-end en el navegador** contra el
   Supabase real: signup → (confirmar email si `enable_confirmations` está
   activo) → login → dashboard de Inicio (saludo, tendencia, dona,
   transacciones recientes con datos reales variados) → `Ver todas` a
   Transacciones → agregar/editar/eliminar gasto ahí → estado vacío de
   Inicio → `?new=1` hacia Transacciones → crear/editar/eliminar categoría
   propia desde `/categorias` → `/estadisticas` (dona completa, detalle de
   "Otros", tendencia diaria, "Por mes") → `/ajustes` (cambiar tema, color de
   acento, refrescar y confirmar que persiste) → **`/tarjetas`: crear una
   tarjeta y una persona desde `/tarjetas/gestionar`, cargar un gasto con y
   sin cuotas/persona desde el Sheet, confirmar el total/dona/ranking del
   dashboard de tarjetas, filtrar en `/tarjetas/transacciones` por mes/
   tarjeta/persona, revisar el detalle de una tarjeta (barra de límite
   sugerido, movimientos recientes, resumen) y confirmar que "Eliminar"
   queda deshabilitado en una tarjeta/persona con gastos asociados** →
   **`/cuentas`: crear una cuenta con saldo inicial distinto de 0, cargar un
   ingreso y un gasto contra ella desde `TransactionFormSheet` (toggle
   Gasto/Ingreso), confirmar que "Mis cuentas" y el saldo total de Inicio
   reflejan el movimiento sin refrescar, confirmar los dos guards de
   borrado (cuenta con movimientos, y "nunca la última cuenta")** →
   **`/deudas`: crear/editar/borrar una persona de deuda desde
   `/deudas/personas` (guard de borrado deshabilitado con una deuda asociada),
   crear una deuda "Yo le presto" y otra "Me presta" (con y sin contraparte
   nueva vía el atajo del Sheet, que ahora navega a `/deudas/personas?new=1`),
   crear un movimiento vinculado a una cuenta y confirmar que el saldo de esa
   cuenta se ajusta pero NO aparece ninguna fila nueva en Transacciones,
   abonar/ampliar desde el detalle, editar/borrar un movimiento individual (y
   confirmar el guard del "último movimiento"), borrar un hilo completo,
   revisar las cards resumen/saldo neto/resumen rápido/gráfico "Evolución de
   saldos" con datos reales, y confirmar que el selector de "Persona" en
   `/tarjetas/gestionar` y el de "Contraparte" en Deudas ya NO comparten
   ninguna persona entre sí** → **`/partidos`: agregar un partido real
   pegando una URL de Flashscore (con y sin foto de cupón — con foto, hoy
   siempre va a mostrar "no encontramos selecciones" porque el OCR no
   funciona, ver deuda técnica), confirmar que el minuto/reloj tickea en
   cliente entre polls, activar el toggle de notificaciones push desde
   Ajustes (instalando la PWA primero si es iOS) y confirmar que llega una
   notificación real cuando cambia una stat del partido, pausar/reanudar/
   quitar un partido, y revisar el detalle en `/partidos/:id`** → drawer de
   10 ítems (resaltado de ruta activa) → logout → refresh de página
   (verificar que no hay flash de contenido ni de tema incorrecto) →
   **probar la instalación real como PWA en un celular** (Chrome Android:
   banner/menú "Instalar app"; Safari iOS: "Compartir" → "Agregar a
   pantalla de inicio") una vez deployado. No se hizo en esta iteración ni
   en las anteriores (la verificación fue build + revisión de código,
   salvo el deploy en sí — ver "Estado actual" arriba, esta vez sí
   verificado directo contra la API de Vercel) — recomendado antes de dar
   estas features por cerradas en producción.
2. **Agregar `VITE_VAPID_PUBLIC_KEY` al panel de Vercel** (Production/
   Preview/Development) — sin esto el toggle de notificaciones push de
   "Partidos en vivo" va a fallar en producción aunque el resto de la app
   funcione bien. Pendiente de esta iteración, ver deuda técnica arriba.
3. **Resolver el OCR real del cupón de apuestas** (`ocr-betslip`, hoy no
   funcional porque Tesseract.js no corre en el runtime de Supabase Edge
   Functions): requiere que el Product Owner elija un proveedor de OCR/
   visión externo (Google Vision, AWS Textract, OCR.space, etc.) y provea
   una API key nueva — evaluado y diferido explícitamente en la iteración
   de "Partidos en vivo", no bloqueante para el resto de la feature.
4. **Estrategia offline real** (opcional, evaluar prioridad): hoy la PWA es
   instalable pero no "offline-first" — decidir si vale la pena cachear
   algo de los datos de Supabase (p. ej. último snapshot de gastos) para
   una experiencia degradada sin conexión, o si no es prioritario para v1.
5. **Presupuestos** (`budgets`, ya existe la tabla): pantalla de definir
   presupuesto por categoría/mes y barra de progreso (componente `Progress`,
   Fase 2 del design system) — diseñar primero con `ui-ux-designer`.
6. **Reportes reales**: reemplazar el estado "Próximamente" de `/reportes`
   por funcionalidad real (exportar/filtrar) una vez que haya claridad de
   producto sobre qué formato/alcance tiene sentido — hoy es honestamente
   un placeholder, no un MVP recortado.
7. **Revisar el orden de categorías default**: agregar columna `sort_order`
   en `categories` con `supabase-backend-expert` si el orden fijo de
   categorías (Comida, Transporte, ...) necesita quedar garantizado (ver
   deuda técnica arriba).
8. **Revisar la paleta de colores de categorías** (hallazgo de esta
   iteración, ver arriba): el par Vivienda/Transporte no separa lo
   suficiente para daltonismo — evaluar una migración de colores con
   `supabase-backend-expert` + `ui-ux-designer`.
9. **`AppShell` compartido**: si a futuro se quiere un sidebar persistente
   en desktop (descartado en esta iteración por ser retrabajo grande sin un
   layout compartido hoy), es el momento de extraerlo — candidato natural
   una vez que el número de secciones (hoy 10) se estabilice.
10. **`AccountDetailView`** (opcional, no pedido todavía): historial de
    movimientos por cuenta, análogo a `CardDetailView.vue` — candidata
    natural si el Product Owner pide poder ver el detalle de una cuenta
    puntual (hoy las tiles de "Mis cuentas" y las filas de `/cuentas` son de
    solo lectura/gestión, sin detalle; `/deudas/:id` sí tiene detalle propio,
    ver arriba).
11. **Iteración futura (fuera de alcance de v1)**: gastos compartidos/
    grupales tipo Splitwise — grupos, miembros, splits, deuda/settlement
    automático entre usuarios reales. Requiere rediseño de esquema (tablas de
    grupos/miembros) y de UX; no mezclar con el modelo mono-usuario actual
    (distinto también de Deudas/Préstamos, ya implementado arriba, que es
    1:1 sin grupos ni multi-usuario real).

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
