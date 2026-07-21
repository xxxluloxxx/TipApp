# TipApp — UX de Préstamos (cronograma de cuotas + personas que me deben)

Documento de especificación funcional/UX para `vue-frontend-expert`. Da por
sentado todo lo ya resuelto en `docs/design-system.md` (tokens, tipografía,
Card-list, Sheet inferior, a11y, **sección 6 "Header + navegación"** —
`AppHeader`/`NavigationDrawer`, regla dura de "nunca botón Volver"),
`docs/features/debts-ux.md` (primer uso de `Tabs`, patrón de cards resumen
con `success`/`destructive` reservados para polaridad financiera real,
criterio "sin guard de conteo cuando borrar no destruye historial real",
patrón de Sheet con `Select` dependiente + atajo "Agregar persona nueva") y
`docs/features/fixed-expenses-ux.md` (criterio de "estado derivado 100%
cliente vs. vista SQL", barra de progreso hand-rolled en vez de instalar
`Progress`, badge de estado ícono+texto). No se repite esa justificación
acá, solo se referencia y se indica explícitamente qué se reusa tal cual y
qué es nuevo.

**Esta es una feature nueva y separada de "Deudas" (`debts`/`debt_movements`/
`debt_balances`, ya implementada, `docs/features/debts-ux.md`) — no la
reemplaza, no se fusiona con ella, no se toca ningún archivo de esa
feature.** Decisión ya tomada por el Product Owner antes de delegar, no se
reabre acá. Ambas conviven en el drawer como ítems separados (sección 8).
La única superposición real, y deliberada, es de **identidad de persona**:
"Préstamos" reusa la tabla `debt_people` (ya existente, gestionada en
`/deudas/personas`) para el nombre/color de quién le debe al usuario una
porción de un préstamo puntual — se reusa la entidad, no se duplica ni se
crea una tercera tabla de personas. `debt_people` en sí y su pantalla de
gestión **no se tocan**.

Contexto de dominio (ya decidido por el Product Owner, no se rediscute
acá): un **préstamo** es una obligación real del usuario con un tercero
(banco, financiera, etc.) — el usuario es el deudor, lo devuelve en cuotas
fijas mensuales. El usuario puede, además, repartir parte de esa plata
prestada entre otras personas (`debt_people`), que a su vez le deben al
usuario una porción de ese préstamo puntual — un ledger propio de pagos
recibidos, sin cronograma de cuotas para esa dirección (ver sección 1.4).
**Aislamiento total del resto del dominio financiero** (punto 4 del
encargo, no se reabre): ninguna operación de esta feature genera fila en
`expenses`/`incomes`, ni ajusta `account_balances`. El préstamo, sus cuotas
y los pagos recibidos de terceros son un registro puramente informativo,
paralelo a Transacciones/Cuentas, igual que el saldo agregado no toca nada
salvo sus propias tablas.

La referencia visual ("Mis Finanzas", mockup de otra app, pantalla
"Préstamos", 6 capturas) se usa **únicamente** para el contenido/layout que
muestra — se adapta, no se copia literal: sin bottom tab bar (TipApp usa
exclusivamente el drawer lateral en todos los anchos) y sin botón "Volver"
en ningún header (regla dura de `design-system.md` sección 6, la misma que
ya aplican Deudas/Gastos fijos/Transferencias). Ver sección 13 para el
detalle completo de qué NO se adopta de la referencia.

---

## 1. Contrato de datos (dirección ya fijada por el Product Owner) y estrategia de derivación

El backend implementó en paralelo sobre este contrato — este documento
diseña sobre él, no lo redefine. **Nota post-implementación (verificado por
el Product Owner contra las migraciones reales aplicadas al proyecto
remoto)**: los nombres de columna de este documento ya están **confirmados
contra el esquema final** (`loans.monthly_installment_amount`,
`loan_debtors.amount_owed`, y las vistas `loan_progress`/
`loan_debtor_balances`/`loans_summary` con exactamente los nombres de
columna usados en el resto de este documento) — backend hizo un
fast-follow (`20260721090800_loan_progress_views_align_ux_naming.sql`)
para alinear sus vistas a la nomenclatura que este doc ya usaba. Ya no
quedan nombres ilustrativos pendientes de confirmar.

### 1.1 Tablas base

- **`loans`**: `user_id`, `name` (texto libre, ej. "Préstamo Personal"),
  `description` (texto libre **opcional**, ej. "Descuento por nómina" —
  **no es un campo estructurado nuevo**, es simplemente el campo
  `description` ya previsto en el contrato, mostrado como subtítulo debajo
  del nombre; ver sección 3.2), `total_amount`, `monthly_installment_amount`,
  `start_date`, `term_months`. **`fecha_fin_estimada` NO se guarda** — se
  deriva siempre como `addMonths(start_date, term_months)` (helper ya
  existente en `src/lib/date.ts`, reusado sin cambios), tanto en cualquier
  vista SQL que la necesite como en cliente si hiciera falta mostrarla sin
  esperar un fetch adicional — un único punto de verdad para la fórmula,
  nunca una columna que pueda desincronizarse.
- **`loan_installments`**: hija de `loans`, generadas **todas de una vez**
  al crear el préstamo, vía una RPC atómica (mismo patrón que `create_debt`/
  `create_live_match`/`ensure_current_fixed_expense_instances`, ver sección
  1.5). Si `total_amount` no divide exacto por `term_months`, **la última
  cuota absorbe el resto** (redondeo) — esto ya está decidido por el
  Product Owner, documentado acá para que el frontend nunca reparta el
  resto de otra forma (ej. repartir el resto entre varias cuotas, o
  redondear cada cuota y perder centavos) — la cuota N (N < `term_months`)
  es siempre `round(total_amount / term_months, 2)`, la última es
  `total_amount - suma de las N-1 anteriores`.
  - **Recomendación a backend, no una decisión de UX que se imponga**: que
    cada fila de `loan_installments` guarde su propia `due_date` real
    (calculada una sola vez, en el momento de generarse todas juntas —
    ej. cuota N vence `addMonths(start_date, N)`, la cuota 1 vence un mes
    después del inicio del préstamo, no el mismo día) en vez de que el
    frontend la recalcule cada vez a partir de `installment_number` — un
    único punto de verdad para "cuándo vence cada cuota", mismo espíritu
    que la sección de arriba para `fecha_fin_estimada`. Si backend prefiere
    no guardarla y derivarla en la vista de la sección 1.2, es equivalente
    siempre que el frontend nunca tenga que reproducir esa cuenta por su
    cuenta en dos lugares distintos del código.
  - Campos por fila: `installment_number` (1..`term_months`), `amount`,
    `due_date`, `status: 'pending' | 'paid'`, `paid_at` (nullable) — mismo
    patrón de 2 estados que `fixed_expense_instances` (`fixed-expenses-ux.md`
    sección 1), sin equivalente a `expense_id` acá porque marcar una cuota
    pagada **no genera ningún gasto real** (aislamiento total, ver
    intro) — es una actualización de estado pura, sin ninguna escritura
    dependiente en otra tabla (diferencia clave con
    `pay_fixed_expense_instance`, ver sección 1.6).
- **`loan_debtors`**: personas que deben una porción de ESE préstamo
  puntual. `loan_id` (FK a `loans`), `debt_person_id` (FK a `debt_people`,
  **reusada solo para identidad — nombre/color**, tabla ya existente y
  gestionada en `/deudas/personas`, no se toca ni se duplica),
  `amount_owed` (cuánto le corresponde a esa persona de ese préstamo).
  `unique (loan_id, debt_person_id)` — implementado por backend como
  fast-follow (`20260721090700_loan_debtors_unique_person.sql`), una
  persona no puede ser agregada dos veces al mismo préstamo (sección 6.2).
- **`loan_debtor_payments`**: ledger de pagos recibidos de una persona
  puntual (`loan_debtor_id`, `amount`, `payment_date`) — sin cronograma
  propio, ver sección 1.4.

### 1.2 Estado/progreso/saldo: siempre derivado vía vistas, nunca resumido en cliente

Mismo criterio ya usado en `debt_balances`/`bet_slip_summary`/
`fixed_expenses_summary` (instrucción explícita del encargo para esta
feature, no una preferencia de este documento) — dos vistas nuevas,
`security_invoker = true` como todas las anteriores:

