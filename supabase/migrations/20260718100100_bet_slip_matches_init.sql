-- =============================================================================
-- bet_slip_matches_init
-- -----------------------------------------------------------------------------
-- Un partido DENTRO de un cupón multi-partido (bet_slips, 20260718100000) --
-- agrupa 1+ bet_slip_legs (predicciones) sobre el MISMO partido (ej.
-- "Liverpool-Chelsea: Ambos marcan Sí + Más de 3.5 tarjetas" son 2 legs bajo
-- 1 bet_slip_match).
--
-- live_match_id es NULLABLE a propósito: el grupo puede no resolver a un
-- partido real trackeado en live_matches (usuario no lo encontró en el
-- buscador / lo tipeó a mano) -- eso NO bloquea el alta del cupón, solo
-- significa que ese grupo nunca sale de 'pending' en bet_slip_match_status
-- (no hay snapshot contra el que evaluar sus legs) y sus legs se crean
-- directo en status 'not_monitorable' (ver create_bet_slip,
-- 20260718100500).
--
-- ON DELETE SET NULL en live_match_id (no CASCADE): si el usuario deja de
-- trackear un partido (borra la fila de live_matches, p.ej. desde la lista
-- de "Partidos en vivo"), el/los bet_slip_match que lo referenciaban NO
-- desaparecen -- el grupo y sus legs ya guardados (odds/labels/status)
-- sobreviven, solo pierden el tracking en vivo y su status cae a 'pending'
-- para siempre (mismo espíritu que "el cupón es un registro histórico de lo
-- que el usuario apostó", no debe evaporarse porque el usuario dejó de
-- seguir el partido en la otra feature). Documentado explícitamente porque
-- es la única FK "hacia afuera" de esta tabla que NO es on delete cascade.
--
-- live_match_id SIN unique -- el mismo live_match puede estar referenciado
-- por bet_slip_matches de DISTINTOS cupones (2 cupones distintos con una
-- predicción sobre el mismo partido) sin duplicar el tracking en
-- live_matches (mismo find-or-create de create_bet_slip). Que dos grupos
-- del MISMO cupón apunten al mismo live_match_id es responsabilidad del
-- frontend (agrupar legs por partido antes de armar el payload) -- no se
-- refuerza acá con una constraint, ver nota en el reporte de esta sesión.
-- =============================================================================

create table public.bet_slip_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bet_slip_id uuid not null references public.bet_slips (id) on delete cascade,
  live_match_id uuid references public.live_matches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bet_slip_matches is 'Un partido dentro de un cupón multi-partido: agrupa 1+ bet_slip_legs (predicciones) sobre el mismo live_match. live_match_id nullable (grupo no resuelto a un partido trackeado) y ON DELETE SET NULL (borrar el tracking del partido no borra el grupo ni sus legs).';
comment on column public.bet_slip_matches.live_match_id is 'FK opcional a live_matches (find-or-create en create_bet_slip: reusa el tracking existente si el usuario ya sigue este partido desde otro cupón). ON DELETE SET NULL a propósito -- ver comment on table.';

create trigger bet_slip_matches_set_updated_at
before update on public.bet_slip_matches
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que bet_slip_id y (si viene) live_match_id
-- pertenezcan al mismo user_id del grupo -- mismo patrón que
-- bet_slip_legs_validate_owner/debt_movements_validate_owner.
create function public.bet_slip_matches_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.bet_slips s
    where s.id = new.bet_slip_id and s.user_id = new.user_id
  ) then
    raise exception 'bet_slip_id % no pertenece al usuario %', new.bet_slip_id, new.user_id;
  end if;

  if new.live_match_id is not null and not exists (
    select 1 from public.live_matches m
    where m.id = new.live_match_id and m.user_id = new.user_id
  ) then
    raise exception 'live_match_id % no pertenece al usuario %', new.live_match_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger bet_slip_matches_validate_owner_trigger
before insert or update of bet_slip_id, live_match_id, user_id on public.bet_slip_matches
for each row
execute function public.bet_slip_matches_validate_owner();

create index bet_slip_matches_user_id_idx on public.bet_slip_matches (user_id);
create index bet_slip_matches_bet_slip_id_idx on public.bet_slip_matches (bet_slip_id);
create index bet_slip_matches_live_match_id_idx on public.bet_slip_matches (live_match_id);
