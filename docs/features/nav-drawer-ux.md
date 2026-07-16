# TipApp — Drawer de navegación principal (reemplazo del DropdownMenu del header)

Documento de especificación para `vue-frontend-expert`. Reemplaza el
`DropdownMenu` chico del header de `HomeView` (identidad + "Categorías" +
"Cerrar sesión", ver sección 1 de `docs/features/categories-mvp-ux.md`) por
un `Sheet` lateral (`side="left"`) tipo drawer de navegación, siguiendo el
patrón de referencia de un mockup de e-commerce (avatar + nombre/email en el
header del panel, lista de navegación ícono+label, "Sign Out" separado al
pie).

Da por sentado todo lo ya resuelto en `docs/design-system.md` (tokens,
espaciado, a11y) y no repite esa justificación acá.

**Importante — alcance**: la referencia es de un e-commerce con secciones que
TipApp no tiene (Notifications, Top Deals, New collections, Editor's Picks,
Settings). Las únicas dos secciones de navegación reales hoy son Home y
Categorías, más la acción de Cerrar sesión. No se inventan ítems nuevos.

Componentes ya instalados, no instalar nada nuevo: `Sheet`/`SheetContent`/
`SheetTitle` (ya existe `SheetFooter` con `mt-auto` de fábrica — clave para
el punto 1 de abajo), `Button`, `Separator` (no se termina usando, ver
justificación en la sección de estructura). Íconos `@lucide/vue`: `Tag`,
`LogOut` ya en uso; se agregan `Menu` (trigger) y `Home` (nuevo ítem de nav
— exportado como alias de `House` en el paquete, `import { Home } from
'@lucide/vue'` funciona tal cual, no es un ícono nuevo a instalar).

---

## 1. Estructura exacta del drawer

`SheetContent` ya trae por defecto, para `side="left"`, exactamente el ancho
pedido (`w-3/4` mobile, `sm:max-w-sm`) y `flex flex-col` a alto completo — no
hace falta agregar clases de ancho/alto, solo `<SheetContent side="left"
class="p-0">` (el `p-0` es para que el header pueda ir full-bleed contra los
bordes del panel en vez de heredar el padding default; cada bloque interno
pone su propio padding).

Markup, de arriba a abajo:

1. **Bloque de identidad** (header del panel, no es el `SheetHeader`
   genérico de título+descripción que usan los otros Sheets del proyecto —
   acá el contenido es distinto, ver nota de a11y en el punto 4 sobre por
   qué igual necesita un `SheetTitle`):
   - `<div class="flex items-center gap-3 border-b border-border p-6 pr-14">`
     — el `pr-14` es deliberado: dentro reserva espacio para no chocar con
     el botón "X" de cerrar que `SheetContent` ya renderiza en
     `absolute top-4 right-4` por defecto (se mantiene ese botón, no se
     saca).
   - Avatar circular (ver punto 2).
   - `<div class="flex min-w-0 flex-col">`:
     - Nombre: `<p class="truncate text-base font-semibold
       text-foreground">{{ accountLabel }}</p>` — reusar tal cual el
       computed `accountLabel` que ya existe en `HomeView.vue`
       (`profile?.display_name || user?.email`).
     - Email secundario: `<p v-if="showEmailSecondary" class="truncate
       text-sm text-muted-foreground">{{ user?.email }}</p>` — reusar tal
       cual el computed `showEmailSecondary` que ya existe (solo se muestra
       si hay `display_name`, para no repetir el email dos veces cuando no
       lo hay).
   - El propio `border-b` de este bloque hace de separador hacia la lista de
     navegación — **no se agrega un `<Separator/>` extra debajo**, sería una
     doble línea redundante contra el mismo borde. (Por eso `Separator` no
     termina usándose en este componente, aunque esté disponible.)