```sql
-- Nombres/columnas confirmados contra el esquema final aplicado (ver nota de la sección 1).
create view public.loan_progress as
select
  l.id as loan_id,
  l.user_id,
  l.name,
  l.description,
  l.total_amount,
  l.monthly_installment_amount,
  l.start_date,
  l.term_months,
  coalesce(count(*) filter (where li.status = 'paid'), 0) as paid_count,
  count(li.id) as total_count,
  coalesce(sum(li.amount) filter (where li.status = 'paid'), 0) as paid_amount,
  coalesce(sum(li.amount) filter (where li.status = 'pending'), 0) as remaining_amount,
  (count(*) filter (where li.status = 'paid') = count(li.id)) as is_completed,
  exists (
    select 1 from public.loan_installments x
    where x.loan_id = l.id and x.status = 'pending' and x.due_date < current_date
  ) as has_overdue,
  min(li.installment_number) filter (where li.status = 'pending') as next_installment_number,
  (select amount from public.loan_installments x
     where x.loan_id = l.id and x.status = 'pending' order by installment_number limit 1) as next_installment_amount,
  (select due_date from public.loan_installments x
     where x.loan_id = l.id and x.status = 'pending' order by installment_number limit 1) as next_installment_due_date
from public.loans l
left join public.loan_installments li on li.loan_id = l.id
group by l.id;

create view public.loan_debtor_balances as
select
  ld.id as loan_debtor_id,
  ld.loan_id,
  ld.debt_person_id,
  ld.amount as amount_assigned,
  coalesce(sum(p.amount), 0) as amount_received,
  ld.amount - coalesce(sum(p.amount), 0) as balance_remaining,
  max(p.payment_date) as last_payment_date
from public.loan_debtors ld
left join public.loan_debtor_payments p on p.loan_debtor_id = ld.id
group by ld.id;
```

- `percent_complete` (`paid_count / total_count * 100`, o
  `paid_amount / total_amount * 100` — **se elige `paid_count/total_count`**,
  no el monto: el mockup habla de "Cuotas pagadas X de Y" como la métrica
  primaria, y con la última cuota absorbiendo el resto de la sección 1.1 el
  monto de cada cuota no es perfectamente uniforme — contar cuotas es la
  lectura más honesta de "a qué altura del cronograma estoy"; se calcula en
  cliente a partir de `paid_count`/`total_count` ya presentes en la vista,
  sin necesidad de una columna más) — fórmula exacta en sección 4.4.
- `has_overdue`/`is_completed`: **ambos booleanos derivados server-side**
  (`current_date` vive en el servidor, nunca en el reloj del cliente) —
  a diferencia del estado "Vencido" 100% cliente que ya usa
  `fixed-expenses-ux.md` sección 6.1 (ese documento es anterior a esta
  instrucción explícita de "siempre vía vista" del encargo de Préstamos;
  no se retroactiva ese documento, pero acá sí se sigue la instrucción tal
  cual se dio). Consecuencia práctica: la lista `/prestamos` puede mostrar
  el badge de estado de cada préstamo (sección 3.2) sin tener que cargar
  las `N` cuotas de cada uno solo para calcularlo en cliente.
- `loan_debtor_balances` es, por diseño, una vista de cardinalidad chica
  por fila (una fila por persona-préstamo, no por pago) — mismo argumento
  de escala que `debt_balances` (`debts-ux.md` sección 1.2): es seguro
  traerla completa y agregar en cliente para el resumen global (sección
  2.2).

### 1.3 Lo que sí sigue prohibido: sumar `loan_debtor_payments`/`loan_installments` sin acotar en cliente

Ambas son tablas de eventos que crecen con el tiempo (una fila por pago
recibido / una fila por cuota, esta última acotada por diseño a
`term_months` de un préstamo puntual, ver abajo). Ninguna pantalla de esta
feature suma esas tablas directamente:

- **El ledger completo de pagos de una persona** (`/prestamos/:id`, tab
  Personas, sección 4.3): se agrega vía `loan_debtor_balances` (sección
  1.2), nunca sumando `loan_debtor_payments` en cliente.
- **La lista de cuotas de un préstamo** (`/prestamos/:id`, tab Cuotas,
  sección 4.2): es la única excepción sin filtro, justificada igual que el
  ledger completo de un hilo de deuda (`debts-ux.md` sección 1.3) — el
  volumen de cuotas de **un solo préstamo** está acotado por diseño
  (`term_months`, típicamente 6-60), no por un límite defensivo arbitrario
  — se trae completo con un único `select * from loan_installments where
  loan_id = :id order by installment_number`, sin `.limit()` adicional
  porque la cardinalidad ya está acotada por la naturaleza del dato (a
  diferencia de `expenses`/`debt_movements`, que sí necesitan un límite
  defensivo porque no tienen ningún techo natural).

### 1.4 "Próximo pago esperado" de una persona: se omite, el modelo no lo soporta

El encargo ya lo anticipa como ambigüedad a resolver — **se omite por
completo** en la fila de persona (sección 4.3), no se muestra `null`/"Sin
datos" ni ningún placeholder. Motivo: `loan_debtor_payments` es un ledger
de pagos ya recibidos, sin ninguna columna de cronograma esperado para esa
dirección (a diferencia de `loan_installments`, que sí tiene un
`due_date` real porque es el cronograma del usuario **con el banco**, no de
una persona con el usuario) — inventar una fecha "esperada" sin ningún dato
que la respalde sería mostrar información que no existe. Si a futuro el
Product Owner quiere un cronograma de cobro por persona, es un cambio de
modelo (una tabla nueva análoga a `loan_installments` pero para el lado
"me deben"), no algo que este documento decida unilateralmente.

### 1.5 RPC de alta: mismo patrón que `create_debt`/`create_live_match`

**Crear un préstamo es la única operación no-optimista de esta feature**,
mismo motivo exacto ya usado en Deudas/Gastos fijos: es una escritura
atómica de 1 `loans` + N `loan_installments` (mismo criterio que
`create_debt` inserta cabecera + primer movimiento, o
`ensure_current_fixed_expense_instances` genera instancias en lote) — el
cliente no puede fabricar de antemano los `id` reales de N cuotas con
`due_date`s ya resueltas server-side (sección 1.1). Firma final (confirmada contra la migración aplicada):

```
create_loan(p_name, p_total_amount, p_monthly_installment_amount, p_start_date,
            p_term_months, p_description default null) returns uuid
```

`security invoker`, inserta `loans` + genera las `term_months` filas de
`loan_installments` en la misma transacción (última cuota absorbe el
resto, sección 1.1).

### 1.6 Por qué marcar una cuota como pagada/no pagada SÍ es optimista (a diferencia de `pay_fixed_expense_instance`)

Diferencia real con Gastos fijos, no una inconsistencia: pagar una
instancia de gasto fijo es no-optimista porque esa operación **además**
crea un `expenses` real (dos escrituras dependientes, `fixed-expenses-ux.md`
sección 5.2). Acá, por el aislamiento total del punto 4 del encargo,
marcar una cuota pagada/pendiente es **una única escritura** (`update
loan_installments set status = ..., paid_at = ...`), sin ninguna fila
generada en otra tabla — mismo perfil que "Pausar/Reanudar" un gasto fijo
(`fixed-expenses-ux.md` sección 7: toggle directo, optimista, rollback +
toast en error, sin `AlertDialog` porque es 100% reversible con un segundo
tap). Sección 4.2 detalla el gesto exacto.

### 1.7 Registrar/editar/borrar un pago recibido de una persona, y agregar/quitar una persona de un préstamo: optimistas

Mismo criterio que un `debt_movement` suelto sobre un hilo ya existente
(`debts-ux.md` sección 7.2, no la creación del hilo en sí): son inserts/
updates/deletes de una sola tabla, sin dependencia atómica entre escrituras
distintas — optimistas con rollback + toast, ajustando `loan_debtor_balances`
localmente vía el mismo mecanismo de "delta seguro" ya usado por
`debtsStore` (sumar/restar sobre un balance ya confirmado por el servidor,
nunca resumir el ledger completo desde cero).

---

## 2. Resolución de las 2 ambigüedades planteadas en el encargo

### 2.1 "Total que debo recibir" en la lista: agregado GLOBAL, no por préstamo

**Decisión: la card "Total que debo recibir" de `/prestamos` (lista) es un
agregado GLOBAL** — suma de `loan_debtor_balances.balance_remaining` de
**todos los `loan_debtors` del usuario, de todos sus préstamos** (activos
e Historial por igual, ver matiz importante abajo) — no una card por
préstamo individual.

**Argumento**:

1. **Precedente directo y ya establecido en el propio proyecto**: el
   dashboard de Deudas (`debts-ux.md` sección 3.2) resuelve exactamente el
   mismo tipo de pregunta ("¿resumen agregado o por hilo?") con cards
   **globales** ("Total pendiente por cobrar"/"Total pendiente por pagar"),
   dejando el detalle por contraparte individual para más abajo en la
   misma pantalla (tabs) o en el detalle. Replicar ese mismo criterio acá
   mantiene la lectura de "la pantalla de lista es panorama global, el
   detalle de cada entidad vive en su propia fila/ruta" consistente en
   toda la app — no hay ninguna razón nueva en Préstamos que justifique
   invertir ese patrón.
2. **La referencia visual solo mostraba un préstamo** (ambigüedad
   reconocida en el propio encargo) — con un solo préstamo, un agregado
   global y un agregado "por préstamo" son indistinguibles visualmente,
   por eso la captura no resuelve la duda por sí sola. Pero apenas hay 2+
   préstamos activos, un resumen **por préstamo individual en la lista**
   dejaría de caber en una card de resumen de la pantalla de lista (¿una
   card por préstamo, repetida N veces? Eso ya es, en la práctica, lo que
   hace cada card de préstamo individual más abajo en la sección 3.2 con
   su propio "Progreso general" — sería una redundancia, no un resumen).
