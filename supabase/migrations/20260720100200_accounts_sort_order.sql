-- =============================================================================
-- accounts_sort_order
-- -----------------------------------------------------------------------------
-- Orden manual de "Mis cuentas" (accounts-income-ux.md sección 13, rediseño
-- de /cuentas): el usuario puede reordenar sus cuentas a mano (drag/botones
-- arriba-abajo, implementado en el frontend a continuación) en vez de quedar
-- fijo al orden de creación que hoy usa `sortedAccounts` en
-- src/stores/accounts.ts. `sort_order` es un entero simple por cuenta,
-- SIN unicidad forzada a nivel de BD (a diferencia de, por ejemplo,
-- categories.name): dos cuentas del mismo usuario con el mismo sort_order no
-- rompen nada (el ORDER BY del frontend simplemente empata y cae a un
-- criterio secundario), evita tener que envolver cada reorden en una
-- transacción de "shift" atómico de todos los índices intermedios.
--
-- Verificado contra el proyecto remoto real antes de escribir el backfill
-- (npx supabase db query --linked): 9 filas en accounts, repartidas en 5
-- usuarios (1 usuario con 5 cuentas, 4 usuarios con 1 cuenta cada uno). Sin
-- empates de created_at dentro de un mismo usuario, pero se agrega `id` como
-- desempate en el ORDER BY del backfill de todos modos, por determinismo.
-- =============================================================================

alter table public.accounts
  add column sort_order integer not null default 0;

comment on column public.accounts.sort_order is 'Orden manual de la cuenta en los listados/grids del usuario (accounts-income-ux.md sección 13). Sin unicidad forzada: el frontend ordena por (sort_order, created_at) y tolera empates. Asignado automáticamente al crear una cuenta nueva (ver trigger accounts_set_sort_order_trigger más abajo) — el frontend nunca calcula el máximo actual a mano antes de insertar.';

-- -----------------------------------------------------------------------------
-- Backfill de las cuentas ya existentes: orden de creación por usuario,
-- arrancando en 0 (mismo criterio "empieza en 0" que el resto de índices/
-- conteos del proyecto, ej. installment_number). `id` como desempate
-- secundario, aunque no se detectó ningún empate real de created_at.
-- -----------------------------------------------------------------------------
with ordered as (
  select
    id,
    row_number() over (partition by user_id order by created_at, id) - 1 as new_sort_order
  from public.accounts
)
update public.accounts a
set sort_order = ordered.new_sort_order
from ordered
where ordered.id = a.id;

-- -----------------------------------------------------------------------------
-- Alta de cuenta nueva: SIEMPRE al final de la lista del usuario, nunca en
-- 0/duplicada con las ya existentes, sin que el frontend tenga que hacer un
-- select del máximo actual antes de insertar (src/stores/accounts.ts sigue
-- sin mandar sort_order en el payload de alta, igual que hoy).
--
-- Mecanismo elegido: trigger `before insert`, no un cálculo en el frontend.
-- Justificación de por qué es seguro para este caso de uso (single-user,
-- escritura poco frecuente, sin necesidad real de un guard de concurrencia
-- más fuerte tipo advisory lock):
--   - Cada usuario solo escribe accounts desde sus propias sesiones/
--     dispositivos; dos altas de cuenta concurrentes del MISMO usuario en la
--     ventana de milisegundos que toma este trigger es un caso extremo sin
--     evidencia de que ocurra en la práctica (ver el mismo argumento ya
--     aceptado para `create_debt`/`create_live_match`, que tampoco usan
--     advisory locks).
--   - Si dos altas concurrentes SÍ calzaran exactamente en la misma
--     transacción y ambas leyeran el mismo `max`, el peor caso es un empate
--     de sort_order (no una excepción, no una fila corrupta) — ya
--     documentado arriba como tolerado por el frontend.
--
-- Cómo distingue "el frontend no mandó sort_order" (debe recalcularse) de
-- "alguien insertó explícitamente en la posición 0" (debe respetarse): hoy
-- NINGÚN camino de alta manda sort_order explícito (ver accounts.ts,
-- addAccount, y el insert de la cuenta "General" en handle_new_user()) — así
-- que se trata `new.sort_order = 0` (el default de columna) como "no
-- especificado" y se sobrescribe únicamente cuando el usuario YA tiene otras
-- cuentas (si es la primera cuenta del usuario, 0 ya es el valor correcto,
-- no hace falta tocarlo). El día que exista un camino real de "insertar en
-- una posición explícita distinta de continuar al final", tendrá que mandar
-- un valor distinto de 0 o esta función tendrá que ganar una columna
-- centinela — no es el caso hoy.
-- -----------------------------------------------------------------------------
create function public.accounts_set_sort_order()
returns trigger
language plpgsql
as $$
declare
  next_order integer;
begin
  if new.sort_order = 0 then
    select coalesce(max(sort_order), -1) + 1
    into next_order
    from public.accounts
    where user_id = new.user_id;

    if next_order > 0 then
      new.sort_order := next_order;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.accounts_set_sort_order() is 'Antes de insertar una cuenta con sort_order = 0 (el default, nunca mandado explícito por el frontend hoy), la reubica al final de la lista del usuario (max(sort_order) + 1) si ya tiene otras cuentas. Si es su primera cuenta, 0 queda tal cual.';

create trigger accounts_set_sort_order_trigger
before insert on public.accounts
for each row
execute function public.accounts_set_sort_order();
