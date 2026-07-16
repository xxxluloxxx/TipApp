# TipApp — UX del MVP de Gastos (v1)

Documento de especificación funcional/UX para `vue-frontend-expert`. Cubre
autenticación, listado principal, alta de gasto y navegación. Da por sentado
todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía, Card-list,
Sheet inferior, fecha con `<input type="date">` nativo, a11y) — no se repite
esa justificación acá, solo se referencia.

Componentes shadcn-vue disponibles (ya instalados, no instalar nada más):
Button, Input, Label, Card, Select (con sus subcomponentes `SelectGroup` /
`SelectLabel` / `SelectSeparator`, que vienen en el mismo archivo generado por
la CLI de shadcn-vue), Badge, Sheet, Alert Dialog, Dropdown Menu, Separator,
Sonner (toast), Skeleton.

Iconos: `@lucide/vue` (ya en uso en `App.vue`: `EllipsisVertical`, `Moon`,
`Pencil`, `Sun`, `Trash2`). Para esta iteración se suman como referencia:
`Plus`, `LogOut`, `User`, `Loader2`, `AlertCircle`, `Inbox`/`Receipt`,
`RotateCcw`.

---

## 1. Login / Registro

### 1.1 Decisión: dos rutas separadas, no toggle en una sola pantalla

`/login` y `/registro` como vistas independientes, cada una con su propio
`<h1>` y su propio formulario, enlazadas entre sí con un link de texto al
pie ("¿No tenés cuenta? Creá una").

Justificación (es la única decisión de esta sección con alternativas reales):
- Cada pantalla tiene un único formulario y un único estado de validación que
  gestionar — menos ramificación de estado (`isRegisterMode` condicionando
  campos, validaciones y copy) que un toggle en el mismo componente.
- URLs distintas son deep-linkeables y compatibles con el botón "atrás" del
  navegador/gesto del sistema (importante en PWA instalada en Android, donde
  el botón atrás del sistema navega el historial de la WebView).
- Un solo `<h1>` fijo por pantalla es más simple para lectores de pantalla
  que anunciar un cambio de modo dentro de la misma pantalla.
- El copy y las reglas de validación difieren bastante entre login y
  registro (confirmación de contraseña, mensajes de error distintos); el
  toggle no ahorra tanto código como parece y complica el a11y.

### 1.2 Layout mobile-first (ambas pantallas)

Contenedor centrado vertical y horizontalmente, `min-h-screen`, ancho máximo
`max-w-sm` (~384px), padding `px-4`. Estructura de arriba a abajo:

1. Nombre de la app: `TipApp` en `text-2xl font-bold` (no hay logo gráfico
   todavía; texto alcanza para v1).
2. Subtítulo corto en `text-sm text-muted-foreground`:
   - Login: "Iniciá sesión para ver tus gastos"
   - Registro: "Creá tu cuenta para empezar a registrar gastos"
3. `<Card class="p-4 sm:p-6">` conteniendo el `<form>`.
4. Dentro del Card, campos apilados con `gap-4`, cada uno como
   `<div class="flex flex-col gap-1.5">` con `<Label>` + `<Input>`, igual
   patrón que en `App.vue`.
5. Botón submit `Button` ancho completo (`class="w-full"`), tamaño `default`
   (`h-11` mínimo, ya cubierto por el design system).
6. Link secundario centrado debajo del Card, `text-sm`, hacia la otra ruta.

Todos los `<Input>` con `text-base` (16px, ya definido) para evitar zoom de
iOS. `autocomplete` correcto en cada campo (ver abajo) para que el
autocompletado del navegador/gestor de contraseñas funcione.

### 1.3 Pantalla `/login`

Campos:

| Campo | Input | Atributos |
|---|---|---|
| Email | `type="email"` | `autocomplete="email"`, `inputmode="email"`, `required` |
| Contraseña | `type="password"` | `autocomplete="current-password"`, `required` |

Labels/placeholders (copy exacto):

- Label email: `Email` — placeholder: `tu@email.com`
- Label contraseña: `Contraseña` — placeholder: vacío (no hace falta
  placeholder en un campo de contraseña, un formato de ejemplo no aporta).

Validación de cliente (antes de llamar a Supabase):
- Email: no vacío, formato válido (regex simple `/^\S+@\S+\.\S+$/` o
  `input.checkValidity()` nativo del `type="email"`). Error inline debajo del
  campo: `Ingresá un email válido.`
- Contraseña: no vacía. Error inline: `Ingresá tu contraseña.`
- No se valida longitud mínima en login (eso es responsabilidad del
  registro; en login alcanza con "no vacío" — la contraseña real ya existe,
  no hace falta re-validar su forma).