3. **El desglose por préstamo ya existe, en el lugar correcto**: cada card
   de préstamo en la lista (sección 3.2) ya muestra su propio "Progreso
   general" con datos de ESE préstamo, y el detalle (`/prestamos/:id`, tab
   Personas, sección 4.3) ya lista cada persona de ESE préstamo con su
   propio saldo. No hace falta que la card de resumen agregado de la lista
   duplique esa granularidad — su rol es distinto: dar una foto de "cuánto
   tengo pendiente de cobrar en total, entre todas las personas de todos
   mis préstamos", una pregunta que **solo** un agregado global puede
   responder de un vistazo.

**Matiz documentado, no una laguna**: el agregado global suma
`loan_debtors` de préstamos **activos e Historial por igual** — a
diferencia de si el préstamo en sí ya está saldado (Historial), una
persona podría seguir debiéndole al usuario una porción de ese préstamo ya
terminado (el cronograma del usuario con el banco y el ledger de esa
persona con el usuario son independientes, sección 1.4 lo señala para el
"próximo pago esperado" y aplica igual acá). Excluir Historial subestimaría
el total real pendiente de cobrar. Se documenta explícitamente para que
`vue-frontend-expert` no filtre por `is_completed` al armar esta suma.

### 2.2 Estado "Atrasado": SÍ existe, como segundo estado además de "Al día" — y un tercero, "Completado", para Historial

**Decisión: sí, se agrega "Atrasado"**, más un tercer estado "Completado"
que el encargo no preguntaba explícitamente pero que surge con naturalidad
del propio modelo (una vez que existen 2 tabs, Activos/Historial, el
detalle de un préstamo en Historial necesita su propio badge coherente, no
heredar "Al día" que ya no describe la realidad).

**Argumento para agregar "Atrasado"**:

1. **El propio modelo ya lo hace verificable sin trabajo extra**: a
   diferencia de si `loan_installments` no tuviera `due_date`, acá el
   contrato ya incluye una fecha de vencimiento real por cuota (sección
   1.1) — no detectar "Atrasado" cuando el dato para hacerlo ya existe
   sería ignorar información real y accionable, exactamente el mismo
   argumento que ya usó `fixed-expenses-ux.md` sección 6.1 para agregar su
   propio estado "Vencido" sobre un contrato que sí lo permitía calcular.
2. **Mismo criterio CVD ya establecido en el proyecto** (ver hallazgo de
   daltonismo rojo/verde documentado en `CLAUDE.md`): "Atrasado" nunca se
   comunica solo por color, siempre ícono + texto (sección 5).
3. **A diferencia de "Vencido" en Gastos fijos (100% cliente), acá el
   booleano ya viene resuelto server-side** (`loan_progress.has_overdue`,
   sección 1.2) — no hace falta que el frontend recorra las cuotas de cada
   préstamo de la lista para saber si alguno está atrasado, la vista ya lo
   agrega.

**Argumento para agregar "Completado" (tercer estado, solo aplica a
préstamos del tab Historial)**:

Con solo 2 estados (Al día/Atrasado) un préstamo que ya terminó de pagarse
en su totalidad quedaría descripto, técnicamente, como "Al día" (no tiene
ninguna cuota atrasada porque no tiene ninguna cuota pendiente) — un badge
verdadero pero engañoso, que no comunica el logro real de "esto ya
terminó". Se agrega un tercer valor con su propio ícono/color (sección 5),
consistente con el mismo criterio de "codificación honesta del estado
real" que ya motivó el estado "Vencido" de Gastos fijos.

**Tabla resultante de 3 estados** (detalle completo con íconos/colores en
sección 5):

| Estado | Cuándo | ¿Dónde aparece? |
|---|---|---|
| `overdue` ("Atrasado") | `has_overdue = true` | Activos y, en teoría, Historial (no debería ocurrir en la práctica: un préstamo completado no puede tener cuotas pendientes vencidas — se cubre igual por completitud del tipo) |
| `completed` ("Completado") | `is_completed = true` | Solo Historial |
| `current` ("Al día") | ninguna de las dos anteriores | Solo Activos |

**Los tabs Activos/Historial se derivan de `is_completed`, no al revés**:
Activos = `is_completed = false`; Historial = `is_completed = true` — el
badge de estado no es lo que decide en qué tab aparece un préstamo, es al
revés (mismo orden de dependencia que ya usa Gastos fijos: el tab es la
partición real por dato de backend, el badge es una capa de lectura sobre
esa misma partición).

---

## 3. Arquitectura de rutas: 2 rutas — lista + detalle (mismo criterio "ni 1 ni 4" ya calibrado en el proyecto)

Mismo ejercicio ya hecho en Cuentas (1), Deudas (2→3), Tarjetas (4), Gastos
fijos (1→2 con Comparación mensual), Transferencias (1). **Decisión: 2
rutas.**

