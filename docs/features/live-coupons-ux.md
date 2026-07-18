# TipApp — UX de Cupones multi-partido (rediseño de "Partidos en vivo")

Documento de especificación funcional/UX para `vue-frontend-expert` y
`supabase-backend-expert`. **Es la fuente de verdad vigente** de las
superficies rediseñadas de la feature "Partidos en vivo" a partir de este
encargo (pedido explícito del Product Owner: un cupón deja de ser "un partido
con selecciones" y pasa a ser **un grupo de varios partidos distintos, cada uno
con una o más predicciones**).

Da por sentado y **referencia** —no repite— `docs/features/live-matches-ux.md`
(el doc original de la feature). Ese doc sigue vigente **tal cual** para:

- Sección 1 completa (estrategia de datos y tiempo real: Realtime, reloj que
  tickea en cliente, "actualizado hace Ns", estado "no se pudo actualizar" por
  partido, incidencias completas server-side) — **no cambia nada**, aplica
  igual a los partidos vivan sueltos o dentro de un cupón.
- Sección 4 completa (`/partidos/:id`, `MatchDetailView`) — **se conserva casi
  intacta**, ver §8 de este doc para los dos ajustes menores.
- Sección 6 completa (notificaciones push, banner, toggle de Ajustes, copy
  iOS) — **no cambia**.
- Sección 9 (checklist de a11y) — **sigue vigente**; §10 de este doc agrega
  los ítems nuevos del mundo cupón.
- Sección 8 (paleta/iconografía) — vigente; §4 de este doc **extiende** con la
  paleta del anillo, sin contradecirla.

**Queda superseded por este documento** (se dejó un banner al tope de
`live-matches-ux.md` apuntando acá):

- Sección 2 (arquitectura de rutas) → reemplazada por §2 de acá (sigue siendo
  2 rutas, pero cambia qué muestra `/partidos`).
- Sección 3 completa (dashboard `/partidos` como lista plana de cards de
  partido) → reemplazada por §5–§7 de acá (dashboard de cupones + sección de
  partidos sueltos, con `Tabs`).
- Sección 5 completa (wizard `MatchFormSheet`) → reemplazada por §9 de acá
  (wizard con dos caminos: buscar-un-partido vs. foto-de-cupón-multi-partido).
- La sección 3.3 del doc original ("por qué la lista NO usa `Tabs`") queda
  **matizada, no contradicha** — ver §3.4 de acá, que explica por qué esta vez
  sí se usan `Tabs`, en una capa distinta.

---

## 1. Modelo conceptual nuevo (y por qué el frontend sigue sin derivar nada)

Tres entidades, no dos. Nombres ilustrativos (mismo criterio que
`debts-ux.md`/`live-matches-ux.md`: confirmar con `supabase-backend-expert`
antes de tipar los stores):

1. **Cupón** (`bet_slips`, ilustrativo) — agrupa **N partidos distintos**. Es
   el nuevo objeto de primer nivel de la feature. Campos que el frontend
   consume, **todos ya calculados/persistidos server-side**:
   - `reference` (texto opcional, p. ej. "Cupón #25481" leído del OCR; si no
     se pudo leer, el frontend muestra un fallback, ver §6.1).
   - `stake_amount` (monto apostado, numérico, opcional — puede venir del OCR o
     tipearlo el usuario en el review, §9.4).
   - `total_odds` (**cuota total = producto de las cuotas de todas las
     predicciones del cupón**, calculada server-side, nunca en cliente).
   - `potential_return` (**posible ganancia = `stake_amount × total_odds`**,
     server-side).
   - `status` (`'won' | 'lost' | 'in_progress'`, **derivado server-side**, ver
     §3.1).
2. **Partido** (`live_matches`, ya existe) — un partido monitoreado. Cambio
   clave de modelo: **`bet_slip_id` pasa a ser nullable** — un partido puede
   existir sin pertenecer a ningún cupón (**partido suelto**, ver §5.5/§7.4).
   Cuando pertenece a un cupón, además de su snapshot en vivo de siempre
   (marcador/minuto/stats/incidencias) tiene un **estado de apuesta derivado**
   (`bet_status: 'won' | 'lost' | 'live' | 'pending'`, ver §3.1) — server-side.
   Un partido suelto no tiene `bet_status` (no hay apuesta que evaluar).
3. **Predicción** (`bet_slip_legs`, ya existe, se generaliza) — una selección
   del cupón sobre un partido. **Puede haber más de una predicción sobre el
   mismo partido dentro del mismo cupón** (ejemplo del PO: sobre
   Liverpool–Chelsea, "Ambos marcan: Sí" + "Más de 3.5 tarjetas"). Campos ya
   existentes (`pick`, `market`, `market_type`, `threshold`, `status`) + **uno
   nuevo: `odds` (cuota individual, numérico)** — necesario para que el backend
   calcule `total_odds` como producto. `status` sigue siendo el de siempre
   (`'won' | 'lost' | 'pending' | 'not_monitorable'`), server-side (§1.7 del
   doc original, sin cambios).

**Se mantiene intacto el principio rector de toda la feature y de toda la app**
(`live-matches-ux.md` §1.2/§1.7, `debt_balances`/`account_balances`): el
frontend **nunca deriva ni recalcula** el estado de un partido, el estado de
una predicción, el estado de un cupón, la cuota total ni la posible ganancia.
Todo eso llega ya resuelto en la fila/vista que trajo el Edge Function/cron. El
store (`src/stores/liveMatches.ts` extendido, o un `bet_slips` nuevo — decisión
de `vue-frontend-expert`) es una capa de presentación pura: lee, agrupa por el
`bet_status`/`status` que ya vino, pinta, y dispara acciones. **La única
aritmética admitida en cliente es contar cuántos partidos de un cupón tienen
cada `bet_status`** para dibujar el anillo (§6.2) — un conteo de una lista
chica ya en memoria (cardinalidad de "partidos de un cupón", 1–8, misma escala
que los legs en §1.1 del doc original), no una derivación de estado.

### 1.1 Cardinalidad — sin cambios de la estrategia de datos original

Todo lo de `live-matches-ux.md` §1.1 sigue válido: la cantidad de cupones +
partidos que sigue un usuario es chica y acotada por diseño (un puñado a la
vez), es seguro traer todo en una query sin paginar ni filtrar por fecha. Un
cupón agrega como mucho ~8 partidos; los partidos de todos los cupones + los
sueltos siguen siendo, en absoluto, pocas decenas. La nota abierta de
crecimiento de "finalizados" (§1.10 original) sigue abierta y ahora se mitiga
por los `Tabs` (§3.4) en vez de por el agrupado por encabezados.

---

## 2. Arquitectura de rutas — sigue en 2, cambia qué muestra `/partidos`

Mismo ejercicio de calibración que Tarjetas(4)/Cuentas(1)/Deudas(3)/Partidos(2)
— y la respuesta vuelve a ser **2 rutas**, las mismas dos de antes:

| Path | Nombre | Meta | Vista | Qué cambia |
|---|---|---|---|---|
| `/partidos` | `matches` | `{ requiresAuth: true }` | `LiveMatchesView` | **Cambia por completo su contenido**: de lista plana de cards de partido → **dashboard de cupones (con `Tabs`) + sección de partidos sueltos** |
| `/partidos/:id` | `match-detail` | `{ requiresAuth: true }` | `MatchDetailView` | **Se conserva** (ver §8): detalle completo de UN partido (hero, stats completas, timeline de incidencias, predicciones de ese partido, acciones). Es el destino del "Ver detalle" de una fila de partido expandida dentro de un cupón |

**Decisión 1 (qué pasa con `/partidos`)**: `/partidos` **sigue siendo la ruta
y el destino del drawer** ("Partidos en vivo", 6ª posición, ícono `Goal`,
`live-matches-ux.md` §7 — sin cambios). No se crea ninguna ruta nueva
(`/cupones` u otra). El nombre del ítem del drawer sigue siendo apto: un cupón
*es* un grupo de partidos, "Partidos en vivo" los cubre a todos. Lo único que
cambia es que su `<main>` se reorganiza de "lista de cards de partido" a
"dashboard de cupones + partidos sueltos".

