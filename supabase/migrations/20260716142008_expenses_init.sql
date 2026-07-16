-- =============================================================================
-- expenses_init
-- -----------------------------------------------------------------------------
-- Gastos registrados por el usuario. App de un solo usuario: no hay splits,
-- grupos ni deuda entre personas. Cada expense pertenece a un único user_id.
-- =============================================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default (now() at time zone 'utc')::date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.expenses is 'Gastos individuales del usuario. amount siempre en numeric (nunca float) para evitar errores de redondeo monetario.';
comment on column public.expenses.category_id is 'FK a categories; puede apuntar a una categoría default (sistema) o a una custom del propio usuario.';

create trigger expenses_set_updated_at
before update on public.expenses
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que category_id sea una categoría default o una
-- custom del propio dueño del gasto (ver public.category_is_accessible).
create function public.expenses_validate_category()
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

create trigger expenses_validate_category_trigger
before insert or update of category_id, user_id on public.expenses
for each row
execute function public.expenses_validate_category();

-- Índices para los patrones de consulta típicos: listar/filtrar gastos de un
-- usuario por rango de fechas y/o por categoría.
create index expenses_user_id_idx on public.expenses (user_id);
create index expenses_category_id_idx on public.expenses (category_id);
create index expenses_user_date_idx on public.expenses (user_id, expense_date desc);
