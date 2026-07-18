-- =============================================================================
-- bet_slip_legs_migrate_to_bet_slip_matches
-- -----------------------------------------------------------------------------
-- bet_slip_legs pasa de colgar directo de un live_match (match_id) a colgar
-- de un bet_slip_match (bet_slip_match_id) -- el nuevo nivel de agrupación
-- que permite que un mismo partido tenga 2+ predicciones dentro de un
-- cupón, y que un cupón agrupe varios partidos distintos (ver
-- 20260718100000/20260718100100).
--
-- Se agrega también `odds` (cuota de esa predicción puntual, antes
-- descartada activamente por el OCR client-side -- src/lib/marketMapper.ts
-- extractPickToken/TRAILING_QUOTA -- ahora empieza a devolverla, trabajo de
-- vue-frontend-expert en paralelo a esta migración). check (odds > 0)
-- porque bet_slip_summary.total_odds (20260718100400) se calcula como
-- exp(sum(ln(odds))) -- ln() explota con odds <= 0.
--
-- BACKFILL: se consultó el proyecto remoto real (jgdenlrceubawwmknzcb)
-- antes de escribir esta migración -- 2 filas en live_matches, 1 fila en
-- bet_slip_legs (la otra live_match, "Baumberg (Ger)"-"Bayer Leverkusen
-- (Ger)", no tiene ningún leg: es un partido trackeado SIN apuesta, caso
-- válido que sigue existiendo tal cual -- ver comment on column
-- bet_slip_matches.live_match_id, no todo live_match necesita un
-- bet_slip_match). El modelo anterior no tenía concepto de "cupón" propio:
-- cada partido CON legs era, implícitamente, un cupón de 1 solo partido. El
-- backfill honra esa semántica: por cada (user_id, match_id) distinto en
-- bet_slip_legs, crea 1 bet_slips (stake_amount NULL -- el monto apostado
-- nunca se capturó en el modelo anterior, dato reconocido como perdido, no
-- inventado) + 1 bet_slip_matches (live_match_id = match_id), y repunta sus
-- legs preservando el MISMO id (mismo criterio que
-- 20260717150200_debts_person_id_migrate_to_debt_people.sql: no generar ids
-- nuevos innecesariamente). odds queda NULL en las filas backfilleadas (el
-- modelo anterior tampoco la capturaba).
-- =============================================================================

alter table public.bet_slip_legs
  add column bet_slip_match_id uuid references public.bet_slip_matches (id) on delete cascade,
  add column odds numeric check (odds is null or odds > 0);

comment on column public.bet_slip_legs.odds is 'Cuota de esta predicción puntual (capturada por OCR client-side o tipeada a mano). Usada por bet_slip_summary.total_odds = producto de todas las odds del cupón (exp(sum(ln(odds))), Postgres no tiene un agregado PRODUCT nativo). NULL en legs de cupones sin cuota conocida (p.ej. backfill de la migración anterior al rediseño multi-partido) -- en ese caso total_odds del cupón entero queda NULL (ver comment on view bet_slip_summary), nunca se asume 1.';

do $$
declare
  r record;
  v_slip_id uuid;
  v_bet_slip_match_id uuid;
begin
  for r in
    select distinct user_id, match_id from public.bet_slip_legs
  loop
    insert into public.bet_slips (user_id, stake_amount)
    values (r.user_id, null)
    returning id into v_slip_id;

    insert into public.bet_slip_matches (user_id, bet_slip_id, live_match_id)
    values (r.user_id, v_slip_id, r.match_id)
    returning id into v_bet_slip_match_id;

    update public.bet_slip_legs
    set bet_slip_match_id = v_bet_slip_match_id
    where match_id = r.match_id and user_id = r.user_id;
  end loop;
end $$;

-- Verificación defensiva: si por lo que sea quedó algún leg sin
-- bet_slip_match_id tras el backfill, mejor fallar la migración ACÁ (antes
-- del not null de abajo, con un mensaje claro) que dejar el esquema en un
-- estado a medio migrar.
do $$
begin
  if exists (select 1 from public.bet_slip_legs where bet_slip_match_id is null) then
    raise exception 'bet_slip_legs_migrate_to_bet_slip_matches: quedaron legs sin bet_slip_match_id tras el backfill';
  end if;
end $$;

alter table public.bet_slip_legs
  alter column bet_slip_match_id set not null;

-- --- Fuera el modelo viejo (match_id directo) -----------------------------
drop trigger bet_slip_legs_validate_owner_trigger on public.bet_slip_legs;
drop function public.bet_slip_legs_validate_owner();
drop index public.bet_slip_legs_match_id_idx;
alter table public.bet_slip_legs drop column match_id;

-- --- Owner-validate nuevo, contra bet_slip_match_id -----------------------
create function public.bet_slip_legs_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.bet_slip_matches bm
    where bm.id = new.bet_slip_match_id and bm.user_id = new.user_id
  ) then
    raise exception 'bet_slip_match_id % no pertenece al usuario %', new.bet_slip_match_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger bet_slip_legs_validate_owner_trigger
before insert or update of bet_slip_match_id, user_id on public.bet_slip_legs
for each row
execute function public.bet_slip_legs_validate_owner();

create index bet_slip_legs_bet_slip_match_id_idx on public.bet_slip_legs (bet_slip_match_id);

comment on table public.bet_slip_legs is 'Selecciones ("legs") de un cupón de apuestas -- cuelgan de bet_slip_matches (un partido dentro de un cupón), no directo de live_matches (rediseño multi-partido, 20260718). El estado (won/lost/pending/not_monitorable) lo calcula siempre el motor de reglas server-side (Edge Function poll-matches), nunca el cliente.';
comment on column public.bet_slip_legs.bet_slip_match_id is 'FK a bet_slip_matches (el grupo/partido dentro del cupón al que pertenece esta predicción). ON DELETE CASCADE: un leg no tiene sentido de existir sin su grupo, y borrar el cupón/grupo completo es una operación intencional del usuario.';
