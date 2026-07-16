# CLAUDE.md — TipApp

Contexto resumido del proyecto para futuras sesiones de Claude Code.

## Qué es TipApp

Web app (con vocación de PWA) para gestionar propinas. El proyecto se
construye de forma incremental: primero validar el pipeline de deploy con un
esqueleto mínimo, luego ir agregando backend, estilos, componentes y soporte
PWA en iteraciones separadas y verificables.

## Stack elegido y por qué

- **Vue 3 + TypeScript** (`<script setup lang="ts">`): framework reactivo
  moderno, tipado fuerte, buen soporte de PWA vía plugins de Vite.
- **Vite**: dev server rápido, build simple, integración directa con
  `vite-plugin-pwa` cuando se agregue soporte PWA.
- **Supabase** (Postgres + Auth + Storage + Realtime, plan gratuito): backend
  como servicio para no operar infraestructura propia en esta etapa. RLS
  (Row Level Security) es obligatorio en toda tabla accesible desde el
  cliente, ya que la `anon key` es pública.
- **Vercel** (plan gratuito): hosting con deploys automáticos por push,
  preview deploys por rama/PR, y manejo simple de variables de entorno.
- **Tailwind CSS + shadcn-vue** (pendiente): sistema de diseño utilitario y
  componentes accesibles reusables, a integrar en una iteración futura junto
  con el trabajo de `ui-ux-designer`.

Todo el stack se eligió priorizando permanecer dentro de los límites de los
planes gratuitos de Supabase y Vercel.

## Estado actual (esta iteración)

Solo existe un **esqueleto básico** generado con `create-vue`, sin backend, sin
PWA, sin Tailwind/shadcn-vue, sin Vue Router ni Pinia. El único propósito de
este esqueleto es confirmar que el pipeline de deploy en Vercel funciona:

- `src/App.vue` muestra el texto "TipApp" y un reloj (fecha/hora actual que se
  actualiza cada segundo), como prueba visual de que el contenido servido no
  es estático/cacheado tras el deploy.
- No hay rutas, ni estado global, ni llamadas a ningún backend todavía.
- Repo git inicializado localmente con un primer commit del scaffold.
- Configuración de Vercel (`vercel.json` si aplica, build/output/install
  command) a cargo del agente `vercel-devops-expert`.

**No asumir** que existe autenticación, base de datos, modelo de datos de
propinas, ni ningún flujo de negocio: todavía no se ha diseñado nada de eso.

## Próximos pasos previstos (orden sugerido)

1. **Supabase**: diseñar el esquema inicial (usuarios, propinas, lo que defina
   el negocio), migraciones SQL, políticas RLS, Auth, y generación de tipos TS
   — a cargo de `supabase-backend-expert`.
2. **Tailwind CSS + shadcn-vue**: setup del sistema de diseño base — a cargo
   de `vue-frontend-expert`, alineado con especificaciones de
   `ui-ux-designer`.
3. **PWA real**: manifest, service worker, estrategia offline con
   `vite-plugin-pwa` — a cargo de `vue-frontend-expert`.
4. **Vue Router + Pinia**: una vez haya más de una pantalla y estado que
   compartir entre componentes.
5. **Features de producto**: flujos de negocio reales de TipApp, a definir con
   el usuario y diseñar primero con `ui-ux-designer` antes de implementar.

## Convenciones y principios del proyecto

- Seguridad primero: RLS siempre activo, `service_role key` nunca en el
  frontend.
- Secretos fuera del repo: `.env.local` gitignored, `.env.example` como
  plantilla, variables sensibles solo en el panel de Vercel.
- Incremental y verificable: features pequeñas de punta a punta, probadas
  antes de seguir con lo siguiente.
- Free tier: priorizar soluciones dentro de los límites gratuitos de
  Supabase y Vercel.