- **No alcanza con 1 ruta** (como Cuentas/Transferencias): a diferencia de
  una transferencia (evento atómico sin estructura interna,
  `account-transfers-ux.md` sección 2.1), un préstamo **sí** es un
  contenedor real con estructura propia navegable — N cuotas con estado
  individual + N personas con su propio ledger — pedido explícito del
  encargo ("alcance completo... lista + detalle con cuotas + sub-sistema
  de personas"). Eso es, por definición, una necesidad de detalle propio,
  igual que ya lo fue para Deudas (`/deudas/:id`).
- **No hace falta una 3ª ruta de gestión de entidad secundaria** (a
  diferencia de Deudas con `/deudas/personas` o Tarjetas con
  `/tarjetas/gestionar`): la identidad de "persona" ya está resuelta y
  gestionada por completo en `/deudas/personas` (tabla `debt_people`
  reusada, sección introductoria) — lo único propio de esta feature es la
  **asignación** de una persona ya existente a un préstamo puntual con un
  monto (`loan_debtors`), que vive dentro del propio detalle del préstamo
  (tab Personas, sección 4.3), no en una ruta de gestión aparte. No hay
  ninguna entidad nueva que amerite su propia pantalla de gestión
  independiente.

| Path | Nombre | Meta | Vista |
|---|---|---|---|
| `/prestamos` | `loans` | `{ requiresAuth: true }` | `LoansListView` |
| `/prestamos/:id` | `loan-detail` | `{ requiresAuth: true }` | `LoanDetailView` |

Sin colisión de segmento literal-vs-dinámico — no hace falta ningún orden
especial en el array de rutas.

---

## 4. `/prestamos` — Lista

```html
<AppHeader title="Préstamos" />
```

Sin botón "Volver" (regla dura de `design-system.md` sección 6) — el
drawer de `AppHeader` es la única navegación hacia atrás, igual que el
resto de vistas ya implementadas.

### 4.1 Orden de secciones en el `<main>`

1. Card "Total que debo recibir" (resumen global, sección 2.1) — se oculta
   si el usuario no tiene ningún `loan_debtor` en ningún préstamo (mismo
   criterio de "no mostrar un $0 destacado sin motivo" ya usado en
   Transferencias/Deudas).
2. `Tabs` Activos / Historial (sección 4.3).
3. FAB "Nuevo préstamo" (sección 4.5), persistente sobre todo lo anterior.

### 4.2 Card "Total que debo recibir" (resumen global)

```html
<Card v-if="totalDebtorBalance > 0" class="border-success/30 bg-success/5">
  <CardHeader class="pb-2">
    <CardDescription class="text-success">Total que debo recibir</CardDescription>
  </CardHeader>
  <div class="grid grid-cols-2 gap-3 px-6 pb-4">
    <div class="flex flex-col gap-0.5">
      <p class="text-lg font-semibold tabular-nums">${{ formatAmount(totalReceived) }}</p>
      <p class="text-xs text-muted-foreground">Recibido</p>
    </div>
    <div class="flex flex-col gap-0.5">
      <p class="text-lg font-semibold tabular-nums text-success">${{ formatAmount(totalDebtorBalance) }}</p>
      <p class="text-xs text-muted-foreground">Falta por recibir</p>
    </div>
  </div>
</Card>
```

- `totalReceived`/`totalDebtorBalance`: suma de
  `loan_debtor_balances.amount_received`/`balance_remaining` sobre **todos**
  los `loan_debtors` del usuario (sección 2.1, incluye Historial) — query
  única al cargar la pantalla, seguro por cardinalidad chica (sección 1.2).
- `success` acá porque, igual que en Deudas (`debts-ux.md` sección 3.2), es
  una polaridad financiera real y binaria ("plata que me deben"), no una
  transacción individual — mismo criterio de "reservado para el resumen de
  alto nivel, no para el ruido de cada fila".

### 4.3 `Tabs` Activos / Historial

Mismo componente ya instalado (`Tabs`/`TabsList`/`TabsTrigger`/
`TabsContent` de shadcn-vue, sección 3.4 de `debts-ux.md`), mismo criterio
de por qué `Tabs` y no `radiogroup` (paneles de contenido completos, no un
campo de formulario):

```html
<Tabs v-model="activeTab" default-value="active">
  <TabsList class="grid w-full grid-cols-2">
    <TabsTrigger value="active">Activos</TabsTrigger>
    <TabsTrigger value="history">Historial</TabsTrigger>
  </TabsList>

  <TabsContent value="active"><!-- loans donde is_completed = false --></TabsContent>
  <TabsContent value="history"><!-- loans donde is_completed = true --></TabsContent>
</Tabs>
```

Default: "Activos" (mismo criterio de "lo accionable primero" que Deudas/
Gastos fijos). Sin persistencia de tab activo entre visitas, mismo criterio
que el resto de la app.

### 4.4 Card de préstamo (por fila, dentro de cada tab)

```html
<Card
  class="cursor-pointer transition-colors hover:bg-accent/50"
  role="button"
  tabindex="0"
  @click="router.push({ name: 'loan-detail', params: { id: loan.loanId } })"
  @keydown.enter="router.push({ name: 'loan-detail', params: { id: loan.loanId } })"
>
  <CardHeader class="gap-1 pb-2">
    <div class="flex items-start justify-between gap-2">
      <div class="flex min-w-0 flex-col">
        <CardTitle class="truncate text-base font-semibold">{{ loan.name }}</CardTitle>
        <CardDescription v-if="loan.description" class="truncate">{{ loan.description }}</CardDescription>
      </div>
      <LoanStatusBadge :status="loanBadgeStatus(loan)" />
    </div>
  </CardHeader>

  <div class="grid grid-cols-2 gap-3 px-6 pb-3 text-sm sm:grid-cols-4">
    <div class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Total del préstamo</p>
      <p class="font-medium tabular-nums">${{ formatAmount(loan.totalAmount) }}</p>
    </div>
    <div class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Cuota mensual</p>
      <p class="font-medium tabular-nums">${{ formatAmount(loan.monthlyPayment) }}</p>
    </div>
    <div class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Inicio</p>
      <p class="font-medium">{{ formatDateChip(loan.startDate) }}</p>
    </div>
    <div class="flex flex-col gap-0.5">
      <p class="text-xs text-muted-foreground">Fin estimado</p>
      <p class="font-medium">{{ formatDateChip(loan.estimatedEndDate) }}</p>
    </div>
  </div>

  <Separator />

  <div class="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
    <LoanProgressRing :percent="loan.percentComplete" :size="72" />
    <div class="flex flex-1 flex-col gap-1">
      <p class="text-sm font-medium">Progreso general</p>
      <p class="text-xs text-muted-foreground">
        Cuotas pagadas {{ loan.paidCount }} de {{ loan.totalCount }}
      </p>
      <div class="flex items-center gap-3 text-xs">
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-success" /> Pagado: ${{ formatAmount(loan.paidAmount) }}</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-muted-foreground/40" /> Falta: ${{ formatAmount(loan.remainingAmount) }}</span>
      </div>
    </div>
  </div>

  <div v-if="loan.debtorsCount > 0" class="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
    <Users class="size-3.5" />
    Recibido {{ formatAmount(loan.debtorsReceived) }} de ${{ formatAmount(loan.debtorsTotal) }} entre {{ loan.debtorsCount }} persona{{ loan.debtorsCount === 1 ? '' : 's' }}
  </div>
</Card>
```

- `loan.description` como subtítulo directo bajo el nombre — texto libre,
  nunca un campo estructurado (sección 1.1). Si es `null`, el `CardHeader`
  simplemente no muestra segunda línea.
- **`LoanProgressRing`, componente nuevo** (sección 6): reemplaza el donut
  del mockup con la misma técnica SVG a mano ya usada por
  `CouponStatusRing.vue` (2 segmentos + texto centrado con el %) en vez de
  reusar `CategoryDonutChart` (que está pensado para N categorías con
  leyenda externa, no para un valor único con texto en el centro) — ver
  justificación completa en sección 6.
- **Fila "Recibido X de Y entre N personas"**: mini-resumen **por
  préstamo** de lo que sus propias `loan_debtors` acumulan — no confundir
  con la card global de la sección 4.2 (esa es agregada entre todos los
  préstamos, esta es acotada a este préstamo puntual). Se oculta si
  `debtorsCount === 0` (préstamo sin ninguna persona asociada todavía, caso
  válido — no todo préstamo reparte plata con terceros).
- Toda la Card es clickeable (mismo patrón que `cardsRanking`/hilos de
  deuda) → navega al detalle. Sin menú `⋮` en la lista — editar/borrar el
  préstamo vive en el detalle (sección 5.1), mismo criterio que Deudas.
- Orden dentro de cada tab: préstamos con `overdue` primero, luego
  `current`/`completed` por fecha de inicio desc (mismo criterio de "lo
  más urgente primero" ya usado en Deudas/Gastos fijos).

### 4.5 FAB "Nuevo préstamo"

Mismo patrón exacto que el resto de la app:

```html
<button
  type="button"
  aria-label="Nuevo préstamo"
  class="fixed bottom-6 right-4 z-10 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-elevated)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6 lg:right-8"
  style="margin-bottom: env(safe-area-inset-bottom)"
  @click="openAddLoanSheet"
>
  <Plus class="size-6" />
</button>
```

### 4.6 Estados de carga/vacío/error

- **Carga**: `Skeleton` en la card de resumen (si aplica) + 3 cards de
  préstamo — mismo criterio que el resto de la app.
- **Error**: mismo bloque `AlertCircle` + "No pudimos cargar tus
  préstamos" + `Reintentar`.
- **Vacío total** (usuario sin ningún préstamo creado): reemplaza todo el
  contenido bajo el header por un bloque centrado (ícono `Landmark`
  `size-12 text-muted-foreground`, "Todavía no registraste ningún
  préstamo.", subtexto "Llevá el control de tu préstamo en cuotas y de
  quién te debe una parte.", botón "Nuevo préstamo" → abre `LoanFormSheet`
  directo, sin ruta intermedia — mismo criterio que el vacío de Deudas/
  Gastos fijos).
- **Vacío por tab** (hay préstamos, pero ninguno en el tab activo): mensaje
  inline corto `text-sm text-muted-foreground text-center py-8` —
  `"No tenés préstamos activos."` / `"Todavía no completaste ningún
  préstamo."` según el tab.

---

## 5. `/prestamos/:id` — Detalle (tabs Resumen / Cuotas / Personas)

```html
<AppHeader :title="loan?.name ?? 'Préstamo'">
  <template #actions>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" aria-label="Más acciones">
          <EllipsisVertical class="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="openEditLoanSheet">
          <Pencil class="size-4" /> Editar préstamo
        </DropdownMenuItem>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <DropdownMenuItem variant="destructive" @select.prevent>
              <Trash2 class="size-4" /> Eliminar préstamo
            </DropdownMenuItem>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar "{{ loan?.name }}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borran el préstamo, su cronograma de cuotas y el registro de
                las personas asociadas, incluidos los pagos que les
                registraste. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction @click="deleteLoanAndGoBack">Eliminar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  </template>
</AppHeader>
```

- **Sin guard de conteo para "Eliminar préstamo"** — mismo criterio ya
  usado para borrar un hilo de deuda completo (`debts-ux.md` sección 6.5):
  un préstamo no es referenciado por ningún otro recurso fuera de su
  propia jerarquía (cuotas, personas, pagos son todos hijos propios en
  cascada) y, a diferencia de Gastos fijos, acá **tampoco** hay ningún
  gasto real externo que sobreviva al borrado (aislamiento total, intro) —
  borrar un préstamo es, en términos de impacto, equivalente a borrar un
  gasto propio del usuario, no un recurso de clasificación compartido. El
  copy del `AlertDialog` sí aclara explícitamente qué se pierde (a
  diferencia de Deudas, acá **si** hay algo no trivial que perder: el
  ledger de pagos recibidos de cada persona, que no vive en ningún otro
  lado de la app).

### 5.1 `Tabs` Resumen / Cuotas / Personas

```html
<Tabs v-model="activeTab" default-value="summary">
  <TabsList class="grid w-full grid-cols-3">
    <TabsTrigger value="summary">Resumen</TabsTrigger>
    <TabsTrigger value="installments">Cuotas</TabsTrigger>
    <TabsTrigger value="people">Personas</TabsTrigger>
  </TabsList>

  <TabsContent value="summary"><!-- sección 5.2 --></TabsContent>
  <TabsContent value="installments"><!-- sección 5.3 --></TabsContent>
  <TabsContent value="people"><!-- sección 5.4 --></TabsContent>
</Tabs>
```

Default: "Resumen" — primera pregunta real al entrar al detalle ("¿cómo
viene este préstamo?"), antes de bajar al detalle operativo de cuotas o
personas.

### 5.2 Tab "Resumen"

```html
<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <LoanStatusBadge :status="loanBadgeStatus(loan)" />
  </div>

  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Card size="sm">
      <CardHeader class="pb-1"><CardDescription>Total</CardDescription></CardHeader>
      <div class="px-4 pb-3"><p class="font-semibold tabular-nums">${{ formatAmount(loan.totalAmount) }}</p></div>
    </Card>
    <Card size="sm">
      <CardHeader class="pb-1"><CardDescription>Cuota mensual</CardDescription></CardHeader>
      <div class="px-4 pb-3"><p class="font-semibold tabular-nums">${{ formatAmount(loan.monthlyPayment) }}</p></div>
    </Card>
    <Card size="sm">
      <CardHeader class="pb-1"><CardDescription>Inicio</CardDescription></CardHeader>
      <div class="px-4 pb-3"><p class="font-semibold">{{ formatDateChip(loan.startDate) }}</p></div>
    </Card>
    <Card size="sm">
      <CardHeader class="pb-1"><CardDescription>Fin estimado</CardDescription></CardHeader>
      <div class="px-4 pb-3"><p class="font-semibold">{{ formatDateChip(loan.estimatedEndDate) }}</p></div>
    </Card>
  </div>

  <Card>
    <CardHeader class="pb-2"><CardTitle class="text-base font-semibold">Progreso</CardTitle></CardHeader>
    <div class="flex flex-col gap-2 px-6 pb-4">
      <div class="h-2 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-success transition-[width]"
          :style="{ width: `${loan.percentComplete}%` }"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        {{ loan.paidCount }} de {{ loan.totalCount }} cuotas pagadas ({{ Math.round(loan.percentComplete) }}%)
      </p>
    </div>
  </Card>

  <Card v-if="!loan.isCompleted">
    <CardHeader class="pb-2"><CardTitle class="text-base font-semibold">Próxima cuota</CardTitle></CardHeader>
    <div class="flex items-center justify-between px-6 pb-4">
      <div class="flex flex-col gap-0.5">
        <p class="text-sm font-medium">Cuota {{ loan.nextInstallmentNumber }} de {{ loan.totalCount }}</p>
        <p class="text-xs text-muted-foreground">{{ formatDateChip(loan.nextInstallmentDueDate) }}</p>
      </div>
      <div class="flex flex-col items-end gap-0.5">
        <p class="text-lg font-semibold tabular-nums">${{ formatAmount(loan.nextInstallmentAmount) }}</p>
        <p class="text-xs" :class="loan.daysRemaining < 0 ? 'text-destructive' : 'text-muted-foreground'">
          {{ loan.daysRemaining >= 0 ? `Faltan ${loan.daysRemaining} días` : `Vencida hace ${Math.abs(loan.daysRemaining)} días` }}
        </p>
      </div>
    </div>
  </Card>

  <Card v-if="loan.debtorsCount > 0">
    <CardHeader class="flex-row items-center justify-between pb-2">
      <CardTitle class="text-base font-semibold">Personas que me deben</CardTitle>
      <Button variant="ghost" size="sm" @click="activeTab = 'people'">Ver todas</Button>
    </CardHeader>
    <div class="flex flex-col">
      <template v-for="(debtor, idx) in loan.debtorsPreview" :key="debtor.id">
        <Separator v-if="idx > 0" />
        <div class="flex items-center gap-3 px-6 py-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full"
            :style="{ backgroundColor: debtor.person.color ?? 'hsl(var(--muted))' }"
          >
            <User class="size-4" :style="{ color: readableTextColor(debtor.person.color) }" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <p class="truncate text-sm font-medium">{{ debtor.person.name }}</p>
            <p class="text-xs text-muted-foreground">${{ formatAmount(debtor.balanceRemaining) }} pendiente</p>
          </div>
        </div>
      </template>
    </div>
  </Card>
</div>
```

- `loan.daysRemaining = diffInDays(parseDateOnly(loan.nextInstallmentDueDate), today)` —
  cálculo trivial de diferencia de días, mismo tipo de derivación cliente
  ya usado en `matchClock.ts`. Negativo cuando ya venció (redundante con
  `has_overdue`, pero expresado de forma legible en la card puntual, mismo
  criterio de "nunca solo un booleano, siempre el número real al lado").
- "Próxima cuota" se oculta por completo si `loan.isCompleted` — no hay
  próxima cuota que mostrar en un préstamo ya saldado.
- Preview de "Personas que me deben": hasta 3 filas (`debtorsPreview`),
  "Ver todas" navega al tab Personas (cambia `activeTab`, no navega de
  ruta — mismo `Tabs` de la misma vista). Se oculta la Card completa si
  `debtorsCount === 0`.

### 5.3 Tab "Cuotas"

```html
<div class="flex flex-col">
  <template v-for="(installment, idx) in loan.installments" :key="installment.id">
    <Separator v-if="idx > 0" />
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="toggleInstallment(installment)"
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium tabular-nums">
        {{ installment.installmentNumber }}
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="text-sm font-medium">{{ monthYearLabel(installment.dueDate) }}</p>
        <p class="text-xs text-muted-foreground">{{ formatDateChip(installment.dueDate) }}</p>
      </div>
      <p class="shrink-0 text-sm font-semibold tabular-nums">${{ formatAmount(installment.amount) }}</p>
      <LoanInstallmentStatusBadge :status="installmentDisplayStatus(installment)" />
    </button>
  </template>
</div>
```

- **Tap en la fila entera toggle pagada/no pagada** (`toggleInstallment`),
  tal como pide el encargo ("tap para marcar pagada/no pagada") — sin menú
  `⋮`, sin Sheet: es una acción binaria, reversible con un segundo tap
  (mismo criterio que "Pausar/Reanudar" de Gastos fijos, sección 1.6 de
  este documento). Mutación optimista: `status` flip inmediato
  (`'pending' → 'paid'` setea `paid_at = today`; `'paid' → 'pending'` limpia
  `paid_at = null`), confirmación en background, rollback + `toast.error`
  si falla.
- `installmentDisplayStatus(installment)`: `'paid'` si `status === 'paid'`;
  `'overdue'` si `status === 'pending' && dueDate < today`; `'pending'` en
  cualquier otro caso — mismo tipo de derivación cliente trivial ya
  aceptada para "días restantes" arriba (acá es por cuota individual, no
  agregado por préstamo — `loan_progress.has_overdue` de la sección 1.2
  responde "¿tiene ALGUNA atrasada", esto responde "¿es ESTA la
  atrasada").
- Sin paginación: cardinalidad acotada por diseño (`term_months`, sección
  1.3).
- **Botón "+ Registrar pago" no aplica acá** — ese verbo es exclusivo del
  tab Personas (sección 5.4); acá el usuario es quien le debe al banco, no
  quien cobra, así que la única acción posible es marcar su propia cuota
  como pagada.

### 5.4 Tab "Personas"

```html
<div class="flex flex-col gap-3">
  <div class="flex flex-col">
    <template v-for="(debtor, idx) in loan.debtors" :key="debtor.id">
      <Separator v-if="idx > 0" />
      <div class="flex flex-col gap-2 px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-full"
              :style="{ backgroundColor: debtor.person.color ?? 'hsl(var(--muted))' }"
            >
              <User class="size-4" :style="{ color: readableTextColor(debtor.person.color) }" />
            </span>
            <div class="flex min-w-0 flex-col">
              <p class="truncate text-sm font-medium">{{ debtor.person.name }}</p>
              <p class="text-xs text-muted-foreground">
                Le corresponden ${{ formatAmount(debtor.amountAssigned) }}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" aria-label="Más acciones">
                <EllipsisVertical class="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openRegisterPaymentSheet(debtor)">
                <CirclePlus class="size-4" /> Registrar pago recibido
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <DropdownMenuItem
                    variant="destructive"
                    :disabled="debtor.paymentsCount > 0"
                    @select.prevent
                  >
                    <Trash2 class="size-4" /> Quitar del préstamo
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Quitar a "{{ debtor.person.name }}" de este préstamo?</AlertDialogTitle>
                    <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction @click="removeDebtor(debtor.id)">Quitar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-success transition-[width]"
            :style="{ width: `${Math.min((debtor.amountReceived / debtor.amountAssigned) * 100, 100)}%` }"
          />
        </div>
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>Recibido ${{ formatAmount(debtor.amountReceived) }} de ${{ formatAmount(debtor.amountAssigned) }}</span>
          <span v-if="debtor.lastPaymentDate">Último pago: {{ formatDateChip(debtor.lastPaymentDate) }}</span>
          <span v-else>Sin pagos todavía</span>
        </div>
      </div>
    </template>
  </div>

  <Button variant="outline" class="w-full" @click="openAddDebtorSheet">
    <Plus class="size-4" /> Agregar persona
  </Button>
</div>
```

- **"Próximo pago esperado" se omite por completo** (sección 1.4) — no hay
  ninguna fila/placeholder para ese dato, ni siquiera "N/A": el diseño
  simplemente no incluye ese campo, mismo criterio de "no mostrar
  información que no existe" ya usado en varias partes de la app (ej. el
  subtítulo de tipo de cuenta que se omitió por completo en
  `AccountDetailView`, `CLAUDE.md`).
- **Guard "Quitar del préstamo"**: deshabilitado si `debtor.paymentsCount
  >= 1` (conteo dedicado, `loan_debtor_payments(count)` por
  `loan_debtor`, mismo mecanismo de siempre) — proteger el ledger de pagos
  ya recibidos de esa persona, que se perdería en cascada si se permitiera
  quitarla sin más. Sin excepción: a diferencia del borrado del préstamo
  completo (sección 5, que sí explica qué se pierde y lo permite), acá se
  prefiere bloquear directamente porque la única forma de "arreglar" un
  error de asignación con pagos ya recibidos es editar el monto, no borrar
  la relación entera perdiendo su historial.
- **Botón "+ Agregar persona"** (no un FAB — esta es una sub-sección
  dentro de un tab, no una pantalla de listado propia): abre
  `LoanDebtorFormSheet` (sección 6.3).
- El total de `amountAssigned` entre todas las personas de un préstamo
  **no está forzado a sumar `total_amount` del préstamo** — es
  perfectamente válido repartir solo una parte, o ninguna. Si la suma
  excediera `total_amount`, no hay ningún bloqueo (mismo criterio de "no
  inventar una restricción que nadie pidió" ya usado para el sobrepago de
  Deudas, `debts-ux.md` sección 1.1) — a lo sumo, a criterio de
  `vue-frontend-expert`, un aviso inline no bloqueante en
  `LoanDebtorFormSheet` si el nuevo total superaría el monto del préstamo
  (sección 6.3).

### 5.5 Estados de carga/vacío/error del detalle

- **Carga**: `Skeleton` en el header custom + las 3 secciones de tab —
  mismo criterio de siempre.
- **Error / préstamo inexistente o ajeno** (deep-link a un id que no
  pertenece al usuario o fue borrado): mismo bloque `AlertCircle` +
  "No pudimos cargar este préstamo" + `Reintentar` — RLS ya garantiza que
  un `select` a un préstamo ajeno devuelve vacío, no un error 403 (mismo
  comportamiento ya verificado en `AccountDetailView`).
- **Tab Cuotas vacío**: no debería ocurrir en la práctica (`create_loan`
  siempre genera `term_months >= 1` filas), pero si sucediera, mensaje
  inline `"No hay cuotas generadas para este préstamo."` sin acción
  (estado defensivo, no un flujo real esperado).
- **Tab Personas vacío**: `"Todavía no le asignaste este préstamo a
  ninguna persona."`, con el mismo botón "+ Agregar persona" ya visible
  (sección 5.4) — no un bloque centrado de pantalla completa como los
  vacíos de nivel-vista, es un vacío de sub-sección dentro de un tab.

---

## 6. Componente nuevo — `LoanProgressRing.vue`

**No se reusa `CategoryDonutChart.vue`** (pensado para N categorías con
leyenda externa obligatoria, SVG `aria-hidden`) **ni se instala
`Progress`** (evaluado y descartado, sección 7) — se define un componente
chico nuevo, hermano de `CouponStatusRing.vue` (`live-coupons-ux.md`
sección 6.2), con la misma técnica exacta (SVG a mano, `stroke-dasharray`/
`stroke-dashoffset`, colores vía `hsl(var(--token))`) pero para **2
segmentos con texto centrado del porcentaje**, no 4 segmentos con "X/Y":

```ts
// src/components/charts/LoanProgressRing.vue — contrato de props
interface Props {
  /** 0-100, ya redondeado por el consumidor si hace falta. */
  percent: number
  size?: number // default 72 (px), controla viewBox/tamaño renderizado
}
```

- 2 segmentos: `success` (pagado, `percent`) + `muted-foreground/30` o
  equivalente (falta, `100 - percent`) — mismo criterio de paleta de
  estado que `CouponStatusRing` (no categórica, tokens ya reservados).
- Texto centrado: `{{ Math.round(percent) }}%` en tinta (`fill-foreground`,
  `font-bold tabular-nums`), igual criterio a11y que `CouponStatusRing`
  ("el dato clave no depende del color") — `role="img"` +
  `:aria-label="`${Math.round(percent)}% completado`"`.
- Por qué un componente nuevo y no una tercera opción genérica que sirva
  para ambos casos (categorías N-arias y 2-segmentos con texto): mismo
  argumento ya usado por `debts-ux.md` sección 3.8 para no forzar
  `TrendAreaChart` a servir dos propósitos con contratos de props
  distintos — `CategoryDonutChart` no tiene texto central por diseño
  (la leyenda vive afuera, en HTML, sección 5.2 de `dashboard-redesign-ux.md`)
  y agregarle uno opcional solo para este caso puntual sería una prop
  condicional más en un componente ya usado por 3 dominios distintos
  (categorías, tarjetas, personas de tarjeta, gastos fijos) — más simple
  mantener dos componentes chicos de propósito único que uno genérico con
  ramas.

---

## 7. Componentes shadcn-vue: reusar / instalar

**Nada nuevo que instalar.** Revisado contra `src/components/ui/` (alert,
alert-dialog, badge, button, card, dropdown-menu, input, label, select,
separator, sheet, skeleton, sonner, switch, tabs, textarea) — esta feature
usa exclusivamente: `Card`, `Badge`, `Button`, `Input`, `Label`, `Select`,
`Sheet`, `AlertDialog`, `DropdownMenu`, `Separator`, `Skeleton`, `Tabs`
(instalado desde Deudas).

**`Progress` — evaluado y descartado, otra vez**: `design-system.md`
sección 4 lo dejó anotado como "Fase 2 pendiente" y el encargo sugiere
revisarlo, pero el proyecto **ya resolvió esta misma necesidad dos veces**
sin instalarlo — la barra de "límite sugerido" de `CardDetailView`
(`credit-cards-ux.md` sección 4.2) y la barra de "Gastos registrados X de
Y" de `FixedExpensesView` (`fixed-expenses-ux.md` sección 3.3), ambas con
el mismo patrón hand-rolled `h-2 overflow-hidden rounded-full bg-muted` +
relleno con `width` dinámico. Instalar `Progress` acá sería introducir un
segundo mecanismo para el mismo problema visual que el proyecto ya
resolvió de forma consistente dos veces — se reusa el mismo patrón de
`div`s (secciones 5.2 y 5.4), no el componente de Reka UI. Si a futuro
aparece un caso que necesite genuinamente las capacidades de `Progress`
(ej. `indeterminate`), instalar en ese momento, no antes.

Componentes de proyecto **nuevos** a crear:

- `src/views/LoansListView.vue` (`/prestamos`).
- `src/views/LoanDetailView.vue` (`/prestamos/:id`).
- `src/components/LoanFormSheet.vue` (alta/edición de préstamo, sección
  8.1).
- `src/components/LoanDebtorFormSheet.vue` (agregar persona a un préstamo,
  sección 8.2).
- `src/components/LoanDebtorPaymentFormSheet.vue` (registrar pago recibido,
  sección 8.3).
- `src/components/LoanStatusBadge.vue` (3 estados, sección 9).
- `src/components/LoanInstallmentStatusBadge.vue` (3 estados, sección 9).
- `src/components/charts/LoanProgressRing.vue` (sección 6).

---

## 8. Sheets

### 8.1 Alta/edición de préstamo — `LoanFormSheet.vue`

Mismo patrón estructural de siempre (`Sheet side="bottom"`,
`SheetHeader`/`SheetTitle`/`SheetDescription`, body `flex flex-col gap-4
px-4`, footer con "Cancelar" + botón ancho).

```html
<SheetHeader>
  <SheetTitle>{{ isEditing ? 'Editar préstamo' : 'Nuevo préstamo' }}</SheetTitle>
  <SheetDescription v-if="!isEditing">
    Registrá tu préstamo para llevar el control de las cuotas. No afecta el
    saldo de tus cuentas ni tus transacciones.
  </SheetDescription>
</SheetHeader>
```

**Campos, en orden**:

1. **Nombre** (`Input`, requerido, `maxlength="60"`) — ej. "Préstamo
   Personal".
2. **Descripción** (`Input`, opcional, `maxlength="100"`) — copy de ayuda:
   `"Por ejemplo, "Descuento por nómina" o el banco que lo otorgó."` — deja
   claro que es texto libre, no un campo con opciones fijas.
3. **Monto total** (`Input type="number" inputmode="decimal"`, requerido,
   `> 0`).
4. **Cuota mensual** (`Input type="number" inputmode="decimal"`,
   requerido, `> 0`) — sin validación cruzada contra Monto total/Plazo (el
   usuario puede conocer los 3 datos de su propio resumen de préstamo sin
   que necesariamente sean matemáticamente exactos entre sí sobre el
   número de cuotas — mismo criterio de "no inventar una regla que el
   dominio real no pide": un préstamo real puede tener una cuota
   ligeramente distinta al resultado de dividir por el plazo, por
   redondeos del propio banco. Las `loan_installments` generadas usan la
   fórmula de la sección 1.1 con la última cuota absorbiendo el resto, sin
   depender de que `monthly_installment_amount` coincida exacto — ese campo es
   informativo/de referencia para el usuario, el cronograma real se arma
   desde `total_amount`/`term_months`).
5. **Fecha de inicio** (`<input type="date">` nativo, requerido) — a
   diferencia del resto de la app, **sí admite fechas pasadas sin límite**
   (un préstamo pudo haber empezado hace tiempo, el usuario lo está
   cargando recién ahora) — la única restricción es no futura
   (`isFutureDate`, ya existente).
6. **Plazo en meses** (`Input type="number" inputmode="numeric" min="1"`,
   requerido) — copy de ayuda: `"Cantidad total de cuotas del préstamo."`
   Nota siempre visible: `"Se generan todas las cuotas del cronograma al
   guardar."` — anticipa que esto no es una plantilla que se completa mes
   a mes (a diferencia de Gastos fijos), es un cronograma cerrado desde el
   alta.
7. Botón footer: `Guardar préstamo` (alta) / `Guardar cambios` (edición).

**Alta: no optimista** (sección 1.5, RPC atómica). **Edición: solo de los
campos descriptivos** (`name`, `description`, `monthly_installment_amount`) — **no se
permite editar `total_amount`/`start_date`/`term_months`** una vez creado
el préstamo, porque esos 3 valores ya generaron un cronograma real de
`loan_installments` (sección 1.1); cambiarlos después dejaría cuotas ya
pagadas/pendientes inconsistentes con un nuevo total/plazo sin una
regla clara de qué hacer con las que ya existen. Si el usuario se
equivocó en esos 3 campos, la vía es borrar el préstamo y cargarlo de
nuevo (mismo criterio de "no inventar una operación de re-cálculo
compleja para un caso de error de carga, cuando borrar y recrear ya
resuelve el problema sin ambigüedad"). El Sheet de edición muestra los 3
campos bloqueados (`disabled`, con el valor ya guardado visible) en vez de
ocultarlos, para que el usuario entienda que existen pero no son
editables — mismo criterio de transparencia que otros campos
`disabled`-con-motivo ya usados en la app (ej. "Destino" deshabilitado
hasta elegir "Origen" en Transferencias).

### 8.2 Agregar persona a un préstamo — `LoanDebtorFormSheet.vue`

```html
<SheetHeader>
  <SheetTitle>Agregar persona</SheetTitle>
  <SheetDescription>Elegí quién te debe una parte de este préstamo.</SheetDescription>
</SheetHeader>
```

**Campos**:

1. **Persona** (`Select`, requerido) — opciones: `debtPeopleStore.people`
   **excluyendo** a quienes ya son `loan_debtors` de este préstamo (mismo
   mecanismo de exclusión ya usado por "Cuenta de destino" en
   Transferencias, `account-transfers-ux.md` sección 4.2) — evita el
   `unique(loan_id, debt_person_id)` del backend (sección 1.1) sin
   necesitar mostrar un error de submit para el caso más común de
   intentarlo. Atajo siempre visible debajo del `Select`: `"+ Agregar
   persona nueva"` → navega a `{ name: 'debt-people', query: { new: '1' } }`
   (mismo patrón exacto que el atajo de `DebtFormSheet`, `debts-ux.md`
   sección 4.4 — mismo trade-off aceptado de perder el progreso de este
   Sheet).
2. **Monto que le corresponde** (`Input type="number" inputmode="decimal"`,
   requerido, `> 0`). Aviso inline, no bloqueante, si
   `sumaExistente + nuevoMonto > loan.totalAmount`:
   `"Esto supera el monto total del préstamo (${{ formatAmount(loan.totalAmount) }})."`
   en `text-xs text-warning` — informativo, no impide guardar (sección
   5.4 ya aclaró que no hay ninguna restricción dura acá).
3. Botón footer: `Agregar persona`.

**Guardado: optimista** (sección 1.7 — insert de una sola tabla, sin
dependencia atómica con otra escritura).

### 8.3 Registrar pago recibido — `LoanDebtorPaymentFormSheet.vue`

```html
<SheetHeader>
  <SheetTitle>Registrar pago recibido</SheetTitle>
  <SheetDescription>{{ debtor?.person.name }} · este préstamo</SheetDescription>
</SheetHeader>
```

**Campos**:

1. **Monto** (`Input type="number" inputmode="decimal"`, requerido, `> 0`)
   — sin prefill (a diferencia de "Marcar como pagado" de Gastos fijos,
   acá no hay un monto de referencia fijo por período: la persona puede
   pagar cualquier monto parcial en cualquier momento).
2. **Fecha** (`<input type="date">` nativo, default hoy, no futura).
3. Botón footer: `Registrar pago`.

**Guardado: optimista** (sección 1.7), ajusta `loan_debtor_balances` en
cache local vía el mismo mecanismo de "delta seguro" de `debtsStore`. Sin
guard de "no superar el saldo pendiente" — mismo criterio de sobrepago ya
aceptado en Deudas (`debts-ux.md`, sección de "Caso borde señalado a
propósito, sin resolver"): un pago mayor al saldo pendiente de esa persona
simplemente deja `balance_remaining` en negativo, sin alarmar con un tercer
estado que nadie pidió.

---

## 9. Estados — badges con ícono + texto, nunca solo color

Mismo criterio CVD ya aplicado en Gastos fijos/cupones (`fixed-expenses-ux.md`
sección 6, `live-coupons-ux.md` sección 3.1): codificación redundante, el
color nunca es la única señal.

### 9.1 `LoanStatusBadge` (préstamo completo — sección 2.2)

| Estado | Ícono | Color | Texto |
|---|---|---|---|
| `current` | `Clock` | `muted-foreground` | "Al día" |
| `overdue` | `AlertCircle` | `destructive` | "Atrasado" |
| `completed` | `CircleCheck` | `success` | "Completado" |

```html
<script setup lang="ts">
import { AlertCircle, CircleCheck, Clock } from '@lucide/vue'

const STATUS_CONFIG = {
  current:   { icon: Clock,       class: 'text-muted-foreground', label: 'Al día' },
  overdue:   { icon: AlertCircle, class: 'text-destructive',       label: 'Atrasado' },
  completed: { icon: CircleCheck, class: 'text-success',           label: 'Completado' },
} as const
</script>

<template>
  <Badge variant="outline" class="gap-1 text-[10px]" :class="STATUS_CONFIG[status].class">
    <component :is="STATUS_CONFIG[status].icon" class="size-3" />
    {{ STATUS_CONFIG[status].label }}
  </Badge>
</template>
```

`current` usa `muted-foreground`, no `success` — mismo argumento ya usado
en Gastos fijos sección 3.3: estar al día con un cronograma en curso es el
estado esperado, no un logro (el logro real, "Completado", ya tiene su
propio color reservado).

### 9.2 `LoanInstallmentStatusBadge` (cuota individual — sección 5.3)

| Estado | Ícono | Color | Texto |
|---|---|---|---|
| `pending` | `Clock` | `muted-foreground` | "Pendiente" |
| `overdue` | `AlertCircle` | `destructive` | "Atrasada" |
| `paid` | `CircleCheck` | `success` | "Pagada" |

Mismo componente de configuración que 9.1 pero con copy propio de cuota
(género femenino, "cuota" — "Atrasada"/"Pagada", no "Atrasado"/"Pagado").
Ambos badges comparten los mismos 3 íconos por consistencia de vocabulario
visual (Clock/AlertCircle/CircleCheck ya establecidos por Gastos fijos),
aplicados a dos granularidades distintas del mismo dominio (el préstamo
entero vs. una cuota puntual).

---

## 10. Paleta e íconos

**Sin paleta nueva.** Esta feature no introduce ningún color de categoría
ni de cuenta — reusa exclusivamente los tokens de estado ya existentes
(`success`/`destructive`/`muted-foreground`) para los badges (sección 9) y
el ring de progreso (sección 6), y el color ya elegido por el usuario en
`debt_people.color` (`COLOR_SWATCHES`, ya sembrado, sin cambios) para el
círculo de identidad de cada persona en las secciones 5.2/5.4 — mismo
componente visual (`size-9 rounded-full` + ícono `User`) ya usado por
Deudas para sus propias contrapartes (`debts-ux.md` sección 3.5).

**Íconos nuevos usados por esta feature** (todos confirmados en
`@lucide/vue`, nada que instalar):

- `Landmark` (ítem de drawer + estado vacío de la lista, sección 11) —
  evoca una institución financiera formal, distinto de `HandCoins`
  (préstamo informal 1:1 entre personas, ya reservado para Deudas) y de
  `CalendarSync` (gasto recurrente genérico, ya reservado para Gastos
  fijos). Ya está confirmado disponible porque `src/lib/accountIcons.ts`
  lo usa como opción de ícono de cuenta — se reusa el mismo glifo en un
  contexto distinto (nav vs. selector de ícono de cuenta), sin colisión
  real porque nunca aparecen lado a lado en la misma región de la UI.
- `Users` (mini-resumen de personas en la card de préstamo, sección 4.4).
- `User` (círculo de identidad de una persona individual, secciones 5.2/
  5.4 — mismo ícono ya usado por Deudas para el mismo propósito).
- `CirclePlus` (ítem de menú "Registrar pago recibido", sección 5.4).
- `Clock` / `AlertCircle` / `CircleCheck` (badges de estado, sección 9 —
  ya usados por Gastos fijos, mismo vocabulario reusado sin cambios).
- `Pencil` / `Trash2` / `EllipsisVertical` / `Plus` (menús/FAB, ya
  establecidos en toda la app).

---

## 11. Ítem de drawer

**Posición 7 de 13**, ícono `Landmark`. Se inserta **inmediatamente
después de "Gastos fijos"**, manteniendo agrupados los seis ítems que son
"dominios de movimientos de dinero" (Transacciones/Tarjetas/Cuentas/
Transferencias/Deudas/Gastos fijos/**Préstamos**) antes del primer ítem
que no pertenece a ese grupo ("Partidos en vivo", utilidad personal sin
relación con el dominio financiero — `CLAUDE.md`). Encaja ahí y no antes
de "Deudas": aunque ambas features tratan con personas que deben/deben
plata, Préstamos es conceptualmente más cercano a "un compromiso con
cronograma fijo" (como Gastos fijos, que también tiene un calendario mes a
mes) que a "un registro libre sin cronograma" (Deudas) — agruparlo
inmediatamente después de Gastos fijos, el ítem con el que más comparte
estructura (cronograma con fechas fijas, estados derivados por fecha), es
más consistente que ponerlo entre Deudas y Gastos fijos solo por similitud
superficial de "personas que deben plata".

Orden final del drawer (13 ítems):

1. Inicio (`Home`)
2. Transacciones (`ArrowLeftRight`)
3. Tarjetas de crédito (`CreditCard`)
4. Cuentas (`Wallet`)
5. Transferencias (`ArrowRightLeft`)
6. Deudas (`HandCoins`)
7. Gastos fijos (`CalendarSync`)
8. **Préstamos (`Landmark`) — nuevo**
9. Partidos en vivo (`Goal`)
10. Categorías (`Tag`)
11. Estadísticas (`ChartPie`)
12. Reportes (`FileText`)
13. Ajustes (`Settings`)

```html
<button
  type="button"
  class="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  :class="isActive('loans') ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'"
  :aria-current="isActive('loans') ? 'page' : undefined"
  @click="navigateFromDrawer('loans')"
>
  <Landmark class="size-5 shrink-0" />
  Préstamos
</button>
```

Se inserta en `src/components/NavigationDrawer.vue`, entre el botón de
"Gastos fijos" (ya existente) y el de "Partidos en vivo" (ya existente) —
agregar `'loans'` al tipo `NavRouteName` y el `import` de `Landmark` desde
`@lucide/vue`. Único cambio estructural a ese archivo.

---

## 12. Accesibilidad

Todo lo ya establecido en `design-system.md` aplica sin excepción — se
resaltan los puntos específicos de esta feature:

- **Toda la Card de préstamo en la lista es clickeable** (sección 4.4):
  `role="button"`/`tabindex="0"`/`@keydown.enter`, mismo patrón ya
  auditado en `cardsRanking`/filas de `AccountsView`.
- **Tap para marcar cuota pagada/pendiente** (sección 5.3): la fila entera
  es un `<button>` real (no un `<div>` con `@click`), foco visible de
  serie, sin necesitar `role`/`tabindex` manual.
- **`LoanProgressRing`/badges**: `role="img"` + `aria-label` con el dato
  exacto en texto (nunca solo el gráfico/color) — mismo criterio a11y ya
  aplicado a `CouponStatusRing`/`TrendAreaChart`/`CategoryDonutChart`.
- **Inputs numéricos** (Monto, Cuota mensual, Plazo): `text-base`/
  `inputmode` correcto, mismo piso mobile de siempre.
- **Guard "Quitar del préstamo"** (sección 5.4): `disabled` de antemano
  (conteo ya cargado con la pantalla), no reactivo al abrir el menú —
  mismo criterio de siempre.
- **`AlertDialog`s de borrado** (préstamo completo, persona de un
  préstamo): mismo patrón ya auditado en el resto de la app (foco
  atrapado, `Escape` cierra, foco vuelve al trigger).
- **Select de "Persona" con exclusión dinámica** (sección 8.2): mismo
  patrón ya auditado en "Cuenta de destino" de Transferencias
  (`account-transfers-ux.md` sección 4.2) — placeholder explica el estado,
  no hace falta mensaje de error para el caso ya evitado de antemano por
  la UI.

---

## 13. Qué se excluye explícitamente (no agregar aunque la referencia lo insinúe)

Mismo criterio de exclusión ya aplicado en el resto de los docs de
features — confirmado punto por punto contra lo que pidió el encargo:

- **Bottom tab bar**: nunca, TipApp usa exclusivamente el drawer lateral
  (`NavigationDrawer`) en todos los anchos de pantalla.
- **Botón "Volver" en cualquier header**: regla dura de
  `design-system.md` sección 6, sin excepción para esta feature.
- **Campos no mencionados en el encargo**: "cantidad objetivo", etiquetas
  libres del préstamo, "beneficiario", "garantía" — ninguno tiene
  equivalente de dominio claro ni fue pedido, no se inventan.
- **Badges de estado más allá de los 3 ya justificados** (sección 2.2):
  no se agrega, por ejemplo, un cuarto estado "Por vencer" (cuota que
  vence en los próximos N días) — el encargo no lo pidió y la card
  "Próxima cuota" (sección 5.2) ya cubre esa necesidad con el número real
  de días restantes, sin necesitar un badge extra.
- **Plantillas de préstamo** (montos/plazos predefinidos para elegir
  rápido): no mencionado en el encargo, no se agrega.
- **Cards de upsell/premium**: TipApp no tiene ese concepto en ningún
  lado, no se introduce acá.
- **Ninguna fila sintética en Transacciones/Inicio** (a diferencia de
  Transferencias, `account-transfers-ux.md` sección 6.4): el punto 4 del
  encargo es explícito y sin matices ("sin ningún impacto... en
  Transacciones") — a diferencia del monto de una transferencia (que sí
  tiene 2 ítems visuales sintéticos para no dejar rastro invisible de un
  ajuste de saldo real), acá **no hay ningún ajuste de saldo real que
  explicar**: ni las cuotas del préstamo ni los pagos recibidos de una
  persona tocan ninguna cuenta, así que no hay ninguna "invisibilidad" que
  compensar con un ítem sintético. Silencio total y consistente con el
  punto 4 del encargo, sin necesidad de reabrir esa discusión.
- **Ninguna edición de `total_amount`/`start_date`/`term_months`** tras la
  creación (sección 8.1) — ya justificado ahí, no se reabre.

---

## 14. Resumen para `vue-frontend-expert` / `supabase-backend-expert`

- **Rutas**: `/prestamos` (`loans`, lista con tabs Activos/Historial) y
  `/prestamos/:id` (`loan-detail`, tabs Resumen/Cuotas/Personas) — 2
  rutas, sin ruta de gestión de personas propia (se reusa `/deudas/personas`
  ya existente para identidad).
- **Ambigüedad 1 resuelta**: "Total que debo recibir" es un agregado
  **global** (todos los préstamos, activos + Historial) en la lista —
  mismo criterio ya usado por el dashboard de Deudas.
- **Ambigüedad 2 resuelta**: sí existe "Atrasado" (más "Completado" para
  Historial) — 3 estados en total, derivados server-side vía
  `loan_progress.has_overdue`/`is_completed` (booleanos SQL, no cliente).
- **Componentes nuevos**: `LoansListView.vue`, `LoanDetailView.vue`,
  `LoanFormSheet.vue`, `LoanDebtorFormSheet.vue`,
  `LoanDebtorPaymentFormSheet.vue`, `LoanStatusBadge.vue`,
  `LoanInstallmentStatusBadge.vue`, `charts/LoanProgressRing.vue`. **Nada
  de shadcn-vue nuevo que instalar** (`Tabs` ya estaba desde Deudas,
  `Progress` se evalúa y descarta otra vez, mismo criterio que Tarjetas/
  Gastos fijos).
- **Posición de drawer**: 7 de 13 (índice 8 en la lista 1-based de arriba,
  ver tabla completa sección 11), ícono `Landmark`, inmediatamente después
  de "Gastos fijos".
- **Para backend**: confirmar nombres reales de `loans`/
  `loan_installments`/`loan_debtors`/`loan_debtor_payments` y de las 2
  vistas (`loan_progress`/`loan_debtor_balances`, sección 1.2); la RPC
  `create_loan` (sección 1.5); la recomendación de guardar `due_date` real
  por cuota en vez de que el frontend la derive (sección 1.1); los 2
  conteos dedicados (`loan_debtor_payments(count)` por `loan_debtor` para
  el guard de la sección 5.4, y el `unique(loan_id, debt_person_id)`
  recomendado). Ninguna tabla de esta feature toca `expenses`/`incomes`/
  `account_balances` — aislamiento total confirmado en todo el documento.