Botón submit: texto `Iniciar sesión`. Estado de carga: disabled +
`Loader2` girando (clase `animate-spin`) + texto `Ingresando…`.

Estados de error (todos como `Alert` variant `destructive` **dentro del
Card, arriba del formulario** — no toast, porque es un error que bloquea el
submit y el usuario necesita verlo estable mientras corrige, no un mensaje
que desaparece):

| Caso | Mensaje |
|---|---|
| Credenciales inválidas (Supabase `Invalid login credentials`) | `Email o contraseña incorrectos.` (nunca decir cuál de los dos está mal — por seguridad, no revelar si el email existe) |
| Email sin confirmar (si Supabase lo exige) | `Tu cuenta todavía no fue confirmada. Revisá tu email y confirmá tu cuenta antes de iniciar sesión.` |
| Error de red / Supabase caído | `No pudimos conectar. Revisá tu conexión e intentá de nuevo.` |
| Otro error inesperado | `Ocurrió un error. Intentá de nuevo en unos minutos.` |

Éxito: no hay toast en login (evita ruido — el usuario ya ve el cambio de
pantalla como confirmación). Redirect inmediato a `/` (home).

### 1.4 Pantalla `/registro`

Campos:

| Campo | Input | Atributos |
|---|---|---|
| Email | `type="email"` | `autocomplete="email"`, `required` |
| Contraseña | `type="password"` | `autocomplete="new-password"`, `required` |
| Confirmar contraseña | `type="password"` | `autocomplete="new-password"`, `required` |

Labels/placeholders:
- `Email` — placeholder `tu@email.com`
- `Contraseña` — placeholder vacío; helper text debajo en
  `text-xs text-muted-foreground`: `Mínimo 8 caracteres.`
- `Confirmar contraseña` — placeholder vacío.

Validación de cliente:
- Email: mismo criterio que login. Error: `Ingresá un email válido.`
- Contraseña: mínimo 8 caracteres. Error: `La contraseña debe tener al menos 8 caracteres.`
  - Nota para `supabase-backend-expert`/config del proyecto: alinear el
    mínimo de contraseña configurado en Supabase Auth (por defecto 6) a 8
    para que backend y frontend no diverjan. Si no se puede cambiar la
    config del proyecto, el frontend igual exige 8 como piso de buena
    práctica — no baja el estándar por la config default.
- Confirmar contraseña: debe ser igual a "Contraseña". Error:
  `Las contraseñas no coinciden.` — se valida en `blur` del campo de
  confirmación y de nuevo al submit.
- Validación al `blur` de cada campo (no solo al submit) para dar feedback
  temprano, pero **nunca marcar error mientras el usuario todavía está
  tipeando el primer carácter** (validar en `blur`, no en cada `input`, para
  no castigar en tiempo real).

Botón submit: texto `Crear cuenta`. Loading: disabled + spinner +
`Creando cuenta…`.

Estados de error (mismo patrón de `Alert destructive` dentro del Card):

| Caso | Mensaje |
|---|---|
| Email ya registrado (Supabase `User already registered` / 422) | `Ese email ya está registrado. Iniciá sesión o usá otro email.` (con el link de "Iniciar sesión" ya visible al pie de la pantalla, no hace falta repetirlo como botón aparte) |
| Error de red | `No pudimos conectar. Revisá tu conexión e intentá de nuevo.` |
| Otro error inesperado | `Ocurrió un error. Intentá de nuevo en unos minutos.` |

### 1.5 Resultado del registro exitoso: dos variantes posibles

El flujo debe contemplar ambos casos sin bloquear el diseño en cuál está
activo en el proyecto real (se decide en runtime según la respuesta de
Supabase, no se hardcodea un solo camino):

**Caso A — Auto-confirm activo (sesión creada inmediatamente):**
`supabase.auth.signUp()` devuelve `session` no nula. Se redirige
directamente a `/` y se muestra un toast de éxito:
`toast.success('¡Cuenta creada!', { description: 'Bienvenido/a a TipApp.' })`.

**Caso B — Requiere confirmación de email:**
`signUp()` devuelve `session: null` (usuario creado pero sin sesión activa).
En ese caso **no** redirigir a `/`; reemplazar el contenido del Card por un
estado de "revisá tu correo" (no un toast, porque el usuario debe quedarse
en esta pantalla, no es un mensaje pasajero):

- Ícono (`Inbox` o similar) + título `Confirmá tu email` (`text-lg font-semibold`)
- Texto: `Te enviamos un link de confirmación a **{email}**. Abrilo para activar tu cuenta y después iniciá sesión.`
- Botón secundario (`variant="outline"`, ancho completo): `Ir a iniciar sesión` → navega a `/login`.

