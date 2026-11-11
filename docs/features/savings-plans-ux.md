# Ahorro programado (`/ahorros`)

Plan de N meses que mueve un monto fijo de una cuenta origen a una cuenta de ahorro destino (la "que no se puede tocar" es una cuenta normal; no hay bloqueo técnico).

- Tablas: `savings_plans`, `savings_plan_installments` (todas las cuotas se crean al alta, una por mes; el día se ajusta al último día de los meses cortos). Vista `savings_plan_progress` (cuotas hechas, ahorrado, próxima fecha).
- RPCs no optimistas: `create_savings_plan` y `pay_savings_installment` (crea una transferencia real vía `_account_transfer_insert`, sin comisión, con fecha y hora actuales, y marca la cuota `done`).
- Ejecución **manual con recordatorio**: las cuotas vencidas se marcan en rojo; el usuario toca "Registrar". No hay cron.
- Cuotas anteriores al uso de la app: botón "Ya descontada" (`mark_savings_installment_done`) las marca hechas sin transferencia ni cambio de saldos. "Registrar" fecha la transferencia el día de la cuota si ya pasó.
- Eliminar un plan borra sus cuotas pero conserva las transferencias ya hechas.
