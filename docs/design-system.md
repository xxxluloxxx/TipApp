# TipApp — Sistema de Diseño Base (v1)

Documento de especificación para `vue-frontend-expert`. Cubre solo el **sistema
de diseño base** (tokens, tipografía, espaciado, componentes shadcn-vue
prioritarios, a11y). No incluye pantallas de features de gastos — eso se
diseña en la próxima iteración cuando el schema de Supabase esté cerrado.

Contexto de producto: TipApp v1 es control de **gastos personales de un solo
usuario** (gastos, categorías, quizás presupuestos por categoría/mes). No hay
grupos, miembros ni splits — todo lo que sigue asume un solo usuario mirando
sus propios números.

---

## 1. Paleta de color

Formato: HSL en la sintaxis cruda que usa shadcn (`H S% L%`, sin `hsl()`), para
pegar directo en `--variable: 221.2 83.2% 53.3%;` y consumir como
`hsl(var(--primary))` en `tailwind.config`.

Criterio de diseño: neutros basados en la escala "Slate" (la base más probada
de shadcn/ui, ya validada en miles de productos), con un **azul de marca**
como `primary`/`ring` para transmitir confianza y darle identidad al CTA
principal ("agregar gasto"), y tokens semánticos adicionales
(`success`/`warning`) que shadcn no trae de fábrica pero que una app
financiera necesita sí o sí.

Decisión importante: los tokens **semánticos de estado** (`primary`,
`destructive`, `success`, `warning`) usan el **mismo hue/lightness en light y
dark mode** — solo los neutros (`background`, `card`, `border`, etc.) cambian
entre modos. Esto simplifica la implementación (un solo color de marca que
memorizar) y evita tener que re-validar contraste dos veces por cada botón de
color: el contraste de un botón depende del fondo *del botón*, no del fondo
*de la página*.

### Light mode (`:root`)

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;

  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;

  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;

  --primary: 221.2 83.2% 53.3%;        /* azul marca, ~#2563eb */
  --primary-foreground: 210 40% 98%;

  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;

  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;

  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;

  --destructive: 0 72.2% 50.6%;         /* rojo, ~#dc2626 */
  --destructive-foreground: 0 0% 100%;

  --success: 142.1 70.6% 30%;           /* verde, ~#15803d */
  --success-foreground: 0 0% 100%;

  --warning: 38 92% 50%;                /* ámbar, ~#f59e0b */
  --warning-foreground: 222.2 47.4% 11.2%; /* texto oscuro, no blanco */

  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 221.2 83.2% 53.3%;            /* = primary */

  --radius: 0.625rem;
}
```

### Dark mode (`.dark`)

```css
.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;

  --card: 222.2 47% 8%;                 /* un punto más clara que el fondo
                                            para que las cards de gasto se
                                            distingan sin depender de sombra */
  --card-foreground: 210 40% 98%;

  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;

  --primary: 221.2 83.2% 53.3%;         /* mismo azul que en light */
  --primary-foreground: 210 40% 98%;

  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;

  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;

  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;

  --destructive: 0 72.2% 50.6%;         /* mismo rojo que en light */
  --destructive-foreground: 0 0% 100%;

  --success: 142.1 70.6% 30%;           /* mismo verde que en light */
  --success-foreground: 0 0% 100%;

  --warning: 38 92% 50%;                /* mismo ámbar que en light */
  --warning-foreground: 222.2 47.4% 11.2%;

  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 217.2 91.2% 65%;              /* azul más claro que en light: el
                                            primary de 53% de lightness no
                                            se ve bien como *anillo* de foco
                                            fino contra un fondo casi negro;
                                            este sí, y mantiene >3:1 contra
                                            el fondo dark */
}
```

Nota de honestidad: los valores hex entre paréntesis son aproximaciones de
referencia (equivalentes a Tailwind blue-600, red-600, green-700, amber-500).
Si `vue-frontend-expert` necesita el hex exacto para algo fuera de CSS
variables (p. ej. `theme-color` del manifest PWA en la iteración futura),
que lo recalcule con un conversor HSL→hex — no lo tome de memoria.

### Mapeo en `tailwind.config`

Estándar shadcn, nada especial salvo agregar `success` y `warning` al lado de
`destructive`:

```ts
colors: {
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",
  ring: "hsl(var(--ring))",
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
  secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
  destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
  success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
  warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
  muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
  accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
  popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
  card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
}
```

### Uso de `success` / `warning` / `destructive` (semántica de producto)

Con presupuestos por categoría/mes en mente (aunque no se implementen todavía):

- **success**: bajo presupuesto / gasto guardado con éxito (toast).
- **warning**: cerca del límite del presupuesto (p. ej. ≥80% consumido).
- **destructive**: presupuesto superado / eliminar un gasto / error de guardado.

Regla dura: **el color nunca es el único indicador**. Un badge o barra de
progreso en estos colores siempre va acompañado de texto o ícono (ver sección
de a11y).

**No pintar de rojo cada monto de gasto.** Todos los montos en v1 son gastos
(no hay ingresos todavía), así que colorear cada fila de rojo sería ruido
visual constante y le quitaría peso a las alertas reales. Los montos usan el
color de texto normal (`foreground`); reservar `destructive`/`success` para
estados de presupuesto, no para el signo del monto.

### Colores de categoría (badges)

Para las categorías de gasto (Comida, Transporte, Ocio, etc.) se necesita una
paleta categórica con suficiente separación perceptual, incluyendo para
daltonismo. En vez de inventar colores a ojo, se reutiliza la paleta
categórica de 8 tonos ya validada (CVD ΔE mínimo adyacente 24.2 en light /
10.3 en dark — por encima del piso aceptable):

| Slot | Uso sugerido | Light | Dark |
|---|---|---|---|
| 1 | Comida | `#2a78d6` | `#3987e5` |
| 2 | Transporte | `#1baf7a` | `#199e70` |
| 3 | Servicios/Hogar | `#eda100` | `#c98500` |
| 4 | Salud | `#008300` | `#008300` |
| 5 | Ocio | `#4a3aa7` | `#9085e9` |
| 6 | Compras | `#e34948` | `#e66767` |
| 7 | Otros | `#e87ba4` | `#d55181` |
| 8 | Extra (8ª categoría) | `#eb6834` | `#d95926` |

