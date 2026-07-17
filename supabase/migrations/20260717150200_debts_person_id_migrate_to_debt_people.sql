-- =============================================================================
-- debts_person_id_migrate_to_debt_people
-- -----------------------------------------------------------------------------
-- Repunta debts.person_id de public.card_people a public.debt_people
-- (20260717150000), completando la separación de dominios pedida por el
-- Product Owner (ver comentario extendido en esa migración).
--
-- Backfill de datos reales (verificado contra el proyecto remoto antes de
-- escribir esta migración): al momento de escribirla existía 1 fila real en
-- public.debts, referenciando 1 fila de public.card_people ("Jhair"). Se
-- resuelve el backfill preservando el MISMO id de card_people al insertar en
-- debt_people (en vez de generar un id nuevo y luego reasignar
-- debts.person_id por user_id+nombre): como debts.person_id ya apunta a ese
-- id, insertar la fila equivalente en debt_people con idéntico id dejar a
-- debts.person_id automáticamente válido contra la nueva FK, sin tener que
-- tocar una sola fila de la tabla debts. Es estrictamente más simple y más
-- seguro que reasignar por nombre (no hay ambigüedad posible si dos personas
-- del mismo usuario comparten nombre). A partir de esta migración, la fila
-- vive en dos tablas con el mismo id pero ya son independientes: cambios
-- futuros en card_people (nombre/color) NO se reflejan en debt_people ni
-- viceversa — divergen a propósito, es el punto central del pedido de
-- separación.
--
-- Si en el futuro esta migración se re-ejecutara contra un proyecto sin
-- ninguna fila en debts, el INSERT de backfill simplemente no selecciona
-- ninguna fila (select ... where person_id in (select person_id from debts)
-- sobre una tabla vacía) y el resto de la migración (swap de FK + función)
-- aplica igual sin ningún efecto adicional — no hace falta una rama
-- condicional separada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Backfill: una fila en debt_people por cada card_people distinta
--    referenciada desde debts.person_id, con el mismo id.
-- -----------------------------------------------------------------------------
insert into public.debt_people (id, user_id, name, color, created_at, updated_at)
select cp.id, cp.user_id, cp.name, cp.color, cp.created_at, cp.updated_at
from public.card_people cp
where cp.id in (select distinct d.person_id from public.debts d)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Swap de la FK: debts.person_id pasa de referenciar card_people a
--    referenciar debt_people. Ya no hace falta on delete restrict especial:
--    mismo criterio que la FK original (una deuda siempre necesita una
--    contraparte válida).
-- -----------------------------------------------------------------------------
alter table public.debts
  drop constraint debts_person_id_fkey;

alter table public.debts
  add constraint debts_person_id_fkey
  foreign key (person_id) references public.debt_people (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- 3. debts_validate_owner(): pasa a validar contra debt_people en vez de
--    card_people. Se mantiene el mismo nombre de función/trigger (ya
--    vinculado a "debts", no a la tabla de contrapartes) para no romper
--    ninguna referencia existente.
-- -----------------------------------------------------------------------------
create or replace function public.debts_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.debt_people p
    where p.id = new.person_id and p.user_id = new.user_id
  ) then
    raise exception 'person_id % no pertenece al usuario %', new.person_id, new.user_id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Comentarios: corregir la documentación que describía person_id como
--    "reusado de card_people" — ya no es así.
-- -----------------------------------------------------------------------------
comment on table public.debts is 'Cabecera de una deuda/préstamo entre el usuario y una persona (public.debt_people). El saldo corriente vive en debt_movements/debt_balances, no acá.';
comment on column public.debts.person_id is 'FK a public.debt_people (contraparte de la deuda). Tabla separada de card_people a propósito: son dominios distintos aunque compartan forma de datos (ver 20260717150000_debt_people_init.sql). NOT NULL: una deuda siempre tiene contraparte. on delete restrict: la UI de borrado de una debt_people debe bloquear "Eliminar" si tiene debts asociadas.';
