-- =============================================================================
-- incomes_init
-- -----------------------------------------------------------------------------
-- Ingresos registrados por el usuario, imputados a una cuenta propia. Igual
-- que expenses: app de un solo usuario, sin splits/grupos/deuda. A diferencia
-- de expenses, incomes NO tiene categoría (fuera de alcance de esta fase).
-- =============================================================================

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  income_date date not null default (now() at time zone 'utc')::date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.incomes is 'Ingresos individuales del usuario, imputados a una cuenta propia. Sin categoría (a diferencia de expenses) en esta fase.';
comment on column public.incomes.account_id is 'FK a accounts; on delete restrict porque la UI deshabilita "Eliminar cuenta" mientras tenga movimientos (ingresos o gastos) asociados.';

create trigger incomes_set_updated_at
before update on public.incomes
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que account_id pertenezca al mismo usuario dueño
-- del ingreso (mismo patrón que card_expenses_validate_owner: accounts no
-- tiene filas "default del sistema", es 100% propiedad del usuario).
create function public.incomes_validate_account()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'account_id % no pertenece al usuario %', new.account_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger incomes_validate_account_trigger
before insert or update of account_id, user_id on public.incomes
for each row
execute function public.incomes_validate_account();

create index incomes_user_id_idx on public.incomes (user_id);
create index incomes_account_id_idx on public.incomes (account_id);
create index incomes_user_date_idx on public.incomes (user_id, income_date desc);