Reglas de uso:
- Asignar el orden de los slots de forma **fija** por categoría (no rotar
  colores dinámicamente); si en el futuro hay más de 8 categorías, la 9ª en
  adelante cae en un slot "Otros" gris neutro (`muted-foreground`), no se
  inventa un 9º hue.
- Slots 2 (aqua), 3 (amarillo) y 7 (magenta) tienen contraste bajo (<3:1)
  sobre fondo claro: en el badge, usar **texto oscuro** (no blanco) y no
  depender solo del chip de color — siempre mostrar el nombre de la
  categoría como texto, nunca solo un punto de color.
- Estos hex son literales, no pasan por `hsl(var(--x))`: son suficientemente
  específicos (identidad de categoría) como para no necesitar theming vía
  variable CSS. Definirlos como constantes en el módulo de categorías del
  frontend (o, mejor, como columna `color` en la tabla de categorías de
  Supabase para que el usuario/seed los controle).

---

## 2. Tipografía

**Familia**: **Inter**, vía `@fontsource/inter` o Google Fonts
(`family=Inter:wght@400;500;600;700`). Razones: excelente legibilidad en
pantallas chicas, cobertura completa de pesos, y soporte nativo de
`font-feature-settings: "tnum" 1` (números tabulares) sin necesitar una
fuente separada para cifras. Alternativa igual de válida si se quiere afinidad
con el hosting: **Geist Sans** (la fuente de Vercel, también con tabular
figures y gratuita) — cualquiera de las dos cumple; Inter es la opción más
segura por ser la más probada en producción.

```css
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
```

No se necesita una segunda familia monoespaciada para montos: `tabular-nums`
en Inter alcanza y evita el salto de "mezclar fuentes" en la misma pantalla.

### Escala de tamaños (mobile-first, `rem` sobre base 16px)

| Token Tailwind | Tamaño / line-height | Uso |
|---|---|---|
| `text-xs` | 12px / 16px | timestamps, metadatos, helper text de formulario |
| `text-sm` | 14px / 20px | texto secundario, labels de input, captions |
| `text-base` | 16px / 24px | texto de cuerpo, **inputs** (ver nota iOS abajo) |
| `text-lg` | 18px / 28px | título de card, subtítulos |
| `text-xl` | 20px / 28px | encabezado de sección |
| `text-2xl` | 24px / 32px | título de pantalla |
| `text-3xl` | 30px / 36px | monto hero (total del mes / balance) en mobile |
| `text-4xl` | 36px / 40px | mismo monto hero, a partir de `sm:` (≥640px) |

