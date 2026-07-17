-- =============================================================================
-- profiles_accent_color
-- -----------------------------------------------------------------------------
-- Selector de color de acento de la app, persistido en Supabase junto con
-- theme_preference (20260716142011_profiles_theme_preference.sql) para que la
-- preferencia sobreviva entre sesiones/dispositivos.
--
-- A diferencia de theme_preference, esta columna NO lleva ningún `check` de
-- valores permitidos. Sigue el mismo criterio ya usado en categories.color y
-- credit_cards.color: el frontend restringe la elección a una paleta fija de
-- 10 hex (COLOR_SWATCHES en src/lib/colors.ts), la base de datos no valida el
-- formato. Agregar un check aquí duplicaría esa paleta en dos lugares (SQL +
-- TS) que quedarían desincronizados en cuanto la paleta cambie en el
-- frontend; el trade-off ya aceptado en esas dos tablas es el mismo acá.
--
-- `null` = "usar el color de fábrica" (el azul --primary actual del design
-- system), no un valor sentinela ni un hex por default. Por eso la columna es
-- nullable sin `default`, a diferencia de theme_preference que sí tiene
-- default 'system' (ahí los 3 valores son exhaustivos y "no elegido" no es un
-- estado distinto de 'system'; acá "no elegido" sí es un estado propio,
-- distinto de cualquier hex concreto).
-- =============================================================================

alter table public.profiles
  add column accent_color text null;

comment on column public.profiles.accent_color is
  'Hex de color de acento de la UI a elección del usuario. Igual que categories.color/credit_cards.color: sin check constraint en BD, el frontend restringe la elección a una paleta fija de swatches (COLOR_SWATCHES en src/lib/colors.ts). NULL = usar el color de fábrica (--primary del design system), no un hex por default.';

-- -----------------------------------------------------------------------------
-- RLS: no hace falta ninguna policy nueva ni modificar las existentes.
-- La policy "profiles_update_own" (20260716142010_rls_policies.sql) ya es
--   for update to authenticated
--   using (id = auth.uid())
--   with check (id = auth.uid())
-- Postgres RLS no filtra por columna salvo que se usen column-level
-- privileges (grant/revoke por columna) o se referencien columnas específicas
-- dentro de la propia policy — no es el caso acá: la policy solo mira `id`,
-- así que aplica igual sin importar qué columnas se toquen en el UPDATE,
-- incluida accent_color. select/update de esta columna quedan cubiertos por
-- "profiles_select_own"/"profiles_update_own" sin cambios, igual que ya
-- ocurrió con theme_preference.
-- -----------------------------------------------------------------------------
