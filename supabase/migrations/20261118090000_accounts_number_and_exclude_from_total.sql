-- Cuentas: número de cuenta (informativo) y switch para excluir una cuenta del
-- "Saldo total" (p. ej. "Ahorro Programado", plata que no se puede tocar).
-- `include_in_total = false` solo afecta el TOTAL agregado en el cliente; el
-- saldo de la cuenta (`account_balances`) no cambia.
alter table public.accounts
  add column if not exists account_number text null,
  add column if not exists include_in_total boolean not null default true;

alter table public.accounts
  drop constraint if exists accounts_account_number_length;
alter table public.accounts
  add constraint accounts_account_number_length
  check (account_number is null or char_length(account_number) between 1 and 40);

comment on column public.accounts.account_number is 'Número de cuenta bancaria (texto libre, opcional). Solo informativo.';
comment on column public.accounts.include_in_total is 'false = la cuenta no se suma al "Saldo total" de Inicio/Cuentas. Su propio saldo sigue calculándose igual.';