2. **Lista de navegación**: `<nav class="flex flex-col gap-1 p-3">`, dos
   ítems, en este orden:
   - **Inicio** — ícono `Home`, ruta `{ name: 'home' }` (`/`).
   - **Categorías** — ícono `Tag`, ruta `{ name: 'categories' }`
     (`/categorias`).

   Cada ítem es un botón/link (ver punto de implementación abajo) con:
   `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium
   transition-colors focus-visible:outline-none focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2`.
   - Estado inactivo: `text-foreground hover:bg-accent
     hover:text-accent-foreground`.
   - Estado activo (ruta actual): `bg-accent text-accent-foreground`
     **persistente**, no solo en hover — sí, "Inicio" se resalta cuando ya
     estás en Home. Calculado con `useRoute()`: `route.name === 'home'` /
     `route.name === 'categories'`. Ver a11y (punto 4) para `aria-current`.
   - Ícono: `size-5 shrink-0`.
   - Al tocar cualquier ítem: cerrar el drawer (`isDrawerOpen = false`) y
     navegar. Si ya estás en esa ruta (tocaste "Inicio" estando en Home),
     alcanza con cerrar el drawer sin volver a hacer `router.push` (evita el
     warning de "navegación redundante" de Vue Router; comparar
     `route.name` antes de empujar).

3. **Espacio flexible**: no hace falta ningún elemento explícito acá. Como
   `SheetContent` ya es `flex flex-col` a alto completo y `SheetFooter` (ver
   siguiente punto) ya trae `mt-auto` de fábrica, el espacio vacío entre la
   lista de navegación y el pie se resuelve solo — el pie queda pegado al
   fondo del panel aunque el contenido de arriba sea corto. No se agrega
   contenido de relleno para "llenar" ese espacio.

4. **"Cerrar sesión"**: `<SheetFooter class="border-t border-border">`
   (mismo criterio que el punto 1: el `border-t` ya hace de separador propio,
   no se duplica con un `<Separator/>`). Adentro, un único botón con
   exactamente las mismas clases de fila que los ítems de navegación del
   punto 2 (mismo alto, mismo hover, mismo estilo de foco), ícono `LogOut`,
   texto `Cerrar sesión`. **No usa color `destructive`** — mismo criterio ya
   vigente hoy en el `DropdownMenuItem` actual, que tampoco lo marca como
   destructivo (cerrar sesión no es una acción irreversible/peligrosa como
   eliminar un gasto). Al tocar: cerrar el drawer primero, después
   `onLogout()` (mismo handler ya existente) — cerrarlo antes evita que el
   panel quede visible un instante de más mientras se redirige a `/login`.

Nota de crecimiento futuro (justificación del punto 5 del encargo): cuando se
agreguen Presupuestos/Reportes (ver "Próximos pasos" en `CLAUDE.md`), esos
ítems se suman al mismo `<nav>` del punto 2, en el mismo formato — el drawer
full-height ya está preparado para eso sin rediseño; el espacio vacío de hoy
no es un defecto a corregir, es margen de crecimiento ya absorbido por el
layout (`mt-auto` del footer no cambia si la lista crece).

---

## 2. Avatar

**Decisión: inicial en círculo de color sólido, no ícono genérico `User`.**

- Fuente de la inicial: primer carácter de `display_name` si existe: si no,
  primer carácter de `user?.email`. En código: reusar el mismo
  `accountLabel` ya computado en `HomeView.vue` (que ya resuelve ese mismo
  fallback) y tomar `accountLabel.charAt(0).toUpperCase()`. Fallback
  defensivo `'?'` si por algún motivo `accountLabel` está vacío (no debería
  pasar estando autenticado, pero evita un círculo vacío).
- Color de fondo: **`bg-primary text-primary-foreground`** (el azul de
  marca ya definido en `docs/design-system.md` sección 1), no una paleta de
  colores por-usuario tipo hash. Justificación: a diferencia de los colores
  de categoría (que necesitan separación perceptual porque conviven varios
  a la vez en una lista), acá solo hay **un** avatar visible en pantalla en
  todo momento (un solo usuario, sin lista de otras personas de las que
  distinguirse) — inventar una paleta hash no resuelve ningún problema real
  y agrega una decisión de diseño innecesaria. Usar el token `primary` ya
  validado (mismo hue en light/dark, contraste ya verificado contra su
  propio `-foreground`) es la opción más simple y consistente con el resto
  de la app.