Nota crítica mobile: **ningún `<input>` debe tener `font-size` menor a 16px**.
Si el input queda por debajo de 16px, iOS Safari hace auto-zoom al enfocarlo,
lo cual es una rotura de UX conocida en PWAs instaladas. `text-base` (16px)
es el piso, no una sugerencia.

### Pesos

- `font-normal` (400): cuerpo de texto, descripciones.
- `font-medium` (500): labels, botones secundarios, nombres de categoría.
- `font-semibold` (600): títulos de card, montos en listas.
- `font-bold` (700): monto hero (dashboard/resumen), títulos de pantalla.

### Cómo destacar montos de dinero

1. **Siempre `font-variant-numeric: tabular-nums`** (clase Tailwind
   `tabular-nums`) en cualquier lugar donde haya una columna o lista de
   montos (filas de gasto, totales) — así los dígitos alinean verticalmente y
   se escanea la lista de un vistazo, sin que un "1" angosto desalinee todo.
2. **Jerarquía por contexto, no por color**:
   - Monto hero (total del mes, balance): `text-3xl sm:text-4xl font-bold
     tabular-nums tracking-tight`.
   - Monto en fila de lista de gastos: `text-base font-semibold
     tabular-nums`, alineado a la derecha.
   - Monto en un input de formulario (campo "Monto"): `text-base` como
     mínimo, considerar `text-lg font-semibold` para que el usuario vea
     claramente lo que está tipeando.
3. Símbolo de moneda en tamaño menor y peso normal que la cifra (p. ej. `$`
   en `text-sm font-normal text-muted-foreground` seguido del número en
   `font-semibold`), para que el número sea lo que domine visualmente.
