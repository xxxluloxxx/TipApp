-- =============================================================================
-- bet_slip_legs_init
-- -----------------------------------------------------------------------------
-- Selecciones ("legs") de un cupón de apuestas, extraídas por OCR (Edge
-- Function ocr-betslip) de una foto opcional subida al agregar un partido.
-- Hijos de un partido (on delete cascade, mismo criterio que
-- debt_movements/debts: un leg no existe sin su partido). Toda la lógica de
-- dominio (mercado/selección/umbral ya formateados, motor de reglas
-- won/lost/pending) vive server-side — el frontend solo pinta
-- market_label/selection_label/status tal cual llegan (docs/features/
-- live-matches-ux.md secciones 1.7/4.4).
-- =============================================================================

create table public.bet_slip_legs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.live_matches (id) on delete cascade,

  -- Mercados soportados en v1 (fijo, ver PLAN.md sección 6.5 / docs/features/
  -- live-matches-ux.md sección 0.5). 'unknown' = mercado no reconocido por
  -- MarketMapper: se guarda igual, nunca se descarta (punto 4 del encargo).
  market_type text not null check (market_type in (
    'double_chance', 'match_result',
    'total_goals_over', 'total_goals_under',
    'corners_over', 'corners_under',
    'cards_over', 'cards_under',
    'btts', 'btts_first_half',
    'unknown'
  )),

  -- Textos ya formateados y legibles (p. ej. selection_label="Más de 2.5",
  -- market_label="Goles totales") — el frontend no arma estas strings a
  -- partir de market_type/threshold, las recibe listas para pintar
  -- (docs/features/live-matches-ux.md sección 4.4). Para market_type=
  -- 'unknown', market_label puede ser el texto crudo leído por OCR tal cual.
  selection_label text not null,
  market_label text not null,

  -- Umbral N.5 de los mercados over/under; selector de doble
  -- oportunidad/resultado/ambos marcan ('1X'/'X2'/'12'/'1'/'X'/'2'/'yes'/'no').
  threshold numeric,
  selector text,

  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'not_monitorable')),

  -- Texto crudo tal como lo leyó el OCR (pick + mercado), guardado siempre
  -- (no solo para 'unknown') como referencia/debug de calidad de lectura.
  raw_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bet_slip_legs is 'Selecciones de un cupón de apuestas asociadas a un live_match, extraídas por OCR. El estado (won/lost/pending/not_monitorable) lo calcula siempre el motor de reglas server-side (Edge Function poll-matches), nunca el cliente.';
comment on column public.bet_slip_legs.match_id is 'FK a live_matches. ON DELETE CASCADE a propósito (mismo criterio que debt_movements.debt_id): un leg no tiene sentido de existir sin su partido, y borrar el partido completo es una operación intencional del usuario.';
comment on column public.bet_slip_legs.market_type is 'Mercado ya clasificado (equivalente a MarketType de BetRuleEngine.kt en FottStat). ''unknown'' = no matcheó ningún mercado soportado, se muestra igual como "No monitoreable", nunca se oculta.';
comment on column public.bet_slip_legs.selection_label is 'Texto ya formateado para mostrar (ej. "1X", "Más de 2.5", "Sí") — lógica de formato vive en el backend (_shared/marketMapper.ts), no en el frontend.';
comment on column public.bet_slip_legs.market_label is 'Nombre del mercado ya formateado (ej. "Doble oportunidad", "Goles totales", "Ambos equipos anotan en el primer tiempo" — explícito "1ª parte", nunca solo "Ambos marcan" a secas para ese caso). Para unknown, puede ser el texto crudo de OCR.';
comment on column public.bet_slip_legs.status is 'Calculado por el motor de reglas (Edge Function poll-matches) contra el snapshot más reciente del partido, con decisión temprana (ej. "Más de 0.5 goles" pasa a won apenas hay 1 gol total, sin esperar a que termine el partido). El frontend nunca lo recalcula.';

create trigger bet_slip_legs_set_updated_at
before update on public.bet_slip_legs
for each row
execute function public.set_updated_at();

-- Refuerza a nivel de datos que match_id pertenezca al mismo usuario dueño
-- del leg (mismo patrón que debt_movements_validate_owner).
create function public.bet_slip_legs_validate_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.live_matches m
    where m.id = new.match_id and m.user_id = new.user_id
  ) then
    raise exception 'match_id % no pertenece al usuario %', new.match_id, new.user_id;
  end if;

  return new;
end;
$$;

create trigger bet_slip_legs_validate_owner_trigger
before insert or update of match_id, user_id on public.bet_slip_legs
for each row
execute function public.bet_slip_legs_validate_owner();

create index bet_slip_legs_user_id_idx on public.bet_slip_legs (user_id);
create index bet_slip_legs_match_id_idx on public.bet_slip_legs (match_id);
