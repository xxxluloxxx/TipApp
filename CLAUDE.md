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
  cliente, ya que la `anon key` es pública. Esquema y migraciones ya
  definidos localmente (ver sección siguiente); falta crear el proyecto
  remoto real.
- **Vercel** (plan gratuito): hosting con deploys automáticos por push,
  preview deploys por rama/PR, y manejo simple de variables de entorno.
- **Tailwind CSS v4 + shadcn-vue (Reka UI)**: sistema de diseño utilitario y
  componentes accesibles reusables. Ya instalado y configurado con los tokens
  definidos por `ui-ux-designer` (ver abajo).

Todo el stack se eligió priorizando permanecer dentro de los límites de los
planes gratuitos de Supabase y Vercel.

## Estado actual (esta iteración)

Dos frentes completados en paralelo: **esquema de Supabase** (backend) y
**sistema de diseño base** (Tailwind + shadcn-vue). Todavía NO hay pantallas
ni flujos reales de gastos implementados — eso es la próxima iteración.

### Backend (Supabase) — diseñado y validado localmente, proyecto remoto NO creado

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
- Migraciones validadas contra una instancia Supabase local real (Docker):
  signup de prueba, trigger de perfil, y las 14 políticas RLS confirmadas
  activas.
- Tipos TypeScript ya generados en
  `/home/lulo/Proyectos/Propios/TipApp/src/types/database.types.ts` (vía
  `supabase gen types typescript --local`); regenerar contra el proyecto
  remoto real una vez creado (comando abajo).
- `/home/lulo/Proyectos/Propios/TipApp/.env.example` con
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` vacíos; `.env`/`.env.local` ya
  en `.gitignore`.
- `supabase` CLI instalado como devDependency del proyecto (no global).

**Pendiente manual del usuario** (no ejecutable por un agente sin
credenciales):
1. Crear proyecto en [supabase.com](https://supabase.com) (plan free).
2. Copiar `Project URL` y `anon key` desde Settings → API.
3. `npx supabase login`
4. `npx supabase link --project-ref <project-ref>`
5. `npx supabase db push` (aplica las 5 migraciones al proyecto remoto).
6. `npx supabase gen types typescript --project-id <project-ref> > src/types/database.types.ts`
   (regenerar tipos contra el remoto, reemplazando los generados en local).
7. Crear `.env.local` (no versionado) con las credenciales reales.
8. Configurar esas mismas env vars en el panel de Vercel (a cargo de
   `vercel-devops-expert`).
9. Opcional para producción: configurar SMTP propio en Auth y evaluar
   `enable_confirmations = true`.

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
- `src/App.vue` es actualmente una página de demo del sistema de diseño
  (monto hero con `tabular-nums`, card-list de gastos de ejemplo, badges de
  categoría, sheet de alta, alert dialog de confirmación, toggle
  light/dark) — **no es una pantalla de producto real**, se reemplaza en la
  próxima iteración.
- `npm run build` (incluye `vue-tsc --build`) verificado sin errores tras
  estos cambios.

**No asumir** todavía: no hay Vue Router, no hay Pinia, no hay pantallas de
gastos reales conectadas a Supabase, no hay PWA (manifest/service worker).

## Próximos pasos previstos (orden sugerido)

1. **Conectar Supabase real**: el usuario completa los pasos manuales de la
   sección anterior (crear proyecto, `link`, `db push`, `.env.local`, env
   vars en Vercel).
2. **Cliente Supabase en frontend**: instalar `@supabase/supabase-js`,
   inicializar cliente con las env vars `VITE_SUPABASE_*`, definir capa de
   acceso a datos tipada con `database.types.ts`.
3. **Vue Router + Pinia**: una vez haya más de una pantalla y estado que
   compartir (login, listado de gastos, alta/edición, presupuestos).
4. **Features de producto reales**: pantallas de auth (email/password),
   listado de gastos (card-list, no tabla), alta/edición vía Sheet,
   categorías, y opcionalmente presupuestos — diseñadas primero por
   `ui-ux-designer` (flujos concretos) e implementadas por
   `vue-frontend-expert` sobre el sistema de diseño ya instalado.
5. **PWA real**: manifest, service worker, estrategia offline con
   `vite-plugin-pwa` — a cargo de `vue-frontend-expert`. Iteración separada,
   posterior a tener features reales funcionando.
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
