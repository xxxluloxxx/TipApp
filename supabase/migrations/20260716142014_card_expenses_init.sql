-- =============================================================================
-- card_expenses_init
-- -----------------------------------------------------------------------------
-- Gastos registrados contra una tarjeta de crédito del usuario, opcionalmente
-- atribuidos a una "persona" (card_people). Igual que expenses: app de un solo
-- usuario, no hay splits/deuda/settlement entre personas.
-- =============================================================================

create table public.card_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.credit_cards (id) on delete restrict,
  person_id uuid references public.card_people (id) on delete restrict,
  description text,
  expense_date date not null default (now() at time zone 'utc')::date,
  amount numeric(12, 2) not null check (amount > 0),
  installment_number int check (installment_number > 0),
  installment_total int check (installment_total > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_expenses_installments_consistent check (
    (installment_number is null and installment_total is null)
    or (
      installment_number is not null
      and installment_total is not null
      and installment_number <= installment_total
    )
  )
);

comment on table public.card_expenses is 'Gastos individuales imputados a una tarjeta de crédito del usuario, con persona (opcional) y datos de cuota (opcionales).';
comment on column public.card_expenses.card_id is 'FK a credit_cards; on delete restrict porque la UI deshabilita "Eliminar tarjeta" mientras tenga gastos asociados.';
comment on column public.card_expenses.person_id is 'FK a card_people, opcional (la persona es opcional). on delete restrict porque la UI deshabilita "Eliminar persona" mientras tenga gastos asociados.';
comment on column public.card_expenses.installment_number is 'Número de cuota actual (1-indexed). NULL si el gasto no es en cuotas. Debe ir junto con installment_total (ver constraint card_expenses_installments_consistent).';
comment on column public.card_expenses.installment_total is 'Total de cuotas del gasto. NULL si el gasto no es en cuotas.';

create trigger card_expenses_set_updated_at
before update on public.card_expenses
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que card_id/person_id pertenezcan al mismo usuario
-- dueño del gasto (mismo patrón que expenses_validate_category /
-- public.category_is_accessible, pero sin concepto de fila "default": acá
-- credit_cards/card_people son 100% propiedad del usuario, sin filas
-- compartidas).
create function public.card_expenses_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.credit_cards c
    where c.id = new.card_id and c.user_id = new.user_id
  ) then
    raise exception 'card_id % no pertenece al usuario %', new.card_id, new.user_id;
  end if;

  if new.person_id is not null and not exists (
    select 1 from public.card_people p
    where p.id = new.person_id and p.user_id = new.user_id
  ) then
    raise exception 'person_id % no pertenece al usuario %', new.person_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger card_expenses_validate_owner_trigger
before insert or update of card_id, person_id, user_id on public.card_expenses
for each row
execute function public.card_expenses_validate_owner();

create index card_expenses_user_id_idx on public.card_expenses (user_id);
create index card_expenses_card_id_idx on public.card_expenses (card_id);
create index card_expenses_person_id_idx on public.card_expenses (person_id);
create index card_expenses_user_date_idx on public.card_expenses (user_id, expense_date desc);
