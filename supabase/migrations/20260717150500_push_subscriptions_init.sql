-- =============================================================================
-- push_subscriptions_init
-- -----------------------------------------------------------------------------
-- Suscripciones Web Push (protocolo VAPID) de cada usuario, una fila por
-- dispositivo/navegador suscripto (`PushManager.subscribe()`). La Edge
-- Function poll-matches manda un Push a TODAS las suscripciones del usuario
-- dueño del partido cuando corresponde (gol/tarjeta/leg decidido = alta;
-- córner/remate a puerta = normal). 100% propiedad del usuario, sin fila
-- "default del sistema".
-- =============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Los 3 campos exactos que entrega PushSubscription.toJSON() del navegador.
  endpoint text not null,
  p256dh text not null,
  auth text not null,

  -- Informativo, útil para que el usuario identifique "de qué dispositivo"
  -- es cada suscripción si a futuro se lista (no usado por poll-matches).
  user_agent text,

  created_at timestamptz not null default now(),

  unique (user_id, endpoint)
);

comment on table public.push_subscriptions is 'Suscripciones Web Push (VAPID) por usuario/dispositivo. poll-matches (service_role) envía a todas las filas del usuario dueño del partido; poda automáticamente las que el proveedor push reporte como inválidas (410/404 al enviar).';
comment on column public.push_subscriptions.endpoint is 'URL única del endpoint push del navegador (identifica el dispositivo/instalación) — clave natural junto a user_id para evitar duplicados si el usuario reactiva notificaciones sin haberlas dado de baja antes.';
comment on column public.push_subscriptions.p256dh is 'Clave pública de cifrado de la suscripción (parte de PushSubscription.getKey(''p256dh'')), necesaria para cifrar el payload enviado (AES128GCM, protocolo Web Push estándar).';
comment on column public.push_subscriptions.auth is 'Secreto de autenticación de la suscripción (PushSubscription.getKey(''auth'')), necesario junto a p256dh para el cifrado del payload.';

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
