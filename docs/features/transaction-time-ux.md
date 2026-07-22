# Hora en Gastos e Ingresos — UX

Alcance acotado: agrega un campo de **hora**, opcional y puramente
informativo, al alta/edición de **Gastos e Ingresos** únicamente.

**Fuera de alcance, explícito**: `AccountTransferFormSheet.vue` (Transferencias)
y `DebtMovementFormSheet.vue` (Deudas) no llevan campo de hora en esta
iteración — ni el Sheet ni ningún listado propio de esas dos features se
tocan. `account_transfers`/`debt_movements` no reciben ninguna columna nueva.

Contrato de backend asumido (en curso, `supabase-backend-expert`):
`expenses.expense_time time null`, `incomes.income_time time null` — la hora
nunca reemplaza a `expense_date`/`income_date` (`date` puro) como fuente de
verdad de nada ya existente (agrupación por día, `isMonthSafeToShow`, saldo
corrido por fila, filtros de rango). Filas viejas quedan `null`, sin backfill.

## 1. Ubicación en el Sheet

`TransactionFormSheet.vue`, panel superior coloreado (sección 14.4 de
`accounts-income-ux.md`): hoy la píldora de fecha vive sola, alineada a la
derecha (`ml-auto w-fit`, línea ~469-488). Pasa a ser una **fila de 2
píldoras** del mismo tipo, alineada igual a la derecha:

```
<div class="ml-auto flex w-fit items-center gap-2">
  <!-- píldora Fecha (sin cambios) -->
  <!-- píldora Hora (nueva) -->
</div>
```

Orden: **Fecha primero, Hora después** (lectura natural "cuándo → a qué
hora"), ambas con el mismo tratamiento visual (`rgba` de fondo según
`panelIsDark`, `color: textColor`, `min-h-9` — la píldora de fecha ya usa esa
altura de 36px como excepción aceptada a los 44px del resto del proyecto por
ser chrome secundario dentro de un panel, no un control primario; la píldora
de hora hereda la misma excepción, no introduce una nueva).

Mismo patrón exacto que la píldora de fecha: un botón visual (texto +
ícono) con un `<input type="time">` real superpuesto en `absolute
inset-0 opacity-0`, capturando el tap/click. Contenido del botón:

- **Con valor**: `Clock` (ícono, 14px) + `"14:32"` (24h, ver formato en
  sección 5) + un botón `×` chico (`aria-label="Quitar hora"`) al final de
  la píldora, con `@click.stop` para no abrir el picker al limpiarla — es
  el mecanismo concreto que resuelve el punto 4 (el usuario necesita una
  forma explícita de vaciar el campo; los pickers nativos de hora en
  mobile no siempre ofrecen una forma fácil de dejarlo vacío una vez que
  ya tiene un valor).
- **Sin valor** (solo posible en edición, ver sección 3): mismo ícono +
  texto `"Agregar hora"` con opacidad reducida (`opacity-70` sobre
  `textColor`), sin botón `×` (no hay nada que limpiar). Tocar la píldora
  abre el picker nativo para elegir una.

No rompe el layout mobile-first: ambas píldoras son compactas
(`"12 jul"` ≈ 5-6 caracteres, `"14:32"` ≈ 5 caracteres + ícono + `×`), la
fila sigue cabiendo en una sola línea incluso en un viewport angosto
(360px) sin necesitar `flex-wrap`. No se toca ningún otro elemento del
panel (monto, cuenta, categoría).

## 2. Input nativo, `text-base`

El `<input type="time">` invisible superpuesto usa el mismo `text-base`
(16px) que cualquier input del proyecto (evita el auto-zoom de iOS), aunque
sea visualmente invisible — mismo criterio ya aplicado al input de fecha
existente.

## 3. Default en modo alta

**Confirmado, con un ajuste de precisión sobre la redacción del Product
Owner**: la hora default es la hora real del dispositivo tomada **al abrir
el Sheet** (dentro de `resetForm()`, el mismo hook que ya inicializa
`form.date = todayDateInputValue()` en el bloque `else` de alta), **no** al
tocar "Guardar". Razón: `resetForm()` ya es el único punto de verdad de
"valores por defecto al abrir" para todos los campos — capturar la hora en
otro momento (p. ej. justo antes de `onSubmit()`) requeriría un segundo
mecanismo paralelo solo para este campo, sin ningún beneficio real (la
brecha entre abrir el Sheet y tocar Guardar es de segundos/pocos minutos,
y el usuario puede editar la hora libremente si no le sirve). Si el Sheet
queda abierto mucho tiempo y cruza, por ejemplo, la medianoche o cambia de
minuto, no se re-sincroniza solo — es el mismo comportamiento ya aceptado
para la fecha default, no un caso especial nuevo.

Valor del input en este caso: `"HH:MM"` de `new Date()` en hora local
(nueva función `nowTimeInputValue()` en `src/lib/date.ts`, mismo criterio
que `todayDateInputValue()`).

## 4. Modo edición

