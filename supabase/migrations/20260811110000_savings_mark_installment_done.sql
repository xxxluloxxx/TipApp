-- Marca una cuota como hecha SIN crear transferencia ni tocar saldos.
-- Para cuotas anteriores al uso de la app (el descuento ya ocurrió).
create function public.mark_savings_installment_done(p_installment_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.savings_plan_installments
  set status = 'done', done_at = now()
  where id = p_installment_id and status = 'pending';
  if not found then
    raise exception 'Cuota no encontrada o ya registrada';
  end if;
end;
$$;
grant execute on function public.mark_savings_installment_done(uuid) to authenticated;