4. No usar color semántico en el monto por defecto (ver regla de "no pintar
   de rojo cada gasto" arriba). El color se reserva para el estado de
   presupuesto, no para el número en sí.

---

## 3. Espaciado, radios, sombras

### Espaciado

Usar la escala default de Tailwind (base 4px) sin extenderla — ya cubre todo
lo necesario:

| Token | px | Uso principal |
|---|---|---|
| `1` | 4px | separación mínima entre ícono y texto inline |
| `2` | 8px | gap entre elementos muy relacionados (badge + label) |
| `3` | 12px | gap entre filas de una lista de gastos |
| `4` | 16px | padding horizontal de página (`px-4`), padding de card en mobile |
| `6` | 24px | padding de card en `sm:` en adelante, separación entre secciones |
| `8` | 32px | separación entre bloques grandes (header de pantalla vs contenido) |

Reglas concretas:
- Padding horizontal de página: `px-4` en mobile, `sm:px-6`, `lg:px-8`.
- Cards de la lista de gastos: `p-4` mobile, `sm:p-6`.
- Gap entre cards de la lista: `gap-3` (12px) — suficiente separación táctil
  sin desperdiciar scroll en una pantalla chica.
- Cuando se implemente PWA real (iteración futura), reservar ya el hábito de
  `pb-[env(safe-area-inset-bottom)]` en cualquier contenedor fijo al fondo
  (nav inferior, FAB), para no tener que retocar layout después.

### Border radius

```css
--radius: 0.625rem; /* 10px */
```

```ts
borderRadius: {
  sm: "calc(var(--radius) - 4px)",
  md: "calc(var(--radius) - 2px)",
  lg: "var(--radius)",
  xl: "calc(var(--radius) + 4px)",
}
```

`10px` de radio base da un look moderno y amigable (ni cuadrado/corporativo
ni tan redondeado que parezca infantil) — apropiado para una app de finanzas
personales que quiere transmitir seriedad sin ser fría. Botones y badges usan
`rounded-md`/`rounded-lg`; el FAB de "agregar gasto" (si se hace circular) usa
`rounded-full` explícito, no el token.

### Sombras

Mobile-first significa priorizar **borde + fondo** por sobre sombra para
separar superficies (más barato de renderizar, más nítido en pantallas
chicas, y funciona mejor en dark mode). Sombra se reserva para elementos
flotantes de verdad (dialog/sheet/popover), no para cards en reposo.

```css
--shadow-card: 0 1px 2px 0 rgb(0 0 0 / 0.05);          /* card en reposo, sutil */
--shadow-elevated: 0 4px 6px -1px rgb(0 0 0 / 0.1),
                    0 2px 4px -2px rgb(0 0 0 / 0.1);   /* dialog/sheet/popover */
```

En dark mode, bajar `--shadow-card` casi a cero (o quitarlo) y confiar en que
`--card` es más clara que `--background` para que la separación se perciba
igual — una sombra oscura sobre fondo ya oscuro no se ve.

---

## 4. Componentes shadcn-vue: qué instalar primero

### Fase 1 — imprescindibles ya (MVP: registrar/listar/editar/eliminar gasto)

| Componente | Por qué es prioritario ahora |
|---|---|
| **Button** | CTA principal ("Agregar gasto"), acciones de formulario, todo. |
| **Input** | Campos monto, descripción, y fallback de fecha (ver nota abajo). |
| **Label** | Todo input necesita label visible y asociado (`for`/`id`) — no placeholder-only. |
| **Card** | Unidad visual de cada fila de gasto y de los resúmenes del dashboard (ver justificación Card vs Table abajo). |
| **Select** | Selector de categoría al crear/editar gasto — lista corta y conocida, no necesita búsqueda todavía. |
| **Badge** | Tag de categoría dentro de cada card de gasto, usando la paleta categórica de la sección 1. |
| **Sheet** | Formulario de agregar/editar gasto como **bottom sheet** (`side="bottom"`) en vez de Dialog centrado — en mobile es el patrón esperado (más alcanzable con el pulgar, se siente nativo). Usar Sheet, no Dialog, para este flujo. |
| **Alert Dialog** | Confirmación antes de eliminar un gasto — una acción destructiva nunca debe ejecutarse sin un paso de confirmación explícito. |
| **Dropdown Menu** | Acciones por fila (Editar / Eliminar) detrás de un botón "⋮" — mejor que swipe-to-delete: descubrible, accesible por teclado/lector de pantalla, sin gestos ocultos. |
| **Separator** | Separar grupos de gastos por fecha ("Hoy", "Ayer", "12 jul") dentro de la lista. |
| **Sonner (Toast)** | Feedback de guardado/eliminado/error en cada operación contra Supabase — anuncia con `aria-live` sin bloquear la UI. |
| **Skeleton** | Estado de carga de la lista de gastos mientras responde Supabase — evita layout shift y comunica "está cargando" sin spinner bloqueante. |

### Fase 2 — cuando exista el schema de presupuestos

| Componente | Motivo para esperar |
|---|---|
| **Progress** | Barra de "gastado vs. presupuesto" por categoría/mes — no tiene sentido instalarlo hasta que el dato de presupuesto exista. |
| **Tabs** | Útil para alternar vistas (p. ej. "Este mes" / "Mes anterior", o Dashboard/Gastos/Presupuestos) una vez que haya más de una sección de navegación definida. |
| **Combobox / Command** | Solo si la lista de categorías crece lo suficiente como para necesitar búsqueda tipeada; con <10-12 categorías, Select alcanza. |
| **Calendar + Popover** | Para filtrar gastos por rango de fechas (p. ej. reportes) — no para el campo fecha del formulario de alta (ver nota abajo). |

### Explícitamente fuera de alcance / probablemente nunca en v1

- **Avatar**: no hay multi-usuario ni perfiles de otras personas que mostrar.
- **Table (data table)**: ver justificación abajo — no es el patrón mobile-first correcto para la lista principal.
- **Tooltip**: de bajo valor en touch-only (no hay hover); no priorizar.

### Justificación: Card-list en vez de Table para el listado de gastos

Se decide **lista de Cards**, no `<Table>`, como patrón principal para listar
gastos:

- Una tabla con columnas (fecha, categoría, descripción, monto, acciones)
  fuerza scroll horizontal en una pantalla de 360-390px de ancho, o columnas
  tan comprimidas que dejan de ser legibles — mala UX mobile-first.
- Una card por gasto permite jerarquía visual real: descripción como texto
  principal, categoría como badge, monto destacado alineado a la derecha,
  fecha como metadato secundario — todo apilado y legible sin comprimir nada.
- El área de toque de una card completa (o de su menú "⋮") es más grande y
  más fácil de acertar con el pulgar que una fila de tabla densa.
- Si en el futuro se agrega una vista de reportes/exportación en desktop
  ancho, ahí sí una tabla real puede tener sentido como vista alternativa —
  pero no reemplaza la lista de cards en mobile.

### Nota: campo fecha del formulario de alta de gasto

Para la fecha del gasto en el formulario de alta/edición, usar un
`<input type="date">` nativo (estilizado con las clases de Input) en vez de
armar un `Popover + Calendar` de shadcn-vue. El date picker nativo del
sistema operativo es más rápido de usar en mobile, no agrega JS/bundle extra,
y ya es accesible por defecto. Reservar `Calendar` para un futuro filtro de
rango de fechas en una vista de reportes, donde sí hace falta un calendario
custom con selección de rango.

---

## 5. Accesibilidad — lineamientos concretos para implementar

1. **Contraste**: todos los pares texto/fondo definidos en la sección 1 ya
   están elegidos para cumplir AA (≥4.5:1 texto normal, ≥3:1 texto grande y
   componentes de UI). No introducir combinaciones nuevas (p. ej. texto
   `muted-foreground` sobre `accent`) sin verificarlas con un checker de
   contraste antes de usarlas en producción.
2. **Área táctil mínima 44×44px** (referencia Apple HIG / equivalente a
   Material 48dp). En la práctica: `Button` en su tamaño `default` debe medir
   al menos `h-11` (44px) de alto en mobile; cualquier botón de solo ícono
   (el "⋮" del Dropdown Menu, el botón de cerrar de un Sheet) usa
   `size="icon"` con mínimo `h-11 w-11`, no lo reduzcas a `h-8`/`h-9` "porque
   se ve más prolijo". Entre dos elementos tocables adyacentes, dejar al
   menos `gap-2` (8px) para evitar toques accidentales.
3. **Foco visible siempre**: nunca `outline: none` sin reemplazo. Usar el
   patrón de shadcn `focus-visible:outline-none focus-visible:ring-2
   focus-visible:ring-ring focus-visible:ring-offset-2` en todo elemento
   interactivo custom. Esto importa incluso en una PWA mobile: hay usuarios
   con teclado externo (tablets) y con switch access.
4. **Inputs con `font-size` ≥16px** (ya cubierto en tipografía) para evitar
   el auto-zoom de iOS Safari al enfocar un campo — es tanto a11y/usabilidad
   como requisito técnico de PWA instalada.
5. **Labels visibles, no placeholder-only**: cada `Input`/`Select` lleva un
   `<Label>` persistente asociado por `for`/`id`. El placeholder puede dar un
   ejemplo de formato, nunca reemplaza al label (un placeholder desaparece al
   tipear y falla como referencia para lectores de pantalla en formularios
   largos).
6. **Color nunca como único indicador**: badges de categoría y estados de
   presupuesto (success/warning/destructive) siempre acompañados de texto o
   ícono, nunca solo un chip de color (ya detallado en sección 1).
7. **Confirmación antes de destruir**: cualquier acción irreversible
   (eliminar gasto, eliminar categoría) pasa por `Alert Dialog`, nunca se
   ejecuta directo desde un tap en el ícono de basura.
8. **`prefers-reduced-motion`**: las transiciones de Sheet/Dialog/toast deben
   respetar `@media (prefers-reduced-motion: reduce)` (reducir o eliminar la
   animación de entrada/salida) — Reka UI lo soporta de fábrica en sus
   primitivos, no desactivarlo manualmente al customizar.

---

## Resumen para `vue-frontend-expert`

1. Instalar Tailwind + shadcn-vue con los tokens de la sección 1 (bloques
   `:root`/`.dark` listos para copiar) y el `tailwind.config` de la sección 1.
2. Configurar fuente Inter (sección 2) como `font-sans` global; aplicar la
   escala de tamaños y la regla de `tabular-nums` en montos desde el primer
   componente que muestre dinero.
3. Instalar los componentes de **Fase 1** de la sección 4 vía CLI de
   shadcn-vue (`Button`, `Input`, `Label`, `Card`, `Select`, `Badge`, `Sheet`,
   `Alert Dialog`, `Dropdown Menu`, `Separator`, `Sonner`, `Skeleton`) —
   nada de Fase 2 todavía.
4. Aplicar los lineamientos de a11y de la sección 5 como checklist en cada
   componente nuevo, no como pasada final al terminar.