- Si la fila (`expense.expense_time`/`income.income_time`) tiene valor:
  precargar tal cual en el input (`"HH:MM"`, tomando los primeros 5
  caracteres del `"HH:MM:SS"` que devuelve Postgres — mismo criterio
  defensivo que ya usa el proyecto al consumir columnas `time`/`date`
  crudas).
- Si es `null` (fila vieja, pre-feature): el campo arranca **vacío**
  (píldora en el estado "Agregar hora" de la sección 1). Nunca se inventa
  `"00:00"` como si fuera un dato real — mismo principio ya aplicado en
  todo el resto del proyecto a "estado siempre derivado, nunca inventado".

## 5. Validación

- **Sin validación de "no futuro"** sobre la hora — esa validación sigue
  existiendo únicamente sobre `form.date` (`isFutureDate`), sin tocar.
  Justificación: la hora es puramente informativa dentro de un mismo día ya
  validado por la fecha; no hay un concepto claro de "hora futura" que
  tenga sentido bloquear (p. ej. cargar a las 9am un gasto de "hace un
  rato, a las 8:50am" del mismo día es exactamente el caso de uso que pide
  el encargo).
- El campo es **opcional a nivel de UX** pese a venir prellenado en alta:
  si el usuario lo vacía con el botón `×` (sección 1), se guarda `null` —
  no hay ninguna regla que lo vuelva a completar solo ni que bloquee el
  submit por dejarlo vacío.
- Orden de validación existente (monto → cuenta → categoría → fecha) no
  cambia — la hora no participa del slot de error único porque nunca es
  inválida por sí misma.

## 6. Visualización en listados

Formato exacto en ambos lugares: **24 horas, `"HH:MM"`** (mismo criterio ya
usado en el proyecto para horarios, ver `formatKickoffTime` en
`src/lib/matchClock.ts`: `toLocaleTimeString('es-AR', { hour: '2-digit',
minute: '2-digit' })` — o, más simple acá porque el dato ya es un string
`"HH:MM:SS"` de Postgres sin componente de zona horaria, un slice directo a
5 caracteres sin pasar por `Date`/locale). Nueva función
`formatTimeShort(value: string): string` en `src/lib/date.ts`. **Se muestra
únicamente si la fila tiene hora guardada** — nunca `"00:00"` ni ningún
placeholder para filas sin dato, en ambos listados de abajo.

- **`TransactionsView.vue`** (agrupado por día, el heading de grupo ya
  resuelve "Hoy"/"Ayer"/fecha — no hace falta repetir la fecha por fila):
  agregar la hora **junto al título** de la fila (línea ~713-718, dentro
  del mismo `<p class="font-medium">`), con el separador `"·"` que el
  proyecto ya usa para combinar 2 datos cortos en una línea (mismo patrón
  que `itemSubtitle` de `HomeView.vue`: `"{{categoría}} · {{cuenta}}"`):
  ```
  {{ itemTitle(item) }} <span class="text-xs font-normal text-muted-foreground">· 14:32</span>
  ```
  Solo para `item.kind === 'expense' | 'income'` con hora no nula — nunca
  para `transfer-out`/`transfer-in`/`debt-linked` (esos tipos ni siquiera
  tienen la columna).
- **`HomeView.vue`** ("Transacciones recientes"): la columna derecha ya
  muestra `formatExpenseDateHeading(item.date)` (p. ej. `"Hoy"`) debajo del
  monto (línea ~570-572). Agregar la hora ahí mismo, mismo separador:
  ```
  {{ formatExpenseDateHeading(item.date) }}{{ hora ? ` · ${hora}` : '' }}
  ```
  Resultado: `"Hoy · 14:32"` cuando hay hora, `"Hoy"` sin cambios cuando no
  la hay — cero impacto visual en filas viejas/sin hora.

## 7. Orden de la lista — se difiere, no se toca esta vez

**Decisión: no usar la hora nueva para desempatar dentro del mismo día
calendario en esta iteración.** El criterio actual (`date desc, created_at
desc`) queda igual. Razón: introducir un desempate por hora crearía un
criterio de orden **inconsistente dentro del mismo grupo de día** — de las
filas de un mismo día, unas tendrían hora (ordenables con precisión) y
otras no (viejas, `null`, cayendo de vuelta a `created_at`), mezclando dos
lógicas de ordenamiento distintas en la misma lista sin ninguna señal visual
que explique por qué una fila "salta" respecto de otra. Es una complejidad
real (arbitrar qué hacer cuando una fila tiene hora y la vecina no) para un
beneficio acotado (reordenar dentro de un día ya agrupado, donde el usuario
generalmently no necesita más precisión que "qué día fue"). Queda anotado
como candidato de una iteración futura, una vez que la mayoría de las filas
tenga hora real y el caso de uso de reordenar por hora dentro del día se
sienta un problema genuino, no hipotético.

## 8. Confirmación de alcance

Este documento no introduce ningún cambio en `AccountTransferFormSheet.vue`,
`DebtMovementFormSheet.vue`, `account_transfers`, `debt_movements`, ni en
ningún listado de Transferencias/Deudas. Si a futuro se pide extender la
hora a esas dos features, es un encargo nuevo — no asumir que este doc ya
lo cubre.
