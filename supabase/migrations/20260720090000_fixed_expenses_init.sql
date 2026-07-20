-- =============================================================================
-- fixed_expenses_init
-- -----------------------------------------------------------------------------
-- Plantilla de un gasto fijo/recurrente del usuario (alquiler, servicios,
-- suscripciones). Mismo patrón que accounts/credit_cards: 100% propiedad del
-- usuario, sin fila "default del sistema". A diferencia de expenses, la
-- plantilla NO lleva account_id: la cuenta se elige recién al pagar cada
-- instancia mensual (ver fixed_expense_instances/pay_fixed_expense_instance),
-- porque el mismo gasto fijo podría pagarse desde cuentas distintas mes a
-- mes (ej. a veces con la tarjeta débito, a veces en efectivo).
-- =============================================================================

create table public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  payment_day smallint not null check (payment_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('monthly')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fixed_expenses is 'Plantilla de un gasto fijo/recurrente del usuario. No lleva account_id: la cuenta se elige por instancia mensual al pagar (ver fixed_expense_instances). is_active permite pausar sin borrar (y sin generar más instancias mensuales) preservando el historial ya pagado.';
comment on column public.fixed_expenses.amount is 'Monto de referencia/esperado del gasto fijo. pay_fixed_expense_instance permite pagar un monto distinto por instancia (ej. luz/gas variable) sin tocar este valor.';
comment on column public.fixed_expenses.payment_day is 'Día del mes en el que normalmente se paga (1-31), puramente informativo para ordenar "próximos pagos" — no dispara nada automáticamente, no hay cron de vencimientos.';
comment on column public.fixed_expenses.frequency is 'Preparado a futuro para otras frecuencias (ej. anual). v1 solo soporta ''monthly''.';
comment on column public.fixed_expenses.is_active is 'Pausar un gasto fijo sin borrarlo: una plantilla inactiva no genera más fixed_expense_instances nuevas (ver ensure_current_fixed_expense_instances), pero conserva su historial de instancias ya creadas/pagadas.';

create trigger fixed_expenses_set_updated_at
before update on public.fixed_expenses
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que category_id sea una categoría default o una
-- custom del propio dueño de la plantilla (mismo criterio que
-- expenses_validate_owner / card_expenses_validate_owner).
create function public.fixed_expenses_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not public.category_is_accessible(new.category_id, new.user_id) then
    raise exception 'category_id % no pertenece al usuario % ni es una categoría default', new.category_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger fixed_expenses_validate_owner_trigger
before insert or update of category_id, user_id on public.fixed_expenses
for each row
execute function public.fixed_expenses_validate_owner();

create index fixed_expenses_user_id_idx on public.fixed_expenses (user_id);
create index fixed_expenses_category_id_idx on public.fixed_expenses (category_id);
create index fixed_expenses_user_active_idx on public.fixed_expenses (user_id, is_active);
