# TipApp

**TipApp** es una **PWA instalable** de control de finanzas personales
(mono-usuario): gastos, ingresos, cuentas, tarjetas, deudas, préstamos en
cuotas, transferencias y gastos fijos. Incluye además una sección de utilidad
no financiera, **"Partidos en vivo"** (seguimiento de partidos de fútbol +
cupones de apuestas con notificaciones push).

Para el contexto de arquitectura y decisiones del proyecto, ver
[`CLAUDE.md`](./CLAUDE.md). Para el detalle de cada feature, ver
[`docs/features/`](./docs/features/) y el sistema de diseño en
[`docs/design-system.md`](./docs/design-system.md).

## Stack

- [Vue 3](https://vuejs.org/) + `<script setup lang="ts">` + TypeScript
- [Vite](https://vite.dev/) (bundler / dev server)
- [Vue Router](https://router.vuejs.org/) + [Pinia](https://pinia.vuejs.org/) (estado)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn-vue](https://www.shadcn-vue.com/) (Reka UI)
- [Supabase](https://supabase.com/) — Postgres + Auth + Storage + Realtime +
  Edge Functions (plan gratuito). RLS activo en todas las tablas.
- PWA vía [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) (modo
  `injectManifest`, service worker propio para Web Push)
- OCR de cupones client-side con [Tesseract.js](https://tesseract.js.org/)
- Deploy en [Vercel](https://vercel.com/) (plan gratuito, deploy automático por push)

## Features

- **Gastos e ingresos** imputados a una cuenta, con categorías (default o custom).
- **Cuentas** con saldo all-time calculado en el servidor (`/cuentas`, detalle en `/cuentas/:id`).
- **Tarjetas de crédito**: historial de gastos por tarjeta/persona, con cuotas (`/tarjetas`).
- **Transferencias entre cuentas** con comisión bancaria configurable (`/transferencias`).
- **Deudas/Préstamos 1:1**: a quién le prestás / quién te prestó, saldo corriente (`/deudas`).
- **Préstamos en cuotas** con reparto entre deudores (`/prestamos`).
- **Gastos fijos / recurrentes** con marcado mensual de pagos (`/gastos-fijos`).
- **Dashboard, Estadísticas y Reportes** con gráficos SVG (sin librería externa).
- **Ajustes**: tema claro/oscuro/sistema y color de acento, persistidos por usuario.
- **Partidos en vivo + cupones de apuestas** con polling server-side y push (`/partidos`).

## Requisitos

- Node.js `^22.18.0` o `>=24.12.0` (ver `.nvmrc` / `engines` en `package.json`).
  Con [nvm](https://github.com/nvm-sh/nvm): `nvm use`.
- npm.

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar (nunca commitear `.env.local`):

```sh
cp .env.example .env.local
```

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase. |
| `VITE_SUPABASE_ANON_KEY` | `anon key` pública (nunca la `service_role`). |
| `VITE_VAPID_PUBLIC_KEY` | Clave pública VAPID para Web Push (la privada vive solo en las Edge Functions). |

Las mismas variables se configuran en el panel de Vercel
(Production/Preview/Development).

## Correr en local

```sh
npm install
npm run dev
```

Levanta el dev server (por defecto en `http://localhost:5173`) apuntando al
Supabase configurado en `.env.local`.

### Build de producción

```sh
npm run build
```

Corre el chequeo de tipos (`vue-tsc --build`) y genera el build en `dist/`.

### Previsualizar el build

```sh
npm run preview
```

## Backend (Supabase)

El esquema vive en [`supabase/migrations/`](./supabase/migrations/) y se aplica
al proyecto remoto con `supabase db push`. Las Edge Functions están en
[`supabase/functions/`](./supabase/functions/) (`add-match`, `search-matches`,
`create-bet-slip`, `poll-matches`).

Regenerar los tipos TypeScript tras un cambio de esquema:

```sh
npx supabase gen types typescript --project-id <project-ref> > src/types/database.types.ts
```

## Deploy en Vercel

Configuración estándar de un proyecto Vite:

- **Framework preset**: Vite
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Install command**: `npm install`

El deploy de producción se dispara con cada push a `main`; los preview deploys,
desde otras ramas/PRs. Las env vars se configuran en el panel de Vercel, nunca
en el repo. El rewrite catch-all SPA está en `vercel.json`.

## Estructura

```
.
├── src/
│   ├── views/          # Pantallas (una por ruta)
│   ├── components/      # Componentes (incl. ui/ de shadcn-vue y charts/)
│   ├── stores/          # Pinia stores por dominio
│   ├── lib/             # Helpers (supabase, charts, date, currency, colors…)
│   ├── router/          # Vue Router + guard de sesión
│   ├── types/           # database.types.ts (generado de Supabase)
│   ├── sw.ts            # Service worker (Web Push)
│   ├── App.vue          # Shell raíz
│   └── main.ts
├── supabase/
│   ├── migrations/      # Esquema SQL (RLS, vistas, RPCs)
│   └── functions/       # Edge Functions (Deno)
├── docs/                # design-system.md + features/*.md
├── public/              # Assets estáticos (íconos PWA…)
├── vercel.json
└── vite.config.ts
```
