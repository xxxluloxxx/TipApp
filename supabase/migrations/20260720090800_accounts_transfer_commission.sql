-- =============================================================================
-- accounts_transfer_commission
-- -----------------------------------------------------------------------------
-- Comisión bancaria configurable por cuenta, aplicada como default sugerido
-- al transferir DESDE esa cuenta hacia otra propia (ver
-- 20260720091000_account_transfers_init.sql /
-- 20260720091300_create_account_transfer_function.sql). No es un monto fijo
-- obligatorio: create_account_transfer recibe p_commission_amount explícito
-- por transferencia (el frontend puede pre-completarlo con este valor, pero
-- el usuario puede ajustarlo transferencia a transferencia, ej. promociones
-- puntuales sin comisión). Vive en accounts (no en account_transfers) porque
-- es un atributo de la cuenta origen, no de un movimiento puntual.
--
-- Sin backfill necesario: `default 0` cubre las cuentas ya existentes
-- (incluida "General", que nunca tuvo noción de comisión).
-- =============================================================================

alter table public.accounts
  add column transfer_commission numeric(12, 2) not null default 0 check (transfer_commission >= 0);

comment on column public.accounts.transfer_commission is 'Comisión bancaria sugerida (monto fijo, no porcentaje) al transferir DESDE esta cuenta hacia otra cuenta propia. Puramente un default para pre-completar el formulario de transferencia — create_account_transfer recibe el monto real de comisión como parámetro explícito por transferencia, no lee esta columna automáticamente. Opcional (default 0 = sin comisión), nunca negativa.';