- Markup: `<div class="flex size-12 shrink-0 items-center justify-center
  rounded-full bg-primary text-lg font-semibold text-primary-foreground">
  {{ avatarInitial }}</div>`. `size-12` (48px): un poco más grande que el
  mínimo táctil de 44px porque el avatar no es interactivo (no es un botón,
  no aplica la regla de tap target), y a ese tamaño se lee cómodo un solo
  carácter en `text-lg`.
- No hay ningún campo de foto en el esquema (`profiles` no tiene
  `avatar_url`) — confirmado que no hace falta contemplar imagen real en
  esta iteración. Si en el futuro se agrega upload de foto de perfil (fuera
  de alcance hoy), este mismo círculo pasa a envolver un `<img>` con
  fallback a esta inicial cuando no hay foto — dejarlo anotado para no
  tener que redescubrirlo, pero no construir nada de eso ahora.

---

## 3. Trigger

**Decisión: cambiar el ícono del botón trigger de `User` a `Menu`
(hamburguesa)**, manteniendo posición (arriba a la izquierda del header de
Home) y estilo (`variant="ghost" size="icon"`).

Justificación del cambio: `User` comunicaba correctamente "menú de cuenta"
cuando el contenido era solo identidad + logout. Ahora que el panel es un
drawer de navegación completo (incluye "Inicio"/"Categorías", no solo
acciones de cuenta), `Menu` es el ícono universalmente reconocido para "más
navegación" y deja de sugerir, incorrectamente, que el panel es
exclusivamente de configuración de cuenta.

- `aria-label` se actualiza de `"Cuenta"` a `"Abrir menú"` (el trigger ya no
  es solo de cuenta).
- Sin cambios de tamaño/posición/variant: sigue siendo `<Button
  variant="ghost" size="icon" aria-label="Abrir menú"><Menu
  class="size-5" /></Button>`, mismo lugar que hoy en el header de
  `HomeView`.

---

## 4. Accesibilidad

1. **Nombre accesible del panel**: Reka UI (`DialogContent` debajo del
   `Sheet`) espera un `DialogTitle` para anunciar el panel al abrirse. Como
   el contenido visual del header (avatar + nombre + email) no es un buen
   "título" semántico (sería raro que un lector de pantalla anuncie el
   nombre de la persona como si fuera el título del panel), agregar un
   `<SheetTitle class="sr-only">Menú principal</SheetTitle>` dentro del
   bloque de identidad del punto 1 — visualmente oculto, solo para el
   nombre accesible del diálogo. No hace falta `SheetDescription` (mismo
   criterio ya usado en el Sheet de edición de categoría: opcional, se
   omite cuando no aporta información nueva).
2. **`aria-current="page"`** en el ítem de navegación activo (punto 1,
   ítem 2): `:aria-current="isHomeActive ? 'page' : undefined"` /
   equivalente para Categorías. El resaltado visual (`bg-accent`) nunca es
   el único indicador de "dónde estoy" — cumple la regla general de "color
   nunca como único indicador" del design system.
3. **Foco al abrir**: comportamiento default de Reka UI (foco cae dentro del
   contenido del diálogo, típicamente el botón de cerrar) es aceptable tal
   cual — no hace falta un `autofocus` custom en el primer ítem de
   navegación para esta iteración; no over-engineer un manejo de foco que
   Reka ya resuelve razonablemente.
4. **Área táctil**: los dos ítems de nav + "Cerrar sesión" usan `min-h-11`
   (44px), igual que el botón trigger (`size="icon"` ya da `h-11 w-11` por
   el ajuste global ya aplicado al componente `Button` del proyecto). Entre
   ítems, `gap-1` alcanza porque cada fila ya mide 44px de alto completo
   (el espaciado mínimo de la regla de a11y es para evitar toques
   accidentales entre elementos chicos, no aplica igual cuando cada fila ya
   ocupa toda la franja horizontal disponible).
