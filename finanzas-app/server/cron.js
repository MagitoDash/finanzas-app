const db = require('./db');

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function revisarFijos() {
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const periodo = periodoActual();

  const fijos = db.prepare('SELECT * FROM gastos_fijos WHERE activo = 1').all();
  const insertar = db.prepare(
    `INSERT INTO movimientos (tipo, monto, medio_pago_id, categoria, descripcion, origen) VALUES ('Egreso', ?, ?, ?, ?, 'automatico')`
  );
  const marcar = db.prepare('UPDATE gastos_fijos SET ultimo_periodo = ? WHERE id = ?');

  let agregados = 0;
  for (const f of fijos) {
    if (f.dia_cobro !== diaHoy) continue;
    if (f.ultimo_periodo === periodo) continue; // ya se agregó este mes
    insertar.run(f.monto, f.medio_pago_id, f.categoria, `${f.nombre} (automático)`);
    marcar.run(periodo, f.id);
    agregados++;
  }
  if (agregados > 0) console.log(`🔁 ${agregados} gasto(s) fijo(s) agregado(s) automáticamente`);
  return agregados;
}

function iniciarRevisionDiaria() {
  revisarFijos(); // corre una vez al levantar el servidor, por si estuvo apagado el día del cobro
  setInterval(revisarFijos, 1000 * 60 * 60 * 12); // y despues cada 12hs
}

module.exports = { revisarFijos, iniciarRevisionDiaria };
