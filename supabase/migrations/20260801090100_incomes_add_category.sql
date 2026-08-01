-- =============================================================================
-- incomes_add_category
-- -----------------------------------------------------------------------------
-- Agrega categoría opcional a incomes, ahora que categories soporta
-- kind='income' (ver 20260801090000_categories_income_kind.sql). NULLABLE a
-- nivel de columna a propósito: los ingresos históricos ya existentes no
-- tienen categoría y no deben romperse; la obligatoriedad para ingresos
-- NUEVOS la impone el frontend (formulario), no un `not null` en BD.
-- =============================================================================

alter table public.incomes
  add column category_id uuid references public.categories (id) on delete restrict;

comment on column public.incomes.category_id is 'FK opcional a categories (kind=''income''). NULL permitido: ingresos históricos pre-categorización y, potencialmente, ingresos sin categorizar. on delete restrict porque no queremos borrar una categoría de ingreso todavía referenciada. Ver incomes_validate_category_trigger para la validación de accesibilidad + kind.';

create index incomes_category_id_idx on public.incomes (category_id);

-- Mismo patrón exacto que incomes_validate_account_trigger (incomes_init.sql):
-- valida a nivel de datos que, si se especifica category_id, sea accesible
-- para el user_id de la fila (default del sistema o custom propia) Y que su
-- kind sea 'income' -- rechaza explícitamente intentar imputar un ingreso a
-- una categoría de gasto.
create function public.incomes_validate_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null then
    if not public.category_is_accessible(new.category_id, new.user_id, 'income') then
      raise exception 'category_id % no es una categoría de ingreso accesible para el usuario %', new.category_id, new.user_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger incomes_validate_category_trigger
before insert or update of category_id, user_id on public.incomes
for each row
execute function public.incomes_validate_category();

-- Nota RLS: no hace falta tocar policies de categories ni de incomes. Las de
-- categories ya exponen select de "user_id is null or user_id = auth.uid()"
-- sin importar kind (las 3 nuevas default de ingreso quedan visibles con la
-- misma regla que las de gasto); insert/update/delete de categories ya
-- exigen user_id = auth.uid() (no aplica a las default, que son solo
-- lectura para todos). Las de incomes ya restringen todo a
-- user_id = auth.uid(); category_id es una columna más de una fila que ya
-- pertenece al usuario, no cambia el alcance de esas policies.
-- =============================================================================