5. **Foco visible**: mismo patrón `focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2` en los tres ítems
   (nav ×2 + logout) y en el trigger (heredado de `Button`).
6. **`prefers-reduced-motion`**: heredado de la transición de `Sheet`
   (Reka UI), sin configuración adicional.
7. **Nota de alcance para futuro**: hoy este drawer solo existe en
   `HomeView` (el trigger vive únicamente en el header de Home;
   `CategoriesView` tiene su propio header con `ArrowLeft` para volver, sin
   trigger de este drawer). Por eso, en la práctica, el ítem "Inicio" va a
   aparecer activo siempre que el drawer esté abierto (porque solo se puede
   abrir estando en Home). El cálculo de `aria-current` igual se hace vía
   `route.name` (no hardcodeado a "siempre activo") para que, si en una
   futura iteración se agrega el mismo trigger a `CategoriesView` u otras
   pantallas, el resaltado ya funcione correctamente sin tocar esta lógica.

---

## 5. Drawer full-height con dos ítems: confirmación

Se confirma el criterio pedido: con el contenido de hoy (2 ítems de nav +
logout), el panel completo se ve bien porque:

- El patrón de referencia (mockup adjunto) también deja espacio vacío entre
  la lista de navegación y "Sign Out" en su variante de menos ítems — el
  espacio en blanco ahí no lee como "roto", lee como respiración
  intencional antes de una acción separada.
- El header de identidad (avatar + nombre + email) ya le da peso visual
  propio al panel aunque la lista de abajo sea corta — no se siente vacío
  de golpe, hay jerarquía clara: identidad arriba, navegación al medio,
  salida al pie.
- El `mt-auto` de `SheetFooter` resuelve el layout sin trabajo extra: no
  hace falta forzar ninguna altura mínima de contenido ni agregar
  elementos de relleno.
- Estructuralmente ya queda listo para crecer (Presupuestos, Reportes) sin
  ningún rediseño — los ítems nuevos se insertan en el mismo `<nav>` y el
  espacio en blanco de hoy simplemente se va achicando con el tiempo.

---

## Resumen para `vue-frontend-expert`

1. En `HomeView.vue`: reemplazar el `DropdownMenu` (líneas ~125-151 hoy) por
   `<Sheet v-model:open="isDrawerOpen"><SheetTrigger as-child><Button
   variant="ghost" size="icon" aria-label="Abrir menú"><Menu
   class="size-5" /></Button></SheetTrigger><SheetContent side="left"
   class="p-0">...</SheetContent></Sheet>`.
2. Nuevo `ref` `isDrawerOpen` (reemplaza la apertura implícita del
   `DropdownMenu`).
3. Imports nuevos en `@lucide/vue`: `Menu`, `Home` (agregar a la lista ya
   existente; ninguno requiere instalar paquete).
4. Reusar tal cual los computeds existentes `accountLabel` y
   `showEmailSecondary`; agregar un computed `avatarInitial` derivado de
   `accountLabel`.
5. Estructura interna exacta: bloque identidad (`border-b`, `p-6 pr-14`,
   avatar `size-12 rounded-full bg-primary text-primary-foreground` +
   nombre/email, `SheetTitle` `sr-only`) → `<nav>` con dos ítems (Inicio/
   Categorías, estado activo vía `route.name`, `aria-current`) →
   `SheetFooter` (`border-t`, ya trae `mt-auto`) con "Cerrar sesión".
6. Ancho/alto del panel: no tocar, el default de `SheetContent` para
   `side="left"` ya cumple 3/4 mobile + `sm:max-w-sm`.
7. No se agrega ningún ítem de navegación que no exista hoy (Home,
   Categorías, Cerrar sesión — nada más).
