-- =============================================================================
-- fixed_expense_instances_init
-- -----------------------------------------------------------------------------
-- Instancia mensual de un gasto fijo (una fila por fixed_expense_id+period).
-- Generación LAZY (ver ensure_current_fixed_expense_instances más abajo, en
-- otra migración): no hay cron nuevo, se crea 'pending' recién cuando el
-- frontend consulta/entra a la sección y detecta que falta la del período
-- actual. Se evaluó pg_cron (ya hay precedente con poll-matches) y se
-- descartó a propósito: a diferencia del polling de partidos en vivo (que
-- necesita datos frescos sin que el usuario tenga la app abierta), acá no
-- hay ninguna urgencia de tener la instancia creada antes de que el usuario
-- la vea — es más simple, gratis (sin invocación de cron cada mes) y sin
-- superficie nueva de secrets/Edge Function generar la fila al vuelo en la
-- misma query que ya hace el usuario para ver la sección.
--
-- Invariante fuerte, no negociable: el estado 'paid' nunca sobrevive sin un
-- expense_id que apunte a una fila real de expenses. Se refuerza con DOS
-- mecanismos independientes (uno no alcanza solo):
--   1) CHECK constraint fixed_expense_instances_paid_requires_expense:
--      (status = 'paid') = (expense_id is not null) — bloquea a nivel de
--      dato cualquier combinación inconsistente, sin importar quién escriba
--      la fila (RPC, update directo del cliente, o una acción de FK).
--   2) Trigger fixed_expense_instances_before_write (ver más abajo): si
--      expense_id se desvincula (pasa de not null a null) en la misma
--      escritura, la propia fila se corrige a status='pending'/paid_at=null
--      ANTES de que el check constraint la evalúe. Esto es lo que hace que
--      borrar el expense real desde Transacciones (expense_id references
--      expenses on delete set null) deje la instancia en 'pending'
--      automáticamente: la acción de FK ON DELETE SET NULL ejecuta un UPDATE
--      real sobre esta tabla, que SÍ dispara triggers BEFORE UPDATE de fila
--      (comportamiento estándar de Postgres para acciones referenciales, no
--      un caso especial) — sin este trigger, ese UPDATE dejaría
--      status='paid' con expense_id NULL y el check constraint de arriba
--      haría fallar la transacción del borrado del expense.
-- =============================================================================

create table public.fixed_expense_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fixed_expense_id uuid not null references public.fixed_expenses (id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  expense_id uuid references public.expenses (id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_expense_instances_paid_requires_expense
    check ((status = 'paid') = (expense_id is not null)),
  constraint fixed_expense_instances_unique_period unique (fixed_expense_id, period)
);

comment on table public.fixed_expense_instances is 'Instancia mensual de un gasto fijo. period normalizado al día 1 del mes calendario. status=''paid'' siempre debe traer expense_id resuelto (ver constraint + trigger de invariante en esta migración) apuntando a la fila real de expenses generada por pay_fixed_expense_instance.';
comment on column public.fixed_expense_instances.period is 'Primer día del mes calendario que representa esta instancia (ej. 2026-07-01 para julio 2026). Normalizado por CHECK, nunca un día arbitrario del mes.';
comment on column public.fixed_expense_instances.expense_id is 'FK a la fila real de expenses generada al pagar (pay_fixed_expense_instance). on delete set null: si el usuario borra ese expense desde Transacciones, esta instancia pierde el vínculo y el trigger de invariante la revierte a pending en la misma operación.';
comment on column public.fixed_expense_instances.paid_at is 'Timestamp de cuándo se marcó como pagada (seteado por pay_fixed_expense_instance). Vuelve a NULL junto con status cuando la instancia se revierte a pending.';
comment on constraint fixed_expense_instances_paid_requires_expense on public.fixed_expense_instances is 'Invariante no negociable: paid <=> expense_id resuelto. Ver comentario completo de diseño al inicio de 20260720090100_fixed_expense_instances_init.sql.';

create trigger fixed_expense_instances_set_updated_at
before update on public.fixed_expense_instances
for each row
execute function public.set_updated_at();

-- Valida ownership (fixed_expense_id y, si viene, expense_id deben
-- pertenecer al mismo user_id de la instancia — mismo patrón que
-- debts_validate_owner/expenses_validate_owner) y aplica el mecanismo (2)
-- del invariante descrito arriba: si expense_id pasa de not null a null en
-- un UPDATE, fuerza status/paid_at de vuelta a su estado "sin pagar" en la
-- misma fila antes de que la constraint la evalúe.
create function public.fixed_expense_instances_before_write()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.fixed_expenses fe
    where fe.id = new.fixed_expense_id and fe.user_id = new.user_id
  ) then
    raise exception 'fixed_expense_id % no pertenece al usuario %', new.fixed_expense_id, new.user_id;
  end if;

  if new.expense_id is not null and not exists (
    select 1 from public.expenses e
    where e.id = new.expense_id and e.user_id = new.user_id
  ) then
    raise exception 'expense_id % no pertenece al usuario %', new.expense_id, new.user_id;
  end if;

  if tg_op = 'UPDATE' and new.expense_id is null and old.expense_id is not null then
    new.status := 'pending';
    new.paid_at := null;
  end if;

  return new;
end;
$$;

create trigger fixed_expense_instances_before_write_trigger
before insert or update on public.fixed_expense_instances
for each row
execute function public.fixed_expense_instances_before_write();

create index fixed_expense_instances_user_id_idx on public.fixed_expense_instances (user_id);
create index fixed_expense_instances_user_period_idx on public.fixed_expense_instances (user_id, period);
create index fixed_expense_instances_status_idx on public.fixed_expense_instances (status);
