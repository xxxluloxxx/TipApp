-- =============================================================================
-- bet_slips_init
-- -----------------------------------------------------------------------------
-- Primer paso del rediseño a cupones MULTI-PARTIDO (antes un "cupón" era
-- implícito: 1 live_match + sus bet_slip_legs colgando directo de match_id,
-- sin ninguna tabla que representara el cupón en sí). bet_slips es ahora la
-- cabecera real de un cupón: agrupa 1+ partidos (bet_slip_matches,
-- 20260718100100), cada uno con 1+ predicciones (bet_slip_legs, migrada en
-- 20260718100200).
--
-- Sin columna de estado ni de cuota total propia -- ambos son estado
-- DERIVADO (nunca cacheado, mismo criterio que debt_balances/
-- account_balances de este mismo proyecto): ver vistas
-- bet_slip_match_status/bet_slip_summary en 20260718100400.
--
-- stake_amount es NULLABLE a propósito: el usuario puede armar un cupón
-- (partidos + predicciones) sin haber decidido/anotado todavía cuánto va a
-- apostar -- "posible ganancia" (bet_slip_summary.potential_winnings) queda
-- simplemente sin calcular mientras no haya stake, no bloquea el alta del
-- cupón.
-- =============================================================================

create table public.bet_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stake_amount numeric check (stake_amount is null or stake_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bet_slips is 'Cabecera de un cupón de apuestas multi-partido. Agrupa 1+ bet_slip_matches (uno por partido distinto dentro del cupón). Sin estado ni cuota total propios -- ambos derivados, ver bet_slip_summary (20260718100400_bet_slip_status_views.sql).';
comment on column public.bet_slips.stake_amount is 'Monto apostado en el cupón completo, NULLABLE (el usuario puede armar el cupón antes de decidir cuánto apostar). "Posible ganancia" = stake_amount * total_odds, ver bet_slip_summary.';

create trigger bet_slips_set_updated_at
before update on public.bet_slips
for each row
execute function public.set_updated_at();

create index bet_slips_user_id_idx on public.bet_slips (user_id);
