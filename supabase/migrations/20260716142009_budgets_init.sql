-- =============================================================================
-- budgets_init
-- -----------------------------------------------------------------------------
-- Presupuesto opcional por categoría y mes. month_start siempre es el día 1
-- del mes (fecha truncada a mes) para poder indexar y comparar fácilmente.
-- =============================================================================

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  amount_limit numeric(12, 2) not null check (amount_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.budgets is 'Presupuesto límite por categoría y mes (month_start = primer día del mes).';

create trigger budgets_set_updated_at
before update on public.budgets
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que category_id sea una categoría default o una
-- custom del propio dueño del presupuesto (ver public.category_is_accessible).
create function public.budgets_validate_category()
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

create trigger budgets_validate_category_trigger
before insert or update of category_id, user_id on public.budgets
for each row
execute function public.budgets_validate_category();

-- Un solo presupuesto por usuario+categoría+mes.
create unique index budgets_user_category_month_unique
  on public.budgets (user_id, category_id, month_start);

create index budgets_user_id_idx on public.budgets (user_id);
create index budgets_user_month_idx on public.budgets (user_id, month_start);
