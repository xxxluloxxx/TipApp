# TipApp

TipApp es una web app (PWA) para gestionar propinas. Este repositorio contiene,
por ahora, un **esqueleto mínimo** cuyo único objetivo es validar de punta a
punta el pipeline de deploy (build local -> repo git -> deploy en Vercel)
antes de empezar a construir features de producto.

## Stack

- [Vue 3](https://vuejs.org/) + `<script setup lang="ts">`
- TypeScript
- [Vite](https://vite.dev/) como bundler/dev server
- Deploy en [Vercel](https://vercel.com/) (plan gratuito)
- Backend planeado: [Supabase](https://supabase.com/) (plan gratuito)

En esta iteración **no** se incluyen todavía: Vue Router, Pinia, Tailwind CSS,
shadcn-vue, soporte PWA (`vite-plugin-pwa`) ni integración con Supabase. Eso
llegará en iteraciones posteriores (ver `CLAUDE.md`).

## Requisitos

- Node.js `^22.18.0` o `>=24.12.0` (ver `.nvmrc` / campo `engines` en
  `package.json`). Con [nvm](https://github.com/nvm-sh/nvm): `nvm use`.
- npm (viene con Node).

## Correr en local

```sh
npm install
npm run dev
```

Esto levanta un servidor de desarrollo (por defecto en `http://localhost:5173`)
que muestra "TipApp" y la fecha/hora actual actualizándose cada segundo, como
confirmación visual de que la página no es contenido estático.

### Build de producción

```sh
npm run build
```

Corre el chequeo de tipos (`vue-tsc`) y genera el build optimizado en `dist/`.

### Previsualizar el build de producción

```sh
npm run preview
```

## Deploy en Vercel

El proyecto se despliega en Vercel usando la configuración estándar para un
proyecto Vite:

- **Framework preset**: Vite
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Install command**: `npm install`

El deploy se dispara automáticamente en cada push cuando el repositorio está
conectado a un proyecto de Vercel (deploys de producción desde la rama
principal, *preview deploys* desde otras ramas/PRs). No se requieren variables
de entorno todavía; cuando se integre Supabase se agregarán `VITE_SUPABASE_URL`
y `VITE_SUPABASE_ANON_KEY` como env vars en el panel de Vercel (nunca en el
repo).

## Estructura

```
.
├── src/
│   ├── App.vue       # Página de inicio (placeholder de validación)
│   └── main.ts        # Entry point de la app
├── public/            # Assets estáticos
├── index.html
├── vite.config.ts
└── package.json
```
