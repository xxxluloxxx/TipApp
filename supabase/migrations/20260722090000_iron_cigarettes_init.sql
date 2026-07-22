-- =============================================================================
-- iron_cigarettes_init
-- -----------------------------------------------------------------------------
-- Tabla núcleo de la feature "Iron" (control de consumo de tabaco, ver
-- docs/features/iron-ux.md secciones 1.1-1.4). Utilidad personal NO
-- financiera por defecto (ninguna fila de esta tabla genera jamás
-- expenses/incomes ni toca account_balances, con o sin vínculo opcional de
-- iron_packs activo -- ver docs/features/iron-ux.md sección 2.2).
--
-- Decisión de modelado clave (sección 1.2 del doc): la unidad atómica es la
-- MITAD de un cigarrillo, no el cigarrillo entero. Un entero es siempre una
-- sola fila kind='entero'/status='completo'. Una mitad nace
-- kind='mitad'/status='mitad_pendiente' y se resuelve más tarde a:
--   - 'completo': se inserta una fila NUEVA (kind='mitad', status='completo',
--     con su propia smoked_date/smoked_time real, que puede caer en un día
--     distinto) con closes_cigarette_id -> la fila original, que también
--     pasa a 'completo'. Dos filas, cada una con su hora real -- modelarlo
--     como una sola fila con "hora de inicio/fin" rompería la agrupación por
--     smoked_date (sección 1.1) apenas las dos mitades caen en días
--     distintos.
--   - 'descartada': la fila original pasa a 'descartada' sin crear ninguna
--     fila nueva -- sigue contando como 0.5 cigarrillo fumado (sección 1.2,
--     "conteo de cigarrillos consumidos": SUM(kind='entero' ? 1 : 0.5) sobre
--     TODAS las filas sin importar status).
--
-- Fecha/hora: dos columnas separadas (date + time), NUNCA timestamptz --
-- mismo patrón ya adoptado por transaction-time-ux.md para expenses/incomes
-- y documentado en la sección "Decisiones clave" de CLAUDE.md, para que
-- agrupar por día/semana/mes (historial, tendencias) sea aritmética pura de
-- `date` sin ambigüedad de huso horario. A diferencia de expense_time (
-- opcional), acá smoked_date/smoked_time son AMBAS obligatorias: el alta
-- siempre parte de "ahora" (sección 1.1).
--
-- closes_cigarette_id on delete set null (no cascade): si la fila original
-- que una mitad cerró se borra por algún motivo, la fila que la cerró sigue
-- siendo un registro real y válido -- solo pierde la referencia cruzada
-- trazable, mismo criterio ya usado en account_transfers.expense_id /
-- iron_packs.linked_expense_id (ver 20260722090100).
-- =============================================================================

create table public.iron_cigarettes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('entero', 'mitad')),
  status text not null check (status in ('completo', 'mitad_pendiente', 'descartada')),
  smoked_date date not null,
  smoked_time time not null,
  closes_cigarette_id uuid references public.iron_cigarettes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un cigarrillo entero siempre nace y queda 'completo' -- no existe ningún
  -- estado intermedio posible para kind='entero' (sección 1.2).
  constraint iron_cigarettes_entero_completo
    check (kind = 'mitad' or status = 'completo'),
  -- closes_cigarette_id solo tiene sentido en una fila que CIERRA una mitad
  -- pendiente (siempre kind='mitad'); un entero nunca "cierra" nada.
  constraint iron_cigarettes_closes_only_mitad
    check (closes_cigarette_id is null or kind = 'mitad')
);

comment on table public.iron_cigarettes is 'Registro de consumo de tabaco de Iron. Unidad atómica = la mitad de un cigarrillo (value 0.5), no el cigarrillo entero (value 1.0). Nunca genera expenses/incomes ni toca account_balances -- ver docs/features/iron-ux.md sección 2.2.';
comment on column public.iron_cigarettes.kind is '''entero'': un cigarrillo completo fumado de una vez, siempre status=''completo''. ''mitad'': la mitad de un cigarrillo, con 3 estados posibles a lo largo de su vida (ver comment on column status).';
comment on column public.iron_cigarettes.status is '''completo'': la unidad (entero o mitad) ya está resuelta. ''mitad_pendiente'': primera mitad fumada, la segunda todavía no se resolvió -- invariante: máximo UNA fila así por usuario a la vez (ver índice único parcial iron_cigarettes_one_pending_half). ''descartada'': el usuario decidió no terminar esa mitad (sigue contando como 0.5 fumado, ver comment on table).';
comment on column public.iron_cigarettes.smoked_date is 'Fecha real del evento (fumada esta mitad/entero), sin ambigüedad de huso horario -- fuente de verdad para agrupar por día/semana/mes. NUNCA timestamptz, mismo patrón que expense_date.';
comment on column public.iron_cigarettes.smoked_time is 'Hora real del evento. Obligatoria (a diferencia de expenses.expense_time, que es opcional): el alta de Iron siempre parte de "ahora".';
comment on column public.iron_cigarettes.closes_cigarette_id is 'Cuando esta fila es la SEGUNDA mitad que cierra una mitad_pendiente anterior, apunta a la fila original que cerró. NULL en cualquier otro caso (entero, mitad_pendiente todavía abierta, o mitad descartada). on delete set null: borrar la fila original no debe arrastrar en cascada el borrado de la fila que la cerró.';

create trigger iron_cigarettes_set_updated_at
before update on public.iron_cigarettes
for each row
execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Constraint dura (sección 1.3 del doc, NO negociable): máximo una fila
-- 'mitad_pendiente' por usuario a la vez, garantizado a nivel de base de
-- datos (índice único parcial), no solo un guard de cliente -- sobrevive a
-- doble-tap, dos pestañas abiertas o carreras de red. Intentar insertar una
-- segunda fila mitad_pendiente mientras la primera sigue abierta hace que
-- Postgres levante un error de unique_violation (23505), que PostgREST
-- devuelve como un error 409 controlado al cliente -- exactamente el
-- comportamiento observable pedido, sin necesitar ninguna función/trigger
-- adicional para este chequeo puntual.
-- -----------------------------------------------------------------------------
create unique index iron_cigarettes_one_pending_half
  on public.iron_cigarettes (user_id)
  where kind = 'mitad' and status = 'mitad_pendiente';

-- Refuerza a nivel de datos que closes_cigarette_id (si no es NULL)
-- pertenezca al mismo user_id -- mismo patrón que
-- account_transfers_validate_owner (20260720091000) para expense_id.
create function public.iron_cigarettes_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if new.closes_cigarette_id is not null and not exists (
    select 1 from public.iron_cigarettes c
    where c.id = new.closes_cigarette_id and c.user_id = new.user_id
  ) then
    raise exception 'closes_cigarette_id % no pertenece al usuario %', new.closes_cigarette_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger iron_cigarettes_validate_owner_trigger
before insert or update of closes_cigarette_id, user_id on public.iron_cigarettes
for each row
execute function public.iron_cigarettes_validate_owner();

-- Índices para los patrones de consulta típicos: historial por día
-- (sección 5, filtro por smoked_date = un día puntual) y tendencias
-- (sección 6, filtro por rango de smoked_date).
create index iron_cigarettes_user_id_idx on public.iron_cigarettes (user_id);
create index iron_cigarettes_user_date_idx on public.iron_cigarettes (user_id, smoked_date desc);
create index iron_cigarettes_closes_cigarette_id_idx on public.iron_cigarettes (closes_cigarette_id);
