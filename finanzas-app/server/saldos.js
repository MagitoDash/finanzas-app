const db = require('./db');

// Saldo actual de cada medio de pago = ingresos - egresos (movimientos)
// menos lo aportado a reservas, más lo retirado de reservas hacia ese medio.
function calcularSaldos() {
  const medios = db.prepare('SELECT * FROM medios_pago WHERE activo = 1 ORDER BY id').all();

  const movs = db.prepare(`
    SELECT medio_pago_id, tipo, SUM(monto) as total
    FROM movimientos
    WHERE medio_pago_id IS NOT NULL
    GROUP BY medio_pago_id, tipo
  `).all();

  const reservaMovs = db.prepare(`
    SELECT medio_pago_id, tipo, SUM(monto) as total
    FROM movimientos_reserva
    WHERE medio_pago_id IS NOT NULL
    GROUP BY medio_pago_id, tipo
  `).all();

  const saldoPorMedio = {};
  for (const m of medios) saldoPorMedio[m.id] = 0;

  for (const row of movs) {
    if (!(row.medio_pago_id in saldoPorMedio)) continue;
    if (row.tipo === 'Ingreso') saldoPorMedio[row.medio_pago_id] += row.total;
    else saldoPorMedio[row.medio_pago_id] -= row.total;
  }

  for (const row of reservaMovs) {
    if (!(row.medio_pago_id in saldoPorMedio)) continue;
    if (row.tipo === 'Aporte') saldoPorMedio[row.medio_pago_id] -= row.total; // sale del medio hacia la reserva
    else saldoPorMedio[row.medio_pago_id] += row.total; // retiro de la reserva vuelve al medio
  }

  return medios.map((m) => ({ ...m, saldo: Math.round((saldoPorMedio[m.id] || 0) * 100) / 100 }));
}

function calcularSaldoReservas() {
  const reservas = db.prepare('SELECT * FROM reservas WHERE activo = 1 ORDER BY id').all();
  const movs = db.prepare(`
    SELECT reserva_id, tipo, SUM(monto) as total FROM movimientos_reserva GROUP BY reserva_id, tipo
  `).all();

  const saldoPorReserva = {};
  for (const r of reservas) saldoPorReserva[r.id] = 0;
  for (const row of movs) {
    if (!(row.reserva_id in saldoPorReserva)) continue;
    if (row.tipo === 'Aporte') saldoPorReserva[row.reserva_id] += row.total;
    else saldoPorReserva[row.reserva_id] -= row.total;
  }

  return reservas.map((r) => ({ ...r, saldo: Math.round((saldoPorReserva[r.id] || 0) * 100) / 100 }));
}

module.exports = { calcularSaldos, calcularSaldoReservas };
