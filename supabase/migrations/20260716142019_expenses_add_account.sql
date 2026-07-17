-- =============================================================================
-- expenses_add_account
-- -----------------------------------------------------------------------------
-- Agrega account_id a expenses (todo gasto pasa a imputarse a una cuenta,
-- igual que ya se imputa a una categoría). Se hace en 3 pasos porque ya
-- existen filas en expenses en el proyecto remoto real:
--   1) columna nullable
--   2) backfill: cuenta "General" para cada usuario con expenses que todavía
--      no tenga ninguna cuenta propia, y asignación de esa cuenta a sus
--      expenses existentes
--   3) recién ahí, not null
--
-- Nota sobre usuarios nuevos: desde 20260716142017_accounts_init.sql,
-- handle_new_user() ya crea una cuenta "General" para todo usuario que se
-- registre a partir de esa migración, así que el backfill de abajo solo
-- puede llegar a afectar a usuarios que ya existían ANTES de esa migración
-- (los únicos que podrían tener expenses sin ninguna cuenta todavía). La
-- cláusula "where not exists" hace el insert idempotente igual, por si este
-- script se corriera más de una vez o el usuario ya tuviera una cuenta por
-- otro motivo.
-- =============================================================================

-- Paso 1: columna nullable.
alter table public.expenses
  add column account_id uuid references public.accounts (id) on delete restrict;

comment on column public.expenses.account_id is 'FK a accounts; on delete restrict porque la UI deshabilita "Eliminar cuenta" mientras tenga movimientos (ingresos o gastos) asociados.';

-- Paso 2a: crear la cuenta "General" para todo usuario con expenses que
-- todavía no tenga ninguna cuenta propia.
insert into public.accounts (user_id, name, color, icon)
select distinct e.user_id, 'General', '#6b7280', 'Wallet'
from public.expenses e
where not exists (
  select 1 from public.accounts a where a.user_id = e.user_id
);

-- Paso 2b: asignar esa cuenta "General" (la más antigua de ese usuario, por
-- si ya tenía alguna) a todos sus expenses existentes sin account_id.
update public.expenses e
set account_id = (
  select a.id
  from public.accounts a
  where a.user_id = e.user_id
  order by a.created_at asc
  limit 1
)
where e.account_id is null;

-- Paso 3: not null, ya con todas las filas existentes cubiertas.
alter table public.expenses
  alter column account_id set not null;

create index expenses_account_id_idx on public.expenses (account_id);

-- -----------------------------------------------------------------------------
-- Amplía la validación de ownership de expenses para cubrir también
-- account_id (antes solo validaba category_id). Se reemplaza la función/
-- trigger expenses_validate_category por expenses_validate_owner (nombre
-- alineado con card_expenses_validate_owner, que ya valida más de una FK a la
-- vez) en vez de agregar un segundo trigger independiente: category_id y
-- account_id se validan en la misma pasada, con un único mensaje de error
-- claro por columna si alguna no pertenece al usuario.
-- -----------------------------------------------------------------------------
drop trigger expenses_validate_category_trigger on public.expenses;
drop function public.expenses_validate_category();

create function public.expenses_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not public.category_is_accessible(new.category_id, new.user_id) then
    raise exception 'category_id % no pertenece al usuario % ni es una categoría default', new.category_id, new.user_id;
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'account_id % no pertenece al usuario %', new.account_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger expenses_validate_owner_trigger
before insert or update of category_id, account_id, user_id on public.expenses
for each row
execute function public.expenses_validate_owner();