**Decisión 2 (qué pasa con `/partidos/:id` y la expansión inline)**: la
referencia visual sugiere expandir un partido *inline* dentro de la card del
cupón. Se adopta un **detalle en dos niveles**, no uno solo:

- **Nivel liviano — expansión inline (acordeón) dentro de la card del cupón**
  (§7): al tocar una fila de partido, se despliega *ahí mismo* "Tus
  pronósticos" (las predicciones de ese partido con su estado individual) + las
  stats en vivo compactas (`MatchStatsRow`, ya existe) si el partido está en
  curso. Es exactamente lo que muestra la referencia, y es un vistazo rápido.
- **Nivel completo — la ruta `/partidos/:id` se conserva** (§8): el hero de
  marcador grande, la **tabla completa de stats**, la **timeline completa de
  incidencias** (cada gol/tarjeta/cambio) y el link "Ver en Flashscore" **no
  entran cómodos inline** dentro de una card que ya vive en una lista de varios
  cupones — meterlos ahí rompería el escaneo del panorama de cupones y
  apilaría timelines enteras una debajo de otra. La fila expandida ofrece un
  link **"Ver detalle del partido"** al pie del panel desplegado, que navega a
  `/partidos/:id`.

Este es el mismo criterio "la card resume, el detalle gestiona/lee completo"
que ya usa toda la app (Tarjetas, Deudas). La expansión inline es el resumen de
apuesta + pulso en vivo; la ruta es la lectura profunda del partido.

**No hace falta una ruta de detalle de cupón** (`/cupones/:id`): a diferencia
de un partido —que tiene timeline e historial que no caben en una lista—, un
cupón es **autosuficiente en su propia card** (anillo + cuotas + filas de
partido expandibles). No hay nada "más" de un cupón que mostrar en una pantalla
aparte; la card *es* su presentación completa. Mismo argumento con el que
Deudas justificó no necesitar una 4ª ruta.

**No hace falta una ruta de gestión** (tipo `/tarjetas/gestionar`): no hay una
segunda entidad propia del usuario que administrar (no hay "ligas"/"equipos"
guardados). El alta de cupón/partido vive en un Sheet (§9); borrar/quitar vive
en menús `⋮` sobre las cards (§6.1/§7) y en el detalle (§8). Sin colisión de
segmento literal-vs-dinámico — sin orden especial de declaración de rutas.

---

## 3. Estados y `Tabs` — definición final (para alinear con `supabase-backend-expert`)

Esta sección fija el contrato de estados **que consume el frontend** y que debe
coincidir 1:1 con lo que calcula el backend. **Ajusté la propuesta original del
encargo en dos puntos** (marcados con ⚠️ para alinear a backend).

### 3.1 Estado de un partido dentro de un cupón (`bet_status`, 4 valores)

Derivado server-side, el frontend solo lo pinta:

| `bet_status` | Cuándo | Color anillo | Ícono/afford. en la fila |
|---|---|---|---|
| `won` | **Todas** las predicciones de ese partido están `won` | `success` (verde) | `CircleCheck` verde |
| `lost` | **Alguna** predicción de ese partido está `lost` | `destructive` (rojo) | `CircleX` rojo |
| `live` | El partido está en curso y todavía no es `won` ni `lost` | `warning` (ámbar) | patrón "en vivo" establecido: `Radio` + `animate-pulse` + `text-primary` + minuto (ver §7.1 y la reconciliación de color en §4.2) |
| `pending` | No empezó, **o** no se pudo resolver a un partido real de Flashscore | `muted-foreground` (gris) | `Clock` gris (o `CircleDashed` gris si es "no vinculado", §7.1) |

⚠️ **Matiz que agrego (avisar a backend)**: el `pending` absorbe dos
sub-casos que el usuario percibe distinto — "todavía no empezó" y "no se pudo
vincular a un partido de Flashscore, no se va a poder trackear". **Ambos cuentan
como `pending` en el anillo** (no invento un 5º estado, respeto el contrato de
4). Pero el frontend necesita distinguirlos **en la fila** (no en el anillo)
para el copy: un partido `pending`-no-vinculado muestra el badge "No se pudo
vincular" (§7.1). Pido a backend un flag/booleano extra a nivel de partido
(p. ej. `is_linked` / `flashscore_mid IS NULL`) para poder hacer esa
distinción de copy — **no** un valor nuevo de `bet_status`.

### 3.2 Estado de un cupón (`status`, 3 valores) — sin cambios respecto del encargo

Derivado server-side:

- `lost` si **cualquier** partido hijo es `lost`.
- `won` **solo si todos** los partidos hijos son `won`.
- `in_progress` en cualquier otro caso.

### 3.3 El anillo cuenta partidos por `bet_status`

- Segmentos: `won`=verde, `live`=ámbar, `pending`=gris, `lost`=rojo.
- Centro: **"X/Y acertados"** = cantidad de partidos `won` sobre el total de
  partidos del cupón (`Y = won + live + pending + lost`).
- El frontend cuenta la lista de partidos del cupón (ya en memoria) por
  `bet_status` — único conteo admitido en cliente (§1).

### 3.4 `Tabs` "Todos / En vivo / Finalizados" — por qué esta vez SÍ, y sobre qué

El doc original (§3.3) descartó `Tabs` para el dashboard de partidos "para no
ocultar nada detrás de una pestaña". El PO ahora pide `Tabs` explícitamente.
**No es una contradicción: operan en capas distintas**, y esto hay que
explicitarlo en la implementación:

- **§3.3 original sigue vigente a nivel de partidos DENTRO de un cupón**: las
  filas de partido de un cupón **nunca se ocultan detrás de una pestaña** —
  todas visibles siempre en la card, todas contadas en el anillo. Ese es el
  "no escondas lo que está pasando" original, intacto.
- **Los `Tabs` filtran los ítems de PRIMER NIVEL** (los cupones y los partidos
  sueltos), no los partidos anidados. Y crucialmente: **"Todos" es la pestaña
  por defecto al entrar** — así que, por defecto, no se oculta nada; la pestaña
  es una acción deliberada del usuario para acotar, no la única forma de ver el
  panorama. Esa es exactamente la diferencia con el caso que §3.3 rechazaba
  (donde no había vista "todo" y la pestaña era obligatoria).

⚠️ **Ajuste que agrego (avisar a backend)**: la propuesta del encargo definía
los tabs "a nivel cupón". Los extiendo a **"ítems de primer nivel" = cupones
**y** partidos sueltos**, porque un partido suelto es también algo que el
usuario sigue y espera ver en su panorama en vivo. Un partido suelto deriva un
estado equivalente con la misma lógica (ver tabla abajo). Backend no necesita
hacer nada nuevo para esto: los partidos sueltos ya tienen su `stage_code`
crudo (§1.4 original), el frontend bucketiza con eso.

**Definición final de los buckets** (aplican a cupones y a partidos sueltos por
igual):

| Tab | Cupón | Partido suelto |
|---|---|---|
| **Finalizados** | `status ∈ {won, lost}` | `stage_code === 3` (finalizado en cancha) |
| **En vivo** | `status === in_progress` **y** ≥1 partido hijo con `bet_status === live` | `stage_code ∈ {12, 13, 38}` (en juego, incluye descanso) |
| **Todos** | siempre | siempre |

⚠️ **Matiz del caso "nada arrancó todavía" (avisar a backend, respuesta a tu
pregunta abierta)**: un cupón `in_progress` sin ningún partido `live` (todo
`pending`, o mezcla de `won`/`pending` sin nada en curso ahora) y un partido
suelto `scheduled` (`stage_code === 1`) **caen SOLO en "Todos"** — no aparecen
ni en "En vivo" (no hay nada en juego ahora) ni en "Finalizados" (no terminó).
**Decidí NO agregar una 4ª pestaña "Próximos"**: "Todos" es el default y
siempre los muestra, agregar una pestaña más por un caso que ya tiene su hogar
sería proliferación de tabs sin ganancia real. Queda documentado como decisión
consciente, no como olvido. Si el PO después quiere destacar los "por empezar",
se agrega en una iteración, no ahora.