### 1.6 Copy de resumen (referencia rápida para el implementador)

```
/login
  Título:        TipApp
  Subtítulo:     Iniciá sesión para ver tus gastos
  Label 1:       Email          | placeholder: tu@email.com
  Label 2:       Contraseña
  Botón:         Iniciar sesión  (loading: Ingresando…)
  Link inferior: ¿No tenés cuenta? Creá una

/registro
  Título:        TipApp
  Subtítulo:     Creá tu cuenta para empezar a registrar gastos
  Label 1:       Email              | placeholder: tu@email.com
  Label 2:       Contraseña         | helper: Mínimo 8 caracteres.
  Label 3:       Confirmar contraseña
  Botón:         Crear cuenta       (loading: Creando cuenta…)
  Link inferior: ¿Ya tenés cuenta? Iniciá sesión
```

---

## 2. Pantalla principal (listado de gastos)

Ruta protegida `/` (nombre de ruta `home`, ver sección 4).

### 2.1 Header

Barra superior fija (no fixed/sticky obligatorio en v1, basta con estar al
tope del scroll normal), mismo patrón que `App.vue`:

- Izquierda: `TipApp` (`text-xl font-semibold`).
- Derecha: botón ícono (`variant="ghost" size="icon"`, ícono `User`,
  `aria-label="Cuenta"`) que abre un `DropdownMenu`:
  - Item no interactivo arriba (texto plano, no `DropdownMenuItem`
    clickeable): nombre del usuario (`profiles.display_name` si existe, si
    no el email de `auth.user`) en `font-medium`, y debajo el email en
    `text-xs text-muted-foreground` si se mostró el display_name arriba.
  - `DropdownMenuSeparator`.
  - `DropdownMenuItem` con ícono `LogOut`: `Cerrar sesión`.

No se usa el componente `Avatar` (explícitamente fuera de alcance en el
design system): el botón de cuenta es un ícono genérico `User`, no una
imagen de perfil, aunque `profiles.avatar_url` exista en el schema — mostrar
avatar real queda fuera de esta iteración.

Logout: no requiere `AlertDialog` de confirmación (cerrar sesión no destruye
datos, es reversible con volver a loguearse) — el click en "Cerrar sesión"
ejecuta `supabase.auth.signOut()` directo, redirige a `/login` y muestra
`toast('Sesión cerrada')` (variant neutra, no success ni destructive).

### 2.2 Monto hero: SÍ, dentro de alcance

Se incluye el total del mes en curso, igual que en la demo de `App.vue`:

- `Card` arriba de la lista con `CardDescription` = `Total de {mes} {año}`
  (p. ej. `Total de julio 2026`, mes en minúscula, español) y `CardTitle`
  con el monto en `text-3xl sm:text-4xl font-bold tabular-nums tracking-tight`.
