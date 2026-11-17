const db = require('./db');

const mesDe = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function sumarMeses(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// Crea un plan de cuotas. ya_pagadas = cuántas cuotas se pagaron ANTES de este mes (no se vuelven a cargar).
function crearPlan({ descripcion, categoria, medio_id, monto_total, monto_cuota, cuotas, empieza_proximo, ya_pagadas = 0 }) {
  cuotas = parseInt(cuotas, 10); ya_pagadas = Math.max(0, parseInt(ya_pagadas, 10) || 0);
  if (!(cuotas > 1)) throw new Error('cuotas inválidas');
  if (!monto_cuota && !monto_total) throw new Error('monto inválido');
  monto_total = monto_total ? parseFloat(monto_total) : parseFloat(monto_cuota) * cuotas;
  monto_cuota = monto_cuota ? parseFloat(monto_cuota) : Math.round((monto_total / cuotas) * 100) / 100;
  const hoy = new Date();
  const primer_mes = ya_pagadas ? sumarMeses(mesDe(hoy), -ya_pagadas) : (empieza_proximo ? sumarMeses(mesDe(hoy), 1) : mesDe(hoy));
  const info = db.prepare(
    `INSERT INTO planes_cuotas (descripcion, categoria, medio_pago_id, monto_total, cuotas_total, monto_cuota, primer_mes, dia, generadas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(descripcion || 'Compra en cuotas', categoria || 'Otros', medio_id || null, monto_total, cuotas, monto_cuota, primer_mes, Math.min(hoy.getDate(), 28), Math.min(ya_pagadas, cuotas));
  generarPendientes();
  return { id: info.lastInsertRowid, monto_cuota, monto_total, cuotas, primer_mes };
}

// Inserta como egreso cada cuota que ya "toca" (mes actual o anterior) y todavía no se cargó.
function generarPendientes() {
  const actual = mesDe();
  const ins = db.prepare(`INSERT INTO movimientos (tipo, monto, medio_pago_id, categoria, descripcion, origen, fecha)
                          VALUES ('Egreso', ?, ?, ?, ?, 'cuotas', ?)`);
  let n = 0;
  for (const p of db.prepare('SELECT * FROM planes_cuotas WHERE activo = 1 AND generadas < cuotas_total').all()) {
    let g = p.generadas;
    while (g < p.cuotas_total) {
      const mes = sumarMeses(p.primer_mes, g);
      if (mes > actual) break;
      g++;
      ins.run(p.monto_cuota, p.medio_pago_id, p.categoria, `${p.descripcion} (cuota ${g}/${p.cuotas_total})`, `${mes}-${String(p.dia).padStart(2, '0')} 12:00:00`);
      n++;
    }
    if (g !== p.generadas) db.prepare('UPDATE planes_cuotas SET generadas = ? WHERE id = ?').run(g, p.id);
  }
  if (n) console.log(`💳 ${n} cuota(s) cargada(s) automáticamente`);
  return n;
}

function listarPlanes() {
  generarPendientes();
  return db.prepare(`SELECT p.*, mp.nombre AS medio FROM planes_cuotas p LEFT JOIN medios_pago mp ON mp.id = p.medio_pago_id
                     WHERE p.activo = 1 ORDER BY p.id DESC`).all().map((p) => {
    const restantes = p.cuotas_total - p.generadas;
    return { ...p, pagadas: p.generadas, restantes, monto_restante: Math.round(restantes * p.monto_cuota),
             termina: sumarMeses(p.primer_mes, p.cuotas_total - 1), terminado: restantes <= 0 };
  });
}

// Cuánto vence cada mes por cuotas (próximos n meses, incluido el actual)
function proyeccion(n = 6) {
  const planes = listarPlanes();
  const out = [];
  for (let i = 0; i < n; i++) {
    const mes = sumarMeses(mesDe(), i);
    let total = 0;
    for (const p of planes) {
      const idx = (() => { const [a, b] = p.primer_mes.split('-').map(Number), [c, d] = mes.split('-').map(Number); return (c * 12 + d) - (a * 12 + b); })();
      if (idx >= 0 && idx < p.cuotas_total) total += p.monto_cuota;
    }
    out.push({ mes, total: Math.round(total) });
  }
  return out;
}

module.exports = { crearPlan, generarPendientes, listarPlanes, proyeccion, mesDe, sumarMeses };