**Orden dentro de cada tab**: primero los ítems con algo en vivo ahora
(cupones con ≥1 partido `live`, partidos sueltos en `stage_code` 12/13),
ordenados por el cambio más reciente (`last_polled_at`/campo de "último cambio
real", a confirmar con backend); luego los por empezar (por hora de kickoff más
próxima); luego los finalizados al fondo. Dentro de "Finalizados" el orden es
por más reciente.

**Separación cupones vs. sueltos dentro de un tab**: si el usuario tiene
partidos sueltos, se separan de los cupones con un encabezado de sección
(`<p class="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide
text-muted-foreground">Partidos sueltos</p>`, mismo lenguaje visual que los
encabezados de grupo de `TransactionsView`). **El encabezado solo aparece si
hay al menos un partido suelto** (caso común: 0 sueltos → no se ve ningún
encabezado, la pantalla es solo cupones, limpia). Los cupones no llevan
encabezado propio "Cupones" cuando no hay sueltos (evita un encabezado
huérfano).

---

## 4. Paleta del anillo — validada con la skill `dataviz`

**Sin paleta nueva** (mismo principio que `live-matches-ux.md` §8). El anillo es
una **paleta de estado** (status), no categórica, y reusa los 4 tokens
reservados que ya existen en `design-system.md`:

| Estado | Token | Hex light / dark |
|---|---|---|
| Ganados | `success` | `#16833e` (igual en ambos temas) |
| En juego | `warning` | `#f59f0a` (igual en ambos temas) |
| Pendientes | `muted-foreground` | `#64748b` light / `#94a3b8` dark |
| Perdidos | `destructive` | `#dc2626` (igual en ambos temas) |

### 4.1 Qué dijo el validador (corrido en los dos temas, no a ojo)

Se corrió `scripts/validate_palette.js` de la skill `dataviz` sobre los 4 hex,
en modo `light` (surface blanco) y `dark` (surface `#020817`), con `--pairs
all` (el anillo pone los 4 colores adyacentes, no solo pares nominales):

- **Único hallazgo real: el par reservado rojo↔verde queda en deutan ΔE 7.8**
  (banda-piso 6–8). Es la confusión rojo/verde clásica de daltonismo
  deuteranope/protanope. Según la skill, un ΔE en la banda 6–8 es **legal
  solo con codificación secundaria** (ícono, texto, separación o textura).
- **Contraste del ámbar (`warning`) vs. surface blanco: 2.08** (< 3:1 en light)
  — la skill obliga a "relieve": etiqueta visible o vista de tabla. En dark los
  4 pasan el contraste.
- Los `[FAIL]` de "lightness band" (el ámbar es intencionalmente claro) y
  "chroma floor" (el gris **debe** leerse neutro) son **artefactos esperables
  de correr un validador *categórico* sobre una paleta de *estado*** — la
  propia nota de scope del script dice "categorical palettes only". No son
  defectos: un status palette tiene por definición un neutro gris y un ámbar
  claro. Se documentan para que nadie los "corrija" rompiendo la semántica.

### 4.2 Cómo se satisface la codificación secundaria (ya estaba en el diseño)

El diseño **ya** cumple lo que la banda 6–8 exige, por las mismas reglas de
a11y de siempre ("color nunca como único indicador"):

1. **Cada estado siempre lleva ícono + etiqueta + número** en la leyenda del
   anillo (§6.2) y en las filas (§7.1) — nunca un arco de color pelado. Esta es
   la codificación secundaria que hace legal el ΔE 7.8 rojo↔verde, el mismo
   razonamiento que la app ya aplica a `warning`/`destructive` en presupuestos.
2. **Gap de 2px de color de surface entre cada segmento del anillo** (spec de
   marcas de `dataviz`) — separa físicamente arcos adyacentes, incluido el par
   rojo↔verde en la costura del anillo, para que no se toquen.
3. **El número "acertados" del centro es texto en tinta** (`foreground`), no se
   comunica por color — el dato más importante del anillo (cuántos ganó) se lee
   sin depender de ningún color.
4. **El ámbar de bajo contraste sobre blanco** se releva con su etiqueta
   siempre visible en la leyenda + el conteo en tinta; el arco es refuerzo, no
   el único portador del dato.

**Reconciliación del doble sentido de "en vivo" (importante, documentar como en
§8 original)**: existen dos vocabularios de "en vivo" que conviven sin
contradecirse, cada uno con ícono+texto:

- **El anillo/estado de apuesta**: el bucket "En juego" es **ámbar**
  (`warning`), fijado por el PO — es un estado de la apuesta ("esta selección
  todavía no se decidió, el partido está en curso"), agregado en el donut.
- **El indicador de partido en vivo de siempre**: `Radio` + `animate-pulse` +
  `text-primary` (azul) + minuto corriendo — es un hecho neutro del partido
  ("está físicamente en juego ahora"), rico (muestra el minuto real). Se
  conserva **tal cual** en las filas de partido, el hero de detalle y el
  buscador (§8 original eligió `primary` y no `destructive` a propósito; se
  respeta).

Un partido en curso y con su apuesta sin decidir muestra **ambos**: el anillo
del cupón suma un tramo ámbar por él, y su fila muestra el pulso azul + minuto.
No es redundante ni contradictorio: uno es el agregado de apuesta (paleta de
estado del PO), el otro es la afford. de "partido corriendo" ya establecida. La
leyenda del anillo etiqueta el tramo ámbar como "En juego" con su ícono, así
que el ámbar nunca queda sin explicar.

Sin íconos nuevos respecto de `live-matches-ux.md` §8 (todos ya confirmados en
`@lucide/vue`). Íconos nuevos de este doc: `Ticket` (encabezado de cupón, ver
§6.1), `ChevronDown`/`ChevronRight` (disclosure de fila de partido, §7),
`Trophy` (estado "Ganado" del cupón, opcional), `Receipt`/`Ticket` — confirmar
existencia antes de citar en implementación (`node_modules/@lucide/vue/dist/
esm/icons/`), mismo criterio de siempre.

---

## 5. `/partidos` — dashboard rediseñado (estructura general)

Header idéntico al original (§3 original: `ArrowLeft` + `<h1>Partidos en
vivo</h1>`), sin cambios.

### 5.1 Orden del `<main>`

1. Banner de permiso de notificaciones (condicional) — **sin cambios**,
   `live-matches-ux.md` §6.1.
2. Nota de limitación iOS (condicional) — sin cambios, §6.4 original.
3. **`Tabs` "Todos / En vivo / Finalizados"** (§5.2).
4. Contenido del tab activo: lista de cupones (§6) + sección de partidos
   sueltos (§7.4), ambos filtrados por el tab (§3.4).
5. **FAB "+"** (§5.3), persistente sobre todo lo anterior.

### 5.2 El componente `Tabs`

**Primer uso de `Tabs` fuera de Deudas** (ya instalado, `debts-ux.md` §3.4 — no
reinstalar). Se usa `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` de
shadcn-vue. A diferencia de Deudas (donde cada panel tiene *forma* distinta:
cards de resumen vs. historial), acá los tres paneles tienen la **misma forma**
(la misma lista, filtrada). Aun así se usan `Tabs` y no un segmented control /
`radiogroup` como el del buscador (§9.2), por dos razones:

1. Es un **filtro de contenido de la pantalla principal** que el PO pidió
   explícitamente con nombre de pestañas, y el volumen de contenido debajo es
   grande (varios cupones apilados) — el patrón `TabsContent` (una región
   `role="tabpanel"` con `aria-live` implícito de Reka) comunica mejor "esto es
   una vista completa que cambia" que un segmented control, que el proyecto
   reserva para "elegí 1 de N chicas y ves el resultado al lado" (tema, día del
   buscador).
2. Reka UI ya da el manejo de foco por flechas y `aria-selected`/`role="tab"`
   gratis — no reinventar.

```html
<Tabs v-model="activeTab" class="w-full">
  <TabsList class="mx-4 mt-2 grid w-[calc(100%-2rem)] grid-cols-3">
    <TabsTrigger value="all">Todos</TabsTrigger>
    <TabsTrigger value="live">En vivo</TabsTrigger>
    <TabsTrigger value="finished">Finalizados</TabsTrigger>
  </TabsList>

  <TabsContent value="all"><!-- lista filtrada, §6/§7.4 --></TabsContent>
  <TabsContent value="live"><!-- ídem --></TabsContent>
  <TabsContent value="finished"><!-- ídem --></TabsContent>
</Tabs>
```

- `activeTab` arranca en `'all'` (default, §3.4).
- **Contador opcional en el trigger "En vivo"**: si hay ≥1 ítem en vivo, un
  puntito/badge chico ámbar o el número, para que el usuario vea que hay
  actividad sin tener que entrar. Opcional para `vue-frontend-expert`; si se
  hace, el número va como texto (nunca solo un punto de color).
- **Estado vacío por tab** (no la pantalla entera): si "En vivo" no tiene nada,
  bloque centrado chico dentro del `TabsContent`: ícono `Radio`
  `size-8 text-muted-foreground`, "No hay nada en vivo ahora." Si
  "Finalizados" está vacío: `CircleCheck` + "Todavía no terminó ningún
  cupón ni partido." "Todos" vacío = el estado vacío global de la pantalla
  (§5.4).

### 5.3 FAB "+" — reemplaza al FAB "Agregar partido"

El mismo FAB de §3.6 original (`size-14 rounded-full`,
`env(safe-area-inset-bottom)`), pero ahora abre el wizard rediseñado (§9), cuyo
paso 1 permite **buscar un partido** (→ partido suelto) **o subir la foto de un
cupón** (→ cupón multi-partido). Un solo FAB para ambas altas (no dos botones
distintos): el wizard bifurca adentro, no en la pantalla. `aria-label="Agregar
partido o cupón"`.

> Se descarta el "botón + por cupón" de la referencia (que agregaba partidos a
> *ese* cupón): en v1 no se editan cupones existentes agregándoles partidos a
> mano (§9.5, fuera de alcance). El FAB global cubre el alta; agregar más
> partidos a un cupón ya creado es una mejora futura, no v1.

### 5.4 Estados de carga / vacío / error (pantalla completa)

- **Carga**: 2 `Skeleton` de card de cupón (alto aproximado de una card con
  anillo + 3 filas de partido) + 1 `Skeleton` de fila de partido suelto.
- **Error** (falla la carga inicial de todo): mismo bloque de siempre,
  `AlertCircle` + "No pudimos cargar tus partidos" + `Reintentar`.
- **Vacío** (sin ningún cupón ni partido): mismo bloque que §3.7 original,
  ícono `Goal`, título "Todavía no seguís ningún partido ni cupón.", subtexto
  "Buscá un partido para verlo en vivo, o subí la foto de tu cupón para seguir
  todas sus selecciones.", botón "Agregar" → abre el wizard directo.

---

## 6. Card de cupón

Estructura, de arriba hacia abajo: encabezado (referencia + estado + menú) →
anillo + leyenda → tira de cuotas → filas de partido (acordeón).

**Estructura interactiva (mismo criterio de a11y que §3.4 original)**: la card
**no es un único `<button>`**. El encabezado tiene un menú `⋮` (acciones del
cupón) que es un hermano, no anidado. Cada fila de partido es su propio botón de
disclosure (§7), hermano también. Nada interactivo anidado dentro de otro
interactivo.

### 6.1 Encabezado

```html
<Card class="overflow-hidden">
  <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
    <div class="flex min-w-0 items-center gap-2">
      <Ticket class="size-4 shrink-0 text-muted-foreground" />
      <p class="truncate text-sm font-semibold">{{ coupon.reference ?? 'Cupón' }}</p>
      <Badge :variant="couponStatusBadgeVariant(coupon.status)" class="shrink-0 text-[10px]">
        {{ couponStatusLabel(coupon.status) }}
      </Badge>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" aria-label="Más opciones del cupón" class="-mr-2 size-9">
          <EllipsisVertical class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
              <Trash2 class="size-4" />
              Quitar cupón
            </DropdownMenuItem>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar este cupón?</AlertDialogTitle>
              <AlertDialogDescription>
                Dejamos de seguir el cupón y todos sus partidos. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction @click="removeCoupon(coupon)">Quitar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
```

- `coupon.reference ?? 'Cupón'`: si el OCR leyó el número ("Cupón #25481") se
  muestra; si no, el fallback plano "Cupón" (no se inventa un número falso). Se
  puede sumar la fecha de alta como subtítulo chico si ayuda a distinguir
  cupones sin referencia — opcional.
- `couponStatusLabel`/`Variant`: `won` → "Ganado" (`variant` con color success,
  o `default` + `Trophy`); `lost` → "Perdido" (`destructive`); `in_progress` →
  "En progreso" (`secondary`). Siempre ícono+texto, nunca solo el color del
  badge.
- **Guard de borrado: ninguno** (mismo criterio que quitar un partido/hilo de
  deuda, `live-matches-ux.md` §1.9): un cupón no es referenciado por ningún
  otro recurso; sus partidos y predicciones son hijos propios (cascada).
  `AlertDialog` simple, sin conteo.
- **Quitar un cupón quita también sus partidos** — el copy lo dice explícito.
  Si un partido del cupón el usuario lo quiere conservar como suelto, eso es una
  acción distinta (fuera de alcance v1, §9.5); el borrado del cupón es todo o
  nada.

### 6.2 Anillo + leyenda

Layout horizontal en mobile: anillo a la izquierda, leyenda de 4 estados a la
derecha (en pantallas muy angostas puede apilar leyenda debajo).

```html
  <div class="flex items-center gap-4 px-4 py-3">
    <CouponStatusRing
      :won="counts.won" :live="counts.live" :pending="counts.pending" :lost="counts.lost"
      class="size-24 shrink-0"
    />
    <ul class="flex flex-1 flex-col gap-1.5 text-sm">
      <li class="flex items-center gap-2">
        <CircleCheck class="size-4 text-success" />
        <span class="flex-1 text-muted-foreground">Ganados</span>
        <span class="font-semibold tabular-nums">{{ counts.won }}</span>
      </li>
      <li class="flex items-center gap-2">
        <Radio class="size-4 text-warning" />
        <span class="flex-1 text-muted-foreground">En juego</span>
        <span class="font-semibold tabular-nums">{{ counts.live }}</span>
      </li>
      <li class="flex items-center gap-2">
        <Clock class="size-4 text-muted-foreground" />
        <span class="flex-1 text-muted-foreground">Pendientes</span>
        <span class="font-semibold tabular-nums">{{ counts.pending }}</span>
      </li>
      <li class="flex items-center gap-2">
        <CircleX class="size-4 text-destructive" />
        <span class="flex-1 text-muted-foreground">Perdidos</span>
        <span class="font-semibold tabular-nums">{{ counts.lost }}</span>
      </li>
    </ul>
  </div>
```

- La leyenda muestra **los 4 estados siempre** (incluso los que están en 0) —
  el vocabulario del anillo queda estable y educado; un "Perdidos 0" es un dato
  honesto, no ruido. `vue-frontend-expert` puede atenuar (`opacity-60`) las
  filas en 0 si se prefiere, sin ocultarlas.
- El ícono de "En juego" en la leyenda es `Radio` **en color `warning`** (no
  azul) — es la leyenda del anillo (paleta de estado del PO), atada al tramo
  ámbar. Es el único lugar donde `Radio` aparece ámbar; en las filas de partido
  el `Radio` "en vivo" sigue azul (§4.2). Documentar el porqué en el código.

**`CouponStatusRing.vue` (nuevo, SVG a mano, sin librería)** — mismo criterio
que `CategoryDonutChart`/`DualTrendChart`: SVG con `stroke="hsl(var(--success))"`
etc., así el tema claro/oscuro cambia gratis sin watcher (el tramo gris usa
`hsl(var(--muted-foreground))`, que sí cambia entre temas, correcto). Specs de
`dataviz` aplicadas:

- Donut (no torta): un `<circle>` de track (`hsl(var(--muted))`,
  `stroke-width` ~8–10) + 4 `<circle>` de segmento con `stroke-dasharray`/
  `stroke-dashoffset` proporcionales a cada conteo (misma técnica de arco que
  `buildDonutSlices` en `src/lib/charts.ts` — reusar el helper si su forma
  `{value, color}` sirve, o un builder chico dedicado; no hace falta el plegado
  "Otros" de `buildDonutSlices`, acá son 4 fijos).
- **Gap de 2px de color de surface entre segmentos** (spec de marcas): dejar un
  pequeño hueco entre arcos (acortando cada dash ~2px), incluida la costura, así
  el par rojo↔verde nunca se toca (§4.2).
- **Centro**: `Y` grande en tinta (`text-foreground`, `text-lg`/`text-xl`
  `font-bold tabular-nums`) con la forma "X/Y" y debajo "acertados"
  (`text-[10px] text-muted-foreground`). Ejemplo: "3/5" / "acertados".
- Orden de segmentos: `won` → `live` → `pending` → `lost` (narrativa de mejor a
  peor; el par rojo↔verde solo se encuentra en la costura del anillo, resuelta
  por el gap).
- **`prefers-reduced-motion`**: el anillo **no anima** su llenado (evita un
  spinner de progreso); es estático, se actualiza cuando llega un `bet_status`
  nuevo por Realtime. Sin animación que anular.
- **a11y**: el `<svg>` lleva `role="img"` y un `aria-label` compuesto:
  `` `${counts.won} ganados, ${counts.live} en juego, ${counts.pending} pendientes, ${counts.lost} perdidos de ${total}` `` — el lector de pantalla
  no depende del color de los arcos; la leyenda de al lado ya repite todo en
  texto de todos modos.
- **Caso cupón con 0 partidos vinculados** (todos `pending`-no-vinculados,
  borde raro): el anillo se dibuja todo gris con "0/N" — sigue siendo honesto,
  no se rompe.

### 6.3 Tira de cuotas — cuota total, posible ganancia, monto apostado

```html
  <div class="grid grid-cols-3 gap-2 border-t border-border px-4 py-3 text-center">
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-muted-foreground">Cuota total</span>
      <span class="text-sm font-semibold tabular-nums">{{ formatOdds(coupon.totalOdds) }}</span>
    </div>
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-muted-foreground">Apostado</span>
      <span class="text-sm font-semibold tabular-nums">{{ coupon.stakeAmount != null ? formatCurrency(coupon.stakeAmount) : '—' }}</span>
    </div>
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-muted-foreground">Posible ganancia</span>
      <span class="text-sm font-semibold tabular-nums text-success">{{ coupon.potentialReturn != null ? formatCurrency(coupon.potentialReturn) : '—' }}</span>
    </div>
  </div>
```

- `formatOdds`: cuota es un **decimal plano** (p. ej. `12.50`), **no** moneda —
  `toFixed(2)` sin símbolo de `$`. Helper chico nuevo o inline; no confundir con
  `formatCurrency`.
- `formatCurrency` (`src/lib/currency.ts`, `es-AR`, ya existe) para apostado y
  posible ganancia. Si `stake_amount` es null → "—" en ambos (sin stake no hay
  ganancia calculable; `potential_return` viene null del backend en ese caso).
- **"Posible ganancia" en `text-success`** — es el único uso de color aquí; es
  el número "premio", coherente con success = resultado favorable. No implica
  que esté ganado (el estado real lo dice el badge/anillo); es "lo que
  ganarías si sale". El label "Posible" ya lo aclara.
- **Nota de alcance (coherente con el drawer, §7 original)**: estos montos son
  **de referencia del cupón, no transacciones** — no cruzan con
  `expenses`/`incomes`/`accounts`, no impactan ningún saldo, no aparecen en
  Transacciones. Es dato informativo del ticket, igual que la app ya declaró
  que Partidos no lleva contabilidad de apuestas en dinero.

### 6.4 Filas de partido — ver §7.

### 6.5 Pie — no hay "actualizado hace" a nivel cupón

El "Actualizado hace Ns" y el estado "no se pudo actualizar" (§1.5 original) son
**por partido**, no por cupón (cada partido se pollea por separado). Viven en la
fila de partido expandida (§7.2) y en el detalle (§8), no en el pie de la card
de cupón — un cupón agrega partidos que se actualizaron en momentos distintos,
un único "hace Ns" del cupón sería engañoso.

---

## 7. Fila de partido dentro de un cupón (acordeón)

Cada partido del cupón es una **fila-disclosure**: colapsada muestra el resumen;
expandida despliega "Tus pronósticos" + stats en vivo, inline, sin navegar.

### 7.1 Fila colapsada

```html
<div class="border-t border-border">
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    :aria-expanded="isExpanded(match.id)"
    :aria-controls="`match-panel-${match.id}`"
    @click="toggleExpand(match.id)"
  >
    <!-- Glyph de bet_status (ícono+color; el 'live' reusa el pulso azul establecido) -->
    <span class="shrink-0">
      <Radio v-if="match.betStatus === 'live'" class="size-4 animate-pulse text-primary" aria-hidden="true" />
      <CircleCheck v-else-if="match.betStatus === 'won'" class="size-4 text-success" aria-hidden="true" />
      <CircleX v-else-if="match.betStatus === 'lost'" class="size-4 text-destructive" aria-hidden="true" />
      <CircleDashed v-else-if="!match.isLinked" class="size-4 text-muted-foreground" aria-hidden="true" />
      <Clock v-else class="size-4 text-muted-foreground" aria-hidden="true" />
      <span class="sr-only">{{ betStatusLabel(match) }}: </span>
    </span>

    <!-- Equipos apilados (mismo criterio de siempre: nunca en una línea) -->
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <p class="truncate text-sm font-medium">{{ match.homeTeam }}</p>
      <p class="truncate text-sm font-medium">{{ match.awayTeam }}</p>
      <p v-if="!match.isLinked" class="text-xs text-warning">No se pudo vincular · no se sigue en vivo</p>
    </div>

    <!-- Marcador (solo si vinculado y arrancó) -->
    <div v-if="match.isLinked && hasScore(match)" class="flex flex-col items-end gap-0.5 tabular-nums">
      <span class="text-sm font-bold">{{ match.homeScore }}</span>
      <span class="text-sm font-bold">{{ match.awayScore }}</span>
    </div>

    <!-- Minuto/estado + chevron -->
    <div class="flex shrink-0 flex-col items-end gap-1">
      <span v-if="isLive(match)" class="flex items-center gap-1 text-xs font-semibold text-primary">
        <Radio class="size-3 animate-pulse" aria-hidden="true" />{{ clockLabel(match) }}
      </span>
      <Badge v-else-if="match.isLinked" variant="secondary" class="text-[10px]">{{ clockLabel(match) }}</Badge>
    </div>
    <component :is="isExpanded(match.id) ? ChevronDown : ChevronRight" class="size-4 shrink-0 text-muted-foreground" />
  </button>
```

- El **glyph de `bet_status`** es la codificación de estado de la apuesta de ese
  partido (§3.1). Para `live` reusa el `Radio`+pulso+azul establecido (no ámbar
  — el ámbar vive en el anillo agregado, §4.2). Siempre con `sr-only` del label
  (nunca color solo).
- **`match.isLinked === false`** (no se resolvió a un partido de Flashscore, §3.1
  matiz): fila igual de visible, glyph `CircleDashed` gris, subtítulo `warning`
  "No se pudo vincular · no se sigue en vivo", sin marcador ni minuto (no hay
  feed). Sus predicciones se muestran igual al expandir (como referencia), pero
  quedan `pending`/`not_monitorable`. Nunca se oculta (punto de "nunca ocultar"
  del encargo original).
- **Fila-disclosure = un único `<button>`** con `aria-expanded`/`aria-controls`
  — acá sí puede ser un botón único porque **no** hay menú `⋮` por partido
  dentro del cupón (las acciones de gestión —pausar/quitar— son a nivel cupón, o
  se hacen desde `/partidos/:id`). Sin el problema de botón-en-botón de §3.4.
- El "Ver detalle del partido" (navegar a `/partidos/:id`) **no va en la fila
  colapsada** sino al pie del panel expandido (§7.2) — así el tap en la fila
  siempre significa "expandir", inequívoco.

### 7.2 Panel expandido — "Tus pronósticos" + stats en vivo

```html
  <div v-if="isExpanded(match.id)" :id="`match-panel-${match.id}`" class="flex flex-col gap-3 px-4 pb-4">
    <!-- Tus pronósticos: 1+ predicciones sobre ESTE partido -->
    <div class="flex flex-col gap-1.5">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tus pronósticos</p>
      <div v-for="leg in match.legs" :key="leg.id" class="flex items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2">
        <component :is="legStatusIcon(leg.status)" class="mt-0.5 size-4 shrink-0" :class="legStatusClass(leg.status)" />
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="text-sm font-medium">{{ leg.selectionLabel }}</p>
          <p class="text-xs text-muted-foreground">{{ leg.marketLabel }}</p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1">
          <span class="text-xs font-semibold tabular-nums text-muted-foreground">{{ formatOdds(leg.odds) }}</span>
          <Badge :variant="legStatusBadgeVariant(leg.status)" class="text-[10px]">{{ legStatusLabel(leg.status) }}</Badge>
        </div>
      </div>
    </div>

    <!-- Stats en vivo compactas, SOLO si el partido está en curso -->
    <MatchStatsRow v-if="isLive(match)" :match="match" />

    <!-- Link al detalle completo -->
    <RouterLink
      :to="{ name: 'match-detail', params: { id: match.id } }"
      class="flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Ver detalle del partido
      <ChevronRight class="size-4" />
    </RouterLink>
  </div>
</div>
```

- **"Tus pronósticos"** lista **todas** las predicciones de ese partido dentro
  del cupón (1 o más — el caso del PO: 2 sobre Liverpool–Chelsea). Cada una con
  su `selectionLabel`/`marketLabel` (texto ya resuelto por el backend, §4.4
  original — el frontend no arma strings desde enum+umbral), su **cuota**
  (`formatOdds`) y su `Badge` de estado (`won`/`lost`/`pending`/
  `not_monitorable`, mismos íconos/labels/colores de §4.4 original:
  `CircleCheck`/success, `CircleX`/destructive, `Clock`/muted, `CircleDashed`/
  muted). Siempre ícono + badge de texto, nunca color solo.
- **`MatchStatsRow` (ya existe, NO se rediseña)**: reusar tal cual (grid de 5:
  córners/remates/ocasiones/amarillas/rojas), solo si `isLive(match)`. Si el
  partido no está en curso (por empezar/finalizado), no se muestra la fila de
  stats (nada en vivo que mostrar) — mismo criterio de "ocultar sección sin
  datos" ya usado en toda la app.
- **El "Actualizado hace Ns" / "no se pudo actualizar" por partido** (§1.5
  original) puede ir chico al pie del panel expandido si `vue-frontend-expert`
  lo ve necesario; en la card de cupón se prioriza no recargar visualmente, así
  que se acepta que ese detalle fino viva sobre todo en `/partidos/:id`.
- El panel expandido es contenido inline (no roba foco al abrir); solo un
  partido expandido a la vez o varios — decisión de `vue-frontend-expert`, sin
  impacto de UX fuerte (sugerido: permitir varios, es más flexible y no hay
  costo real).

### 7.3 Estado transitorio "buscando datos" (partido recién agregado)

Igual que §5.5 original: un partido recién creado puede no tener snapshot hasta
el primer poll (~15–20s). En la fila del cupón: glyph `pending` gris + subtítulo
"Buscando datos del partido..." (skeleton parcial del marcador), hasta que
Realtime traiga el snapshot. No bloquea el resto de la card.

### 7.4 Partidos sueltos — la misma card del doc original, reusada

Los partidos que **no** pertenecen a ningún cupón (`bet_slip_id IS NULL`) se
muestran en su sección "Partidos sueltos" (§3.4) usando **la card de partido de
`live-matches-ux.md` §3.4 casi tal cual** (marcador apilado, `MatchStatsRow`,
menú `⋮` con pausar/reanudar/quitar, pie "Actualizado hace Ns", región
clickeable que navega a `/partidos/:id`). Cambios mínimos:

- **Sin `MatchLegsSummary`** (§3.5 original): un partido suelto no tiene
  predicciones, así que ese sub-bloque simplemente no aparece (ya era
  condicional a `match.legs.length > 0`).
- Todo lo demás de esa card (estructura hermana botón/`⋮`, badges de estado de
  monitoreo, warning "no pudimos actualizar") se conserva **idéntico** — no se
  rediseña.

Esto responde la pregunta 3 del encargo: **sí, los partidos sueltos se siguen
soportando** (es el núcleo original de la feature: "solo quiero ver este partido
en vivo, sin apuesta"), y se referencian en la navegación como una **sección
propia del mismo `/partidos`**, gobernada por los mismos `Tabs` (§3.4). No
necesitan ruta ni pantalla aparte. Quitar el soporte de sueltos habría sido una
regresión de la feature ya shippeada.

---

## 8. `/partidos/:id` (`MatchDetailView`) — se conserva, dos ajustes menores

**Se mantiene tal cual `live-matches-ux.md` §4** (hero marcador grande, acciones
pausar/reanudar/quitar, stats completas §4.2, timeline de incidencias §4.3,
predicciones completas §4.4, "Ver en Flashscore", estados de carga/error §4.5).
Es el destino del "Ver detalle del partido" de una fila de cupón (§7.2) y de la
card de partido suelto (§7.4). Dos ajustes:

1. **La sección "Tu cupón" (§4.4 original) pasa a titularse según el contexto**:
   si el partido pertenece a un cupón, el título de esa `Card` puede decir "Tus
   pronósticos" (consistente con §7.2) y, opcional, un link chico "Ver cupón
   completo" que vuelve a `/partidos` scrolleando/resaltando la card del cupón
   (nice-to-have, no bloqueante — si es complejo, se omite en v1). Si es un
   partido suelto, esa sección simplemente no existe (ya era condicional a
   `legs.length > 0`).
2. **Acción "Quitar" en el hero de un partido que pertenece a un cupón**: el
   copy del `AlertDialog` debe aclarar que quitar **un** partido de un cupón
   afecta al cupón. **Decisión v1 (avisar a backend)**: para simplificar, en v1
   **no** se permite quitar un solo partido de un cupón desde el detalle — la
   acción "Quitar" del hero queda **deshabilitada (o ausente) cuando el partido
   pertenece a un cupón**, con un texto "Este partido es parte de un cupón.
   Quitá el cupón completo desde Partidos." Solo los partidos **sueltos**
   conservan "Quitar"/"Pausar" individuales en el hero. Motivo: quitar un
   partido de un cupón cambiaría `total_odds`/`potential_return`/`status` del
   cupón (recálculo server-side no trivial) y abre la puerta a un cupón "editado
   a mano" — se difiere a una iteración futura junto con la edición de cupones
   (§9.5). Pausar/reanudar un solo partido de un cupón tampoco aplica (el cupón
   se monitorea entero).

---

## 9. Wizard de alta rediseñado (`MatchFormSheet.vue`)

El wizard soporta **dos caminos** que bifurcan en el paso 1. Estado interno:
`step: 'entry' | 'processing' | 'review'` y `mode: 'search' | 'photo'`.

### 9.1 Los dos caminos (respuesta al PO sobre foto vs. alta manual)

- **Camino A — "Buscar un partido" (sin foto)**: search → elegir 1 partido →
  crea un **partido suelto** (sin cupón, sin predicciones). Es exactamente el
  buscador de `live-matches-ux.md` §5.1 (contra `search-matches`, debounce
  350ms, selector de día, fila deshabilitada "Ya lo seguís", estados de
  carga/vacío/error) — **se reusa tal cual, no se rediseña**.
- **Camino B — "Subir foto del cupón"**: foto → OCR client-side → review de
  **N grupos detectados**, cada grupo resuelto contra `search-matches` → crea un
  **cupón multi-partido**.

**Regla v1, documentada como decisión (respuesta directa al PO)**: **alta manual
= 1 partido suelto; foto = cupón multi-partido.** No se construye un armador
manual de cupón multi-partido (agregar partidos a mano + tipear cada predicción
y cada cuota) en v1 — el OCR es precisamente el atajo que hace ergonómico cargar
un cupón de varios partidos; un formulario manual equivalente sería pesado y de
bajo uso. Queda como mejora futura (§9.5). Consecuencia: **la única forma de
tener un cupón (con predicciones y cuotas) en v1 es la foto.** Un partido sin
foto queda suelto, sin sección de apuesta (igual que el punto 2 del encargo
original).

### 9.2 Paso 1 — `step === 'entry'`: elegir camino

El default es el buscador (camino A, el caso rápido más frecuente: "quiero ver
este partido"). Se agrega un acceso claro al camino B:

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Nuevo partido o cupón</SheetTitle>
    <SheetDescription>Buscá un partido para seguirlo, o subí la foto de tu cupón para seguir todas sus selecciones.</SheetDescription>
  </SheetHeader>

  <!-- Acceso al camino B, arriba del buscador, siempre visible -->
  <div class="px-4">
    <Button type="button" variant="outline" class="w-full" @click="startPhotoFlow">
      <Camera class="size-4" />
      Subir foto del cupón
    </Button>
  </div>

  <div class="relative px-4 py-2">
    <Separator />
    <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">o buscá un partido</span>
  </div>

  <!-- Buscador + selector de día + lista: idéntico a live-matches-ux.md §5.1.1/5.1.2/5.1.5 -->
  <!-- ... reusar tal cual ... -->
</SheetContent>
```

- `startPhotoFlow` abre el selector de archivo (`<input type="file"
  accept="image/*" capture="environment">`, mismo del §5.1.4 original); al
  elegir imagen, `mode = 'photo'` y avanza a `step === 'processing'`.
- En el **camino A**, elegir un partido de la lista y confirmar ("Agregar
  partido") llama a `addMatch({ matchId, homeTeam, awayTeam, league })` **sin
  legs y sin cupón** → partido suelto. Ya no existe el sub-paso "foto opcional
  después de elegir el partido" del §5.1.4 original (la foto ahora es un camino
  propio, no un adjunto a un partido ya elegido — ver §9.3 el porqué). Confirmar
  espera al servidor (no optimista, §1.8 original, sin cambios).

### 9.3 Por qué la foto deja de ser "adjunto a un partido ya elegido"

En el modelo viejo, el usuario elegía 1 partido y opcionalmente le adjuntaba una
foto cuyas selecciones eran de *ese* partido. En el modelo nuevo, **la foto
define el conjunto de partidos** (multi-partido) — preseleccionar un partido y
después subir una foto de un cupón de 5 partidos sería contradictorio (¿a cuál
de los 5 pertenece el partido preseleccionado?). Por eso los caminos se
**desacoplan**: o buscás un partido (suelto), o subís una foto (cupón). El
`search-matches` se sigue usando en el camino B, pero **por dentro del review**
(para resolver cada grupo detectado), no antes.

### 9.4 Paso 2 (`processing`) y Paso 3 (`review`) del camino B

**Paso 2 — `processing`**: idéntico a `live-matches-ux.md` §5.2 (spinner
"Leyendo el cupón...", sin cancelar, OCR client-side con Tesseract.js — el OCR
lo actualiza `vue-frontend-expert` en paralelo, no lo diseña este doc). El OCR
ahora devuelve una **lista de grupos** (equipos + sus predicciones con cuota),
no una lista plana de legs. Además, si puede, extrae `reference` (número de
cupón) y `stake_amount`. Por cada grupo, el frontend **resuelve el partido
contra `search-matches`** (reusando el buscador ya existente, §5.1) — busca por
los nombres de equipo del grupo y toma el mejor match confiable; si no hay match
confiable, el grupo queda "no vinculado".

**Paso 3 — `review`**: reemplaza la lista plana de legs (§5.3 original) por una
lista de **N grupos**, cada uno con: equipos, su resolución de partido, sus
predicciones con cuota. Más el monto apostado del cupón.

```html
<SheetContent side="bottom">
  <SheetHeader>
    <SheetTitle>Revisá tu cupón</SheetTitle>
    <SheetDescription>
      Leímos esto de la foto y puede tener errores. Revisá cada partido y sacá lo que no corresponda.
    </SheetDescription>
  </SheetHeader>

  <div class="flex max-h-[50vh] flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-2">
    <!-- Un bloque por grupo/partido detectado -->
    <div v-for="group in form.detectedGroups" :key="group.tempId" class="flex flex-col gap-2 rounded-lg border border-border p-3">
      <!-- Cabecera del grupo: equipos + resolución -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <p class="truncate text-sm font-medium">{{ group.homeTeam }}</p>
          <p class="truncate text-sm font-medium">{{ group.awayTeam }}</p>
          <!-- Estado de resolución -->
          <p v-if="group.resolved" class="flex items-center gap-1 text-xs text-success">
            <CircleCheck class="size-3.5 shrink-0" />
            Partido encontrado{{ group.resolved.league ? ' · ' + group.resolved.league : '' }}
          </p>
          <p v-else class="flex items-center gap-1 text-xs text-warning">
            <TriangleAlert class="size-3.5 shrink-0" />
            No encontramos este partido · no se va a poder seguir en vivo
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" class="size-9 shrink-0"
          :aria-label="`Quitar partido ${group.homeTeam} vs ${group.awayTeam}`" @click="discardGroup(group.tempId)">
          <CircleX class="size-4 text-muted-foreground" />
        </Button>
      </div>

      <!-- Predicciones del grupo -->
      <div class="flex flex-col gap-1.5 border-t border-border pt-2">
        <div v-for="pred in group.predictions" :key="pred.tempId" class="flex items-center gap-2">
          <div class="flex min-w-0 flex-1 flex-col">
            <p class="truncate text-sm">{{ pred.selectionLabel }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ pred.marketLabel }}</p>
          </div>
          <Badge v-if="pred.marketType === 'unknown'" variant="outline" class="shrink-0 text-[10px]">No monitoreable</Badge>
          <span class="shrink-0 text-xs font-semibold tabular-nums">{{ formatOdds(pred.odds) }}</span>
          <Button type="button" variant="ghost" size="icon" class="size-8 shrink-0"
            :aria-label="`Quitar selección ${pred.selectionLabel}`" @click="discardPrediction(group.tempId, pred.tempId)">
            <CircleX class="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <!-- Resolver a mano si no vinculó: reabrir el buscador acotado a este grupo -->
      <Button v-if="!group.resolved" type="button" variant="outline" size="sm" @click="openResolverFor(group.tempId)">
        <Search class="size-4" />
        Buscar este partido
      </Button>
    </div>

    <p v-if="form.detectedGroups.length === 0" class="py-6 text-center text-sm text-muted-foreground">
      No encontramos partidos en la foto.
    </p>
  </div>

  <!-- Monto apostado del cupón -->
  <div class="flex flex-col gap-1.5 border-t border-border px-4 py-3">
    <Label for="stake">Monto apostado (opcional)</Label>
    <Input id="stake" v-model="form.stakeAmount" type="text" inputmode="decimal" placeholder="0,00" class="text-base" />
    <p class="text-xs text-muted-foreground">La usamos para calcular tu posible ganancia. No la registramos como gasto.</p>
  </div>

  <SheetFooter>
    <Button type="button" variant="outline" :disabled="isSubmitting" @click="retakePhoto">Probar con otra foto</Button>
    <Button type="button" :disabled="isSubmitting" @click="confirmCoupon">
      <Loader2 v-if="isSubmitting" class="size-4 animate-spin" />
      {{ confirmLabel }}
    </Button>
  </SheetFooter>
</SheetContent>
```

Reglas del review:

- **Resolución por grupo**: cada grupo detectado se resuelve contra
  `search-matches` (los nombres de equipo del OCR → mejor coincidencia). Si
  vincula: chip verde "Partido encontrado". Si no: nota `warning` "No
  encontramos este partido · no se va a poder seguir en vivo" (**nunca se
  oculta el grupo** — se guarda como referencia, sus predicciones quedan
  `pending`/`not_monitorable`, coherente con el §3.1 matiz de partido no
  vinculado). El botón "Buscar este partido" abre el buscador ya existente
  (§5.1) **prefiltrado por los nombres del grupo** para que el usuario lo
  vincule a mano si quiere — reusa el mismo componente de búsqueda, no uno
  nuevo.
- **Quitar un grupo o una predicción es sin confirmación** (`CircleX` directo) —
  mismo argumento de §5.3 original: todavía no existe nada en la base, es una
  lista en memoria, descartar es reversible reintentando la foto.
- **Predicciones `unknown`/no monitoreables** se muestran igual con su badge
  (punto 4 del encargo original) — nunca se ocultan.
- **`stake_amount`**: se captura acá, **a nivel cupón** (una sola vez, no por
  partido). Opcional. Prefill con lo que haya leído el OCR (editable). El copy
  aclara explícitamente que **no se registra como gasto** (coherencia de
  alcance, §6.3). Parseo de coma/punto decimal a cargo de
  `vue-frontend-expert` (formato `es-AR`). **Las cuotas individuales NO se
  editan en v1** (vienen del OCR, se muestran, se pueden quitar la predicción
  entera si está mal — no editar el número); `total_odds`/`potential_return` los
  calcula el backend a partir de las cuotas que sobrevivan + el stake. Editar
  cuotas a mano es §9.5 (futuro).
- **`confirmLabel`**: "Crear cupón" si queda ≥1 grupo con ≥1 predicción;
  "Continuar sin cupón" si el usuario descartó todo (mismo patrón de fallback
  del §5.3/§5.4 original — si no quedó nada, se puede seguir sin cupón; en la
  práctica del camino B eso significa cerrar sin crear nada, o crear los
  partidos vinculados como sueltos — decisión menor para `vue-frontend-expert`,
  sugerido: si no queda ninguna predicción, ofrecer solo cerrar).
- **Scroll interno** (`max-h-[50vh] overflow-y-auto`): igual que §5.1.5
  original, un cupón de 5 partidos con predicciones no entra en una pantalla —
  techo explícito para que el footer (stake + botones) no se empuje fuera.

### 9.5 Confirmación y alta atómica

`confirmCoupon()` llama a un único endpoint atómico (Edge Function/RPC, a
definir con backend — mismo criterio `create_debt`/§5.5 original) que inserta en
una transacción: el `bet_slip` (con `reference`/`stake_amount`) + los N
`live_matches` (con su `flashscore_mid` para los vinculados, `NULL` para los no
vinculados) + los `bet_slip_legs` (predicciones con `odds`). No optimista (§1.8
original): el usuario ve "Guardando..." y el Sheet deshabilitado hasta la
confirmación. Al OK: `toast.success('¡Listo! Ya estamos siguiendo tu cupón.')`,
cerrar, la card del cupón aparece en la lista (estado transitorio "buscando
datos" por partido hasta el primer poll, §7.3). El backend hace el primer poll
sincrónico de los partidos vinculados (como `create_live_match` ya hace).

### 9.6 Fuera de alcance del wizard en v1 (documentado, no olvido)

- Armador manual de cupón multi-partido (sin foto).
- Editar un cupón ya creado: agregar/quitar partidos, editar cuotas o el stake
  después del alta, quitar un solo partido de un cupón (§8 punto 2).
- Elegir/editar predicciones a mano (más allá de quitarlas en el review).

Todo esto es coherente con el criterio del encargo ("foto = multi-partido,
manual = 1 partido") y con el "no edición inline de legs en v1" del §10
original. Se difiere a iteraciones futuras.

---

## 10. Accesibilidad — additions al checklist de `live-matches-ux.md` §9

Todo el §9 original sigue vigente. Nuevo de este doc:

1. **`CouponStatusRing` no depende del color**: `role="img"` + `aria-label`
   compuesto con los 4 conteos + el "X/Y acertados" del centro en tinta; la
   leyenda de al lado repite los 4 estados en ícono+texto+número. Un lector de
   pantalla obtiene todo sin percibir un solo color (§6.2). Cubre el hallazgo
   CVD rojo↔verde del validador (§4).
2. **Gap de 2px entre segmentos del anillo** (spec `dataviz`) — separa
   físicamente el par rojo↔verde en la costura, refuerzo del punto 1.
3. **`Tabs`**: Reka UI ya da `role="tablist"`/`role="tab"`/`role="tabpanel"`,
   navegación por flechas y `aria-selected` — no reimplementar. "Todos" es el
   tab por defecto (nada oculto por defecto, §3.4).
4. **Fila-disclosure de partido en el cupón**: `aria-expanded` +
   `aria-controls` apuntando al `id` del panel; el panel es hermano, alcanzable
   en orden de lectura natural. El chevron es `aria-hidden` (el estado lo
   comunica `aria-expanded`, no el ícono).
5. **Glyph de `bet_status` con `sr-only`** del label ("Ganado"/"En juego"/
   "Pendiente"/"Perdido"/"No vinculado") antes de los equipos — el ícono/color
   nunca es el único portador del estado en la fila.
6. **Review multi-grupo**: cada botón de quitar (grupo o predicción) lleva
   `aria-label` con el nombre del partido/selección (no "Quitar" a secas), para
   que el lector de pantalla distinga cuál se quita — misma regla que §9.5
   original.
7. **Input de `stake_amount`**: `type="text" inputmode="decimal"` + `text-base`
   (16px, evita zoom de iOS) + `<Label for>` persistente — regla de inputs de
   siempre.
8. **"Posible ganancia" en `text-success`**: acompañada del label "Posible
   ganancia" en texto — el verde es refuerzo, no el único indicador de qué es
   ese número.

---

## 11. Preguntas abiertas / alineación con `supabase-backend-expert`

Lo que este doc **decidió** y backend debe reflejar 1:1 (marcado ⚠️ arriba donde
ajusté la propuesta del encargo):

1. **Modelo de 3 entidades** (§1): `bet_slips` (cupón) + `live_matches` con
   `bet_slip_id` **nullable** + `bet_slip_legs` con **`odds` nuevo**. Nombres
   ilustrativos, confirmar.
2. **Estados derivados server-side** (§3.1/§3.2): `bet_status` de 4 valores por
   partido-en-cupón; `status` de 3 valores por cupón. **El frontend no los
   deriva.** `total_odds` = producto de `odds`; `potential_return` = `stake ×
   total_odds`; ambos server-side, `potential_return` null si stake null.
3. ⚠️ **Flag de "partido vinculado"** (§3.1 matiz): además de `bet_status`,
   backend expone un booleano/campo para distinguir `pending`-no-empezó de
   `pending`-no-vinculado-a-Flashscore (p. ej. `flashscore_mid IS NULL`) — el
   frontend lo usa solo para el copy de la fila, no para el anillo.
4. ⚠️ **Buckets de tabs** (§3.4): confirmados sobre **ítems de primer nivel
   (cupones Y partidos sueltos)**, no solo cupones. "En vivo" = no terminal +
   algo en curso ahora; "Finalizados" = terminal; los "por empezar / nada en
   curso" caen **solo en Todos** (sin 4ª pestaña). Que backend, si expone una
   vista de listado, no asuma que los tabs son cupón-only.
5. **Alta atómica** (§9.5): un único endpoint que crea cupón + N partidos +
   predicciones en una transacción (mismo criterio `create_debt`). Debe hacer el
   primer poll sincrónico de los partidos vinculados.
6. **OCR devuelve grupos** (§9.4): la lógica client-side de OCR
   (`betSlipParser`/`marketMapper` en `src/lib/`, la actualiza
   `vue-frontend-expert`) debe pasar de "lista plana de legs" a "lista de grupos
   {equipos, predicciones con odds}" + `reference`/`stake` si los lee. No es
   backend, pero se anota para coordinar.
7. **Persistencia de la foto** (§5.6 original): sin cambios, decisión 100% de
   backend, sin impacto de UX.
8. **`reference` del cupón** (§6.1): opcional, del OCR; el frontend tiene
   fallback "Cupón". Backend decide si además guarda fecha/otro identificador.

Sigue **fuera de alcance en v1** (además de lo del §10 original): historial de
apuestas en dinero real, cruce con finanzas, edición de cupones, armador manual
multi-partido, quitar un partido individual de un cupón (§9.6).