- Cálculo: suma de `amount` de todos los `expenses` del usuario donde
  `expense_date` cae en el mes/año actual (mes calendario, no "últimos 30
  días").
- Justificación de incluirlo ahora (vs. dejarlo fuera de alcance): es un
  `SUM` simple sobre datos que de todas formas ya se traen para la lista (o
  un query adicional trivial), la jerarquía tipográfica para este número ya
  está definida en el design system esperando este uso, y da valor
  inmediato al usuario sin esperar a la feature de presupuestos (Fase 2).
- Si el mes no tiene gastos todavía, mostrar el monto en `$0` igual (no
  ocultar el Card) — evita que la pantalla salte de layout entre "sin
  gastos este mes" y "con gastos".
- Este total es **solo del mes actual**, no all-time; la lista de abajo
  (2.3) sí es all-time. Esto es intencional: el hero responde "¿cuánto
  llevo gastado este mes?", la lista responde "¿qué gasté y cuándo?" — son
  dos preguntas distintas y no hace falta que compartan el mismo filtro.

### 2.3 Listado de gastos: alcance, orden y agrupación

- **Alcance temporal**: se listan **todos** los gastos del usuario (no
  filtrado por mes) — filtros de rango de fecha y reportes quedan para
  Fase 2 (Tabs "Este mes"/"Mes anterior" ya previstas en el design system).
  No paginar todavía; traer todo con un límite defensivo razonable (p. ej.
  `LIMIT 200` en el query) para no diseñar infinite-scroll en esta
  iteración — si un usuario supera esa cantidad de gastos históricos es un
  problema de la siguiente iteración, no de esta.
- **Orden**: por `expense_date` descendente; dentro del mismo
  `expense_date`, por `created_at` descendente (el gasto cargado más
  recientemente aparece primero dentro de su día).
- **Agrupación visual** por fecha, con encabezado de grupo
  (`text-xs font-medium text-muted-foreground`, mismo patrón que `App.vue`)
  y `Separator` entre grupos:
  - Si `expense_date` es hoy → encabezado `Hoy`.
  - Si es ayer → encabezado `Ayer`.
  - Si es de este año (pero no hoy/ayer) → `d 'de' MMMM` (p. ej.
    `12 de julio`), sin año.
  - Si es de un año anterior → `d 'de' MMMM 'de' yyyy` (p. ej.
    `3 de diciembre de 2025`).
- Cada card de gasto sigue exactamente el patrón ya validado en `App.vue`:
  descripción como texto principal (o, si no hay descripción, el **nombre
  de la categoría** hace de texto principal — ver 2.3.1), `Badge` de
  categoría con el color de su slot, monto alineado a la derecha
  (`text-base font-semibold tabular-nums`), y `DropdownMenu` con
  Editar/Eliminar detrás del ícono `⋮`.

#### 2.3.1 Gasto sin descripción (recordar: descripción es opcional, ver 3.3)

Cuando `description` es `null`, la card no puede quedar con el espacio de
texto principal vacío. Regla: usar el **nombre de la categoría** como texto
principal en ese caso (`font-medium`, igual jerarquía que si fuera
descripción), y en ese caso **no repetir** el badge de categoría debajo (ya
está dicho arriba) — mostrar solo el Badge de categoría sin duplicar el
nombre en texto plano. Dicho de otro modo:

- Con descripción: línea 1 = descripción (`font-medium`), línea 2 = Badge
  de categoría.
- Sin descripción: línea 1 = nombre de categoría (`font-medium`, funciona
  como título de la card), línea 2 = Badge de la misma categoría (el badge
  aporta el color/identidad visual aunque el texto se repita — es
  aceptable, el badge es un elemento visual corto, no ruido de lectura).

### 2.4 Estado vacío (usuario nuevo, cero gastos jamás)

Reemplaza el hero + la lista por un solo bloque centrado verticalmente en
el espacio disponible (no un Card, contenido "flotante" en la página):

- Ícono grande (`Receipt` o `Inbox`, `size-12 text-muted-foreground`).
- Título (`text-lg font-semibold`): `Todavía no registraste ningún gasto`
- Texto (`text-sm text-muted-foreground`, `max-w-xs text-center`):
  `Empezá a registrar tus gastos para ver acá tu resumen y tu historial.`
- Botón (`Button`, no `variant="outline"`, el CTA principal):
  `Agregar tu primer gasto` → abre el mismo Sheet de alta descrito en la
  sección 3 (no es una pantalla distinta al Sheet normal).
- El FAB (2.6) **igual permanece visible** en este estado — el botón del
  estado vacío y el FAB abren el mismo Sheet; no son flujos distintos, es
  solo un segundo punto de entrada más contextual para el caso "primera
  vez".

### 2.5 Estado de carga

Mientras se resuelve el query de Supabase (hero + lista):

- Hero: `Card` con `Skeleton` de `h-4 w-32` (para el label "Total de...") y
  `Skeleton` de `h-9 w-40` (para el monto), mismo padding que el Card real,
  para que no haya salto de layout cuando llegue el dato real.
- Lista: **4 cards Skeleton** (no más — es un número que comunica "está
  cargando" sin obligar a hacer scroll para ver que ya terminó en pantallas
  chicas), cada una reproduciendo la forma de una card real: dos líneas a
  la izquierda (`Skeleton h-4 w-32` + `Skeleton h-5 w-20 rounded-full`) y un
  bloque a la derecha (`Skeleton h-5 w-16`) — es exactamente el bloque que
  ya existe de ejemplo en `App.vue` línea 202-210, reutilizar tal cual,
  simplemente repetido 4 veces sin encabezados de grupo (el Skeleton no
  necesita simular "Hoy"/"Ayer").
- No mostrar el FAB mientras carga el estado inicial (evita que el usuario
  intente agregar un gasto antes de saber si ya tiene alguno) — sí
  mostrarlo apenas se resuelve la carga, con datos o vacío.

### 2.6 Estado de error (falla el query a Supabase)

No es un toast (un toast desaparece y el usuario se queda sin lista y sin
explicación). Reemplaza hero + lista por un bloque centrado, mismo slot que
el estado vacío:

- Ícono `AlertCircle` (`size-12 text-destructive`).
- Título (`text-lg font-semibold`): `No pudimos cargar tus gastos`
- Texto (`text-sm text-muted-foreground`): `Revisá tu conexión e intentá de nuevo.`
- Botón (`variant="outline"`, con ícono `RotateCcw`): `Reintentar` → vuelve
  a disparar el mismo query (no recarga la página completa).

### 2.7 Botón de agregar gasto: FAB flotante

Decisión: **FAB circular flotante**, no botón en el header ni botón al
final de la lista.

- Posición: `fixed bottom-6 right-4` (mobile) — usar
  `bottom-[calc(1.5rem+env(safe-area-inset-bottom))]` para PWA instalada
  (ya anticipado en la sección de espaciado del design system).
  En `sm:` en adelante puede subir a `right-6`.
- Forma: `Button size="icon" class="h-14 w-14 rounded-full shadow-elevated"`
  (más grande que el mínimo de 44px de a11y — un FAB primario se beneficia
  de un blanco de toque generoso, y es el único elemento flotante de la
  pantalla así que puede "pesar" visualmente más), color `primary`.
- Contenido: ícono `Plus` (`size-6`), `aria-label="Agregar gasto"` (el FAB
  no lleva texto visible, solo ícono — el `aria-label` es obligatorio acá).
- Justificación de FAB vs. alternativas:
  - **Header**: un botón "Agregar" arriba a la derecha compite con el
    header de logout/cuenta y queda lejos del pulgar en la mayoría de los
    tamaños de mano al usar la app a una mano (zona superior de la pantalla
    es la más incómoda de alcanzar en mobile).
  - **Al final de la lista**: obliga a scrollear hasta el final para
    agregar un gasto, justo la acción que el usuario quiere hacer **más**
    seguido y **más rápido** — es la peor opción de fricción para la tarea
    principal de la app.
  - **FAB**: siempre visible, siempre en la zona cómoda del pulgar (esquina
    inferior), es el patrón esperado en apps mobile de registro rápido
    (tipo Splitwise, Google Pay, etc.), y no compite visualmente con nada
    más porque es el único elemento flotante.
- El FAB permanece fijo mientras se scrollea la lista (no se oculta al
  hacer scroll hacia abajo en v1 — ese comportamiento de auto-hide es una
  optimización opcional futura, no necesaria para el MVP).

---

## 3. Alta de gasto (Sheet inferior)

Se abre desde el FAB (2.7) o desde el botón del estado vacío (2.4). Mismo
Sheet en ambos casos. También se reutiliza para **editar** un gasto
existente (ver 3.6), con diferencias mínimas de copy.

### 3.1 Estructura del Sheet

`SheetContent side="bottom"`, con:

- `SheetHeader` → `SheetTitle`: `Nuevo gasto` (o `Editar gasto` en modo
  edición) + `SheetDescription`: `Completá los datos del gasto.` (se puede
  omitir la description en edición, es redundante).
- Body con los 3 campos (orden fijo, ver 3.2-3.4), `gap-4`, `px-4`.
- `SheetFooter` con un único botón ancho completo `Guardar gasto` (o
  `Guardar cambios` en edición) — no hay botón "Cancelar" explícito en el
  footer porque el Sheet ya tiene su propio affordance de cierre (ícono X
  del header de Reka UI / swipe down / tap fuera); agregar un segundo botón
  "Cancelar" al lado sería redundante con eso.

### 3.2 Campo: Monto

- `<Label for="monto">Monto</Label>`
- `<Input id="monto" inputmode="decimal" type="text" placeholder="0" class="text-lg font-semibold tabular-nums">`
  (mismo patrón que `App.vue`; `type="text"` en vez de `number` para
  controlar el formato de decimales manualmente y evitar el spinner nativo
  de `type="number"`, que en mobile agrega flechitas inútiles y complica
  `inputmode`).
- Prefijo visual `$` fuera del input o dentro como texto absolutamente
  posicionado (`text-sm text-muted-foreground`), según lo que ya defina el
  componente `Input` de shadcn-vue instalado — si no tiene slot para
  prefijo, alcanza con el placeholder `0` y el símbolo `$` como texto fijo
  a la izquierda del input dentro del mismo `div flex items-center`.
- Validación: requerido, debe ser numérico, **estrictamente mayor a 0**
  (la constraint de la tabla `expenses` ya lo exige a nivel de BD — se
  valida también en cliente para dar feedback antes del roundtrip). Error
  inline debajo del campo: `Ingresá un monto mayor a 0.`
- No se valida un máximo — es gasto personal, cualquier monto positivo es
  válido.

### 3.3 Campo: Descripción — decisión: OPCIONAL

- `<Label for="descripcion">Descripción <span class="text-muted-foreground font-normal">(opcional)</span></Label>`
  (el "(opcional)" en el label es la señal más clara y accesible de que no
  es requerido — más confiable que solo el placeholder).
- `<Input id="descripcion" placeholder="Ej. Almuerzo con el equipo" maxlength="200">`
- Sin validación de contenido (cualquier texto o vacío es válido). El
  `maxlength="200"` es un tope silencioso (no se muestra contador de
  caracteres, no aporta suficiente valor en un campo tan corto como para
  justificar el elemento visual extra).
- Justificación de opcional (vs. obligatorio): la categoría + el badge de
  color ya identifican de qué es el gasto en la mayoría de los casos
  (p. ej. "Transporte" con monto $18.200 ya es suficientemente claro sin
  texto adicional). Obligar una descripción agrega fricción justo en el
  flujo que el usuario quiere hacer rápido y seguido (carga de gasto
  cotidiano) a cambio de un beneficio marginal. Ver también 2.3.1 (fallback
  de texto principal cuando no hay descripción).

### 3.4 Campo: Fecha

- `<Label for="fecha">Fecha</Label>`
- `<input id="fecha" type="date" class="[clases de Input]">` — nativo, no
  Popover+Calendar (ya resuelto en el design system).
- Valor por defecto: fecha de hoy (`YYYY-MM-DD` calculado en cliente al
  abrir el Sheet), **no vacío** — el usuario no debería tener que pensar en
  la fecha para el caso más común (cargar un gasto de hoy mismo).
- Atributo `max` = fecha de hoy → bloquea seleccionar fechas futuras desde
  el date picker nativo. Se agrega igual una validación explícita en JS al
  submit (`fecha > hoy` → error `La fecha no puede ser futura.`) porque
  algunos navegadores permiten tipear una fecha manualmente saltándose el
  `max` del picker visual.
- Sin `min` — se permite cargar gastos retroactivos de cualquier
  antigüedad (es una app de registro personal, no hay razón de negocio para
  limitar hacia atrás).
- Requerido (siempre tiene valor por el default, pero si se llegara a
  vaciar manualmente, error: `Seleccioná una fecha.`).

### 3.5 Campo: Categoría (Select, default + custom mezcladas y agrupadas)

- `<Label for="categoria">Categoría</Label>`
- `<Select>` con `SelectTrigger id="categoria" class="h-11 w-full"` y
  `SelectValue placeholder="Seleccioná una categoría"`.
- Contenido agrupado con `SelectGroup` + `SelectLabel` (subcomponentes ya
  incluidos en el archivo de `Select` generado por shadcn-vue — no requiere
  instalar nada nuevo):
  - Grupo 1, `SelectLabel`: `Categorías` → todas las `categories` con
    `user_id IS NULL` (las default del sistema), orden fijo (el mismo
    orden fijo de slots de color de la sección 1 del design system:
    Comida, Transporte, Servicios/Hogar, Salud, Ocio, Compras, Otros, más
    la 8ª si existe).
  - `SelectSeparator` entre grupos si el usuario tiene categorías propias;
    si no tiene ninguna custom, no se muestra el segundo grupo.
  - Grupo 2, `SelectLabel`: `Mis categorías` → `categories` con
    `user_id = auth.uid()`, orden alfabético.
- Cada `SelectItem` muestra el nombre de la categoría con un pequeño punto
  de color a la izquierda (`<span class="size-2.5 rounded-full" :style="{ background: category.color }">`)
  usando la columna `color` de la tabla — **no hace falta ningún otro
  distintivo visual entre default y custom** más allá de estar en grupos
  separados con su `SelectLabel`: el agrupamiento por texto ("Categorías" /
  "Mis categorías") ya cumple la regla de a11y de "nunca solo color" mejor
  que, por ejemplo, un ícono de candado o una palabra "(personalizada)" al
  lado de cada una, que sería ruido repetido en cada fila.
- Si `categories.icon` tiene un valor (string), es una mejora opcional para
  una iteración futura (mapear a un ícono de lucide); no bloquea esta
  iteración — usar solo el punto de color por ahora.
- Requerido. Error si se intenta enviar sin selección: `Seleccioná una categoría.`
- Sin valor por defecto preseleccionado (a diferencia de la fecha): forzar
  al usuario a elegir conscientemente evita que se cuelen gastos en la
  categoría "que quedó seleccionada de la carga anterior" por error — la
  fecha default a hoy es una comodidad de alta frecuencia, la categoría
  default sería una fuente de datos mal categorizados por descuido.

### 3.6 Validación completa antes de enviar a Supabase

Al tocar "Guardar gasto", validar en este orden y enfocar el primer campo
con error (no mostrar los 3 errores a la vez si ya hay uno arriba sin
resolver, para no abrumar — pero si el usuario ya vio uno y corrige, se
revalida todo de nuevo al reintentar submit):

1. Monto: presente y > 0.
2. Categoría: seleccionada.
3. Fecha: presente y no futura.

Si algo falla, no se llama a Supabase — los errores son 100% evitables en
cliente antes del roundtrip (a diferencia de "email ya registrado", que
solo el servidor puede saber).

### 3.7 Estado de guardando

- Botón `Guardar gasto` → `disabled` + ícono `Loader2` girando + texto
  `Guardando…`.
- Todos los campos del formulario pasan a `disabled` durante el guardado
  (evita que el usuario edite un valor mientras el request ya está en
  vuelo con los valores anteriores).
- El Sheet **no se puede cerrar** mientras se guarda: deshabilitar el
  cierre por tap-fuera/swipe/Escape mientras `isSaving === true` (en Reka
  UI: prevenir el cierre condicionando `@interact-outside.prevent` /
  `@escape-key-down.prevent` a ese estado), para que no quede una
  operación en vuelo sin que el usuario sepa si se guardó o no.

### 3.8 Después de guardar: decisión — actualización optimista

Se hace **insert optimista en el estado local**, no un refetch completo a
Supabase después de guardar:

1. Al tocar "Guardar gasto" y pasar la validación de 3.6, se construye de
   inmediato un objeto de gasto "pendiente" con los datos del formulario +
   la categoría completa ya disponible en memoria (viene de la lista de
   categorías ya cargada para poblar el Select, así que no hace falta
   esperar al servidor para saber su nombre/color) + un id temporal
   (`crypto.randomUUID()` o similar) y se **prepende** a la lista local en
   el grupo de fecha correcto.
2. El Sheet se cierra inmediatamente y el FAB vuelve a estar disponible —
   el usuario percibe la operación como instantánea.
3. La card recién insertada se muestra con una señal visual sutil de
   "pendiente de confirmar" (`opacity-70`, sin badge de "guardando" ni
   spinner por card — sutil, no ansioso) hasta que Supabase confirma.
4. Cuando la promesa de `insert()` a Supabase resuelve OK: se reemplaza el
   id temporal por el id real devuelto, se quita el `opacity-70`, y se
   dispara `toast.success('Gasto agregado', { description: '$<monto> en <categoría>' })`.
5. Si la promesa falla: se **remueve** la card optimista de la lista (no
   queda un gasto fantasma) y se muestra
   `toast.error('No se pudo guardar el gasto', { description: 'Revisá tu conexión e intentá de nuevo.', action: { label: 'Reintentar', onClick: () => reintentar-el-mismo-insert() } })`
   — el toast de error lleva un botón "Reintentar" que reintenta el mismo
   payload sin que el usuario tenga que volver a abrir el Sheet y
   retipear todo.
6. El hero de "Total del mes" (2.2) se actualiza optimistamente en el mismo
   paso 1 si la fecha del gasto cae en el mes en curso (sumar/restar el
   monto localmente), y se corrige/revierte junto con los pasos 4/5.

Justificación de optimista sobre refetch: la operación más frecuente de
toda la app es "agregar un gasto" — es la tarea principal del producto. Un
refetch completo después de cada alta implica un segundo roundtrip
(insert + select) y una espera visible antes de que el usuario vea su
propio gasto reflejado, lo cual se siente lento en conexiones móviles. Ya
se tiene toda la información necesaria en cliente para renderizar la card
final sin adivinar nada (la categoría completa viene del Select, no hace
falta que el servidor la devuelva) — el único dato que realmente viene del
servidor es el `id` definitivo y los timestamps, que no afectan lo que el
usuario ve.

### 3.9 Edición de un gasto existente (modo alternativo del mismo Sheet)

Mismo Sheet, mismos 3 campos, precargados con los valores del gasto
seleccionado desde el `DropdownMenu` → `Editar` de la card (patrón ya en
`App.vue`). Título: `Editar gasto`. Botón: `Guardar cambios`. Misma
validación (3.6), mismo patrón de guardando (3.7). Actualización tras
guardar: también optimista — se actualiza el objeto en el array local en su
posición actual y luego, si cambió la fecha, se reordena/regrupa la lista;
si falla el `update()`, se revierte a los valores previos (guardados en
memoria antes de aplicar el cambio optimista) + mismo patrón de toast de
error con "Reintentar".

Eliminar un gasto (fuera del alcance detallado de este documento porque ya
está resuelto en el design system: `AlertDialog` de confirmación → mismo
patrón optimista de remover de la lista local y revertir si falla).

---

## 4. Navegación y guard de autenticación

### 4.1 Rutas

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/login` | `login` | `{ guestOnly: true }` | `LoginView` |
| `/registro` | `register` | `{ guestOnly: true }` | `RegisterView` |
| `/` | `home` | `{ requiresAuth: true }` | `HomeView` (listado de gastos) |

No hay más rutas en esta iteración (presupuestos/reportes son Fase 2 y no
se anticipan acá).

### 4.2 Guard

Un único `router.beforeEach` global, async:

1. Si el estado de auth todavía no se resolvió en esta carga de la app
   (primer render tras un refresh de página), **esperar** a que resuelva
   antes de decidir nada (ver 4.3) — el guard hace `await` sobre una
   promesa memoizada de inicialización de sesión (una sola vez por carga
   de la app, no en cada navegación).
2. Si la ruta destino tiene `meta.requiresAuth` y no hay sesión → redirigir
   a `/login`. Se preserva la ruta original como query param
   (`?redirect=/ruta-original`) para volver ahí después de loguearse —
   aunque hoy solo existe `/` como ruta protegida, dejar este mecanismo ya
   armado evita retrabajo cuando se agreguen más rutas protegidas (reportes,
   presupuestos) en la próxima iteración.
3. Si la ruta destino tiene `meta.guestOnly` (login/registro) y **sí** hay
   sesión activa → redirigir a `/` (un usuario logueado no debe poder ver
   el formulario de login de nuevo).
4. Caso contrario, continuar la navegación normalmente.

Tras un login o registro (caso A, con sesión inmediata) exitoso: si existe
`route.query.redirect`, navegar ahí; si no, navegar a `/`.

### 4.3 Pantalla de carga intermedia (resolución de sesión al refrescar)

Problema a evitar: al recargar la página (F5, o abrir la PWA instalada
desde el ícono), Supabase tarda un instante en resolver si hay una sesión
guardada (`getSession()` es async). Sin manejo explícito, el router podría
renderizar por un frame el login aunque el usuario esté autenticado (o
viceversa) — "flash" de contenido incorrecto.

Solución concreta:
- En el store de auth (Pinia), exponer un estado `status:
  'pending' | 'authenticated' | 'unauthenticated'`, inicializado en
  `'pending'`.
- En `App.vue` (raíz), mientras `status === 'pending'`: renderizar **solo**
  una pantalla de splash a pantalla completa (`min-h-screen flex
  items-center justify-center`, fondo `bg-background`) con el texto
  `TipApp` (`text-2xl font-bold`, mismo estilo que el título de
  login/registro, para que la transición visual sea continua) — sin
  `router-view` montado todavía. Sin spinner necesariamente (una marca +
  fondo sólido ya comunica "cargando" sin parecer un estado de error o
  vacío); si se prefiere un indicador, un spinner discreto debajo del
  texto (`Loader2 animate-spin text-muted-foreground`) es aceptable pero
  no obligatorio.
- El guard de router (4.2, paso 1) también espera esta misma promesa antes
  de resolver, así que aunque el usuario navegue por URL directa a `/` o
  `/login` durante ese instante, no hay decisión de redirect tomada sobre
  datos incompletos.
- Apenas `status` pasa a `'authenticated'` o `'unauthenticated'`, se monta
  `<router-view />` normalmente y el guard ya tiene el dato real para
  decidir. Esta transición debe ser prácticamente instantánea en la
  mayoría de los casos (sesión en `localStorage`, sin roundtrip de red
  obligatorio para el primer render) — el splash es una salvaguarda para el
  caso en que sí tarde, no un paso obligado de varios segundos.

---

## Resumen para `vue-frontend-expert`

1. Crear `/login` y `/registro` como rutas separadas (no toggle), con
   copy exacto de la sección 1.6 y manejo de los dos casos posibles de
   registro (auto-confirm vs. confirmación de email pendiente, sección
   1.5).
2. `HomeView` (`/`) muestra: hero de total del mes (2.2), lista de gastos
   agrupada por día con orden fecha desc + created_at desc (2.3), estado
   vacío con CTA (2.4), 4 Skeletons de carga (2.5), estado de error con
   botón Reintentar (2.6), y FAB circular fijo abajo a la derecha (2.7).
   Logout vía Dropdown Menu en el header (2.1), sin confirmación.
3. Alta/edición de gasto en el Sheet inferior ya definido en el design
   system: monto (validado > 0), categoría (Select agrupado
   default/custom vía `SelectGroup`+`SelectLabel`, sin default
   preseleccionado), fecha (`input date` nativo, default hoy, `max` hoy),
   descripción opcional. Guardar con **actualización optimista** (sección
   3.8) y toast con acción "Reintentar" en caso de error.
4. Guard global en el router que espera la resolución de sesión antes de
   decidir redirects, con pantalla de splash mínima en `App.vue` mientras
   tanto (sección 4.3), para eliminar cualquier flash de contenido
   incorrecto al refrescar la página.
