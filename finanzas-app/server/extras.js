const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');
const { calcularSaldos } = require('./saldos');
const cuotas = require('./cuotas');

const mesOk = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : cuotas.mesDe());

function montar(app) {
  // ---------- Medios: editar tipo / cierre / vencimiento ----------
  app.put('/api/medios/:id', (req, res) => {
    const { nombre, moneda, tipo_medio, dia_cierre, dia_venc } = req.body;
    const t = ['efectivo', 'debito', 'credito', 'billetera', 'otro'].includes(tipo_medio) ? tipo_medio : null;
    const dia = (v) => (v === '' || v == null ? null : Math.min(31, Math.max(1, parseInt(v, 10) || 1)));
    try {
      db.prepare(`UPDATE medios_pago SET nombre = COALESCE(?, nombre), moneda = COALESCE(?, moneda), tipo_medio = COALESCE(?, tipo_medio),
                  dia_cierre = ?, dia_venc = ? WHERE id = ?`)
        .run(nombre || null, moneda || null, t, dia(dia_cierre), dia(dia_venc), req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: 'No se pudo guardar (¿nombre repetido?)' }); }
  });

  // ---------- Presupuestos ----------
  app.get('/api/presupuestos', (req, res) => {
    const mes = mesOk(req.query.mes);
    const gastos = Object.fromEntries(db.prepare(`
      SELECT m.categoria, SUM(m.monto) AS t FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
      WHERE m.tipo = 'Egreso' AND strftime('%Y-%m', m.fecha) = ? AND COALESCE(mp.moneda,'ARS') = 'ARS' GROUP BY m.categoria`).all(mes).map((r) => [r.categoria, r.t]));
    res.json(db.prepare('SELECT categoria, monto FROM presupuestos ORDER BY categoria').all().map((p) => {
      const gastado = gastos[p.categoria] || 0;
      return { categoria: p.categoria, limite: p.monto, gastado, restante: p.monto - gastado, pct: p.monto ? Math.round(gastado / p.monto * 100) : 0 };
    }));
  });
  app.put('/api/presupuestos', (req, res) => {
    const monto = parseFloat(req.body.monto), cat = (req.body.categoria || '').trim();
    if (!cat) return res.status(400).json({ error: 'categoría requerida' });
    if (!(monto > 0)) db.prepare('DELETE FROM presupuestos WHERE categoria = ?').run(cat);
    else db.prepare('INSERT INTO presupuestos (categoria, monto) VALUES (?, ?) ON CONFLICT(categoria) DO UPDATE SET monto = excluded.monto').run(cat, monto);
    res.json({ ok: true });
  });
  // Promedio mensual de los últimos 3 meses cerrados por categoría (ayuda para elegir un tope)
  app.get('/api/presupuestos/sugerencia', (req, res) => {
    const act = cuotas.mesDe(), desde = cuotas.sumarMeses(act, -3);
    const rows = db.prepare(`
      SELECT m.categoria, strftime('%Y-%m', m.fecha) AS mes, SUM(m.monto) AS t FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
      WHERE m.tipo = 'Egreso' AND COALESCE(mp.moneda,'ARS') = 'ARS' AND strftime('%Y-%m', m.fecha) >= ? AND strftime('%Y-%m', m.fecha) < ?
      GROUP BY m.categoria, mes`).all(desde, act);
    const meses = new Set(rows.map((r) => r.mes)).size || 1, por = {};
    for (const r of rows) por[r.categoria] = (por[r.categoria] || 0) + r.t;
    res.json({ meses, promedios: Object.fromEntries(Object.entries(por).map(([k, v]) => [k, Math.round(v / meses)])) });
  });

  // ---------- Gastos frecuentes ----------
  app.get('/api/frecuentes', (req, res) => {
    res.json(db.prepare(`SELECT f.id, f.nombre, f.tipo, f.descripcion, f.categoria, f.monto, mp.nombre AS medio
      FROM frecuentes f LEFT JOIN medios_pago mp ON mp.id = f.medio_pago_id ORDER BY f.id`).all());
  });
  app.post('/api/frecuentes', (req, res) => {
    const { nombre, tipo, descripcion, medio_pago, categoria, monto } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'nombre requerido' });
    const m = medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(medio_pago) : null;
    const info = db.prepare('INSERT INTO frecuentes (nombre, tipo, descripcion, medio_pago_id, categoria, monto) VALUES (?, ?, ?, ?, ?, ?)')
      .run(String(nombre).trim().slice(0, 30), tipo === 'Ingreso' ? 'Ingreso' : 'Egreso', descripcion || nombre, m ? m.id : null, categoria || '', parseFloat(monto) > 0 ? parseFloat(monto) : null);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.delete('/api/frecuentes/:id', (req, res) => { db.prepare('DELETE FROM frecuentes WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  // ---------- Tarjetas y cuotas ----------
  app.get('/api/cuotas', (req, res) => res.json({ planes: cuotas.listarPlanes(), proyeccion: cuotas.proyeccion(6) }));
  app.post('/api/cuotas', (req, res) => {
    const b = req.body;
    const m = b.medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(b.medio_pago) : null;
    try {
      const p = cuotas.crearPlan({ descripcion: b.descripcion, categoria: b.categoria, medio_id: m && m.id, monto_total: b.monto_total, monto_cuota: b.monto_cuota,
        cuotas: b.cuotas, empieza_proximo: !!b.empieza_proximo, ya_pagadas: b.ya_pagadas });
      res.json({ ok: true, ...p });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/cuotas/:id', (req, res) => { db.prepare('UPDATE planes_cuotas SET activo = 0 WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  app.get('/api/tarjetas', (req, res) => {
    const planes = cuotas.listarPlanes(), act = cuotas.mesDe();
    const mesSql = db.prepare("SELECT medio_pago_id AS id, SUM(monto) AS t FROM movimientos WHERE origen = 'cuotas' AND strftime('%Y-%m', fecha) = ? GROUP BY medio_pago_id");
    const cuotasMes = Object.fromEntries(mesSql.all(act).map((r) => [r.id, r.t]));
    res.json(calcularSaldos().filter((m) => m.tipo_medio === 'credito').map((m) => {
      const mios = planes.filter((p) => p.medio_pago_id === m.id && !p.terminado);
      return { id: m.id, nombre: m.nombre, moneda: m.moneda, saldo: m.saldo, deuda: m.saldo < 0 ? -m.saldo : 0, dia_cierre: m.dia_cierre, dia_venc: m.dia_venc,
               cuotas_mes: Math.round(cuotasMes[m.id] || 0), compromiso_futuro: mios.reduce((a, p) => a + p.monto_restante, 0), planes: mios.length };
    }));
  });

  // ---------- Exportar a Excel ----------
  app.get('/api/export.xlsx', async (req, res) => {
    try {
      const ExcelJS = require('exceljs'), wb = new ExcelJS.Workbook();
      const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : null;
      const movs = db.prepare(`SELECT m.fecha, m.tipo, m.monto, COALESCE(mp.moneda,'ARS') AS moneda, m.categoria, mp.nombre AS medio, m.descripcion
        FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id ${mes ? "WHERE strftime('%Y-%m', m.fecha) = ?" : ''} ORDER BY m.fecha DESC`).all(...(mes ? [mes] : []));
      const estilo = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

      const w1 = wb.addWorksheet('Movimientos');
      w1.columns = [{ header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Monto', key: 'monto', width: 14 },
        { header: 'Moneda', key: 'moneda', width: 8 }, { header: 'Categoría', key: 'categoria', width: 16 }, { header: 'Medio de pago', key: 'medio', width: 18 }, { header: 'Descripción', key: 'descripcion', width: 36 }];
      movs.forEach((m) => w1.addRow({ ...m, fecha: m.fecha.slice(0, 10), medio: m.medio || '' }));
      w1.getColumn('monto').numFmt = '#,##0'; estilo(w1); w1.autoFilter = 'A1:G1';

      const w2 = wb.addWorksheet('Por categoría');
      w2.columns = [{ header: 'Mes', key: 'mes', width: 10 }, { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Categoría', key: 'categoria', width: 18 }, { header: 'Total', key: 'total', width: 14 }];
      db.prepare(`SELECT strftime('%Y-%m', m.fecha) AS mes, m.tipo, m.categoria, SUM(m.monto) AS total FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
        WHERE COALESCE(mp.moneda,'ARS') = 'ARS' GROUP BY mes, m.tipo, m.categoria ORDER BY mes DESC, m.tipo, total DESC`).all().forEach((r) => w2.addRow(r));
      w2.getColumn('total').numFmt = '#,##0'; estilo(w2);

      const w3 = wb.addWorksheet('Cuotas');
      w3.columns = [{ header: 'Compra', key: 'descripcion', width: 28 }, { header: 'Tarjeta', key: 'medio', width: 16 }, { header: 'Valor cuota', key: 'monto_cuota', width: 14 },
        { header: 'Pagadas', key: 'pagadas', width: 9 }, { header: 'Total cuotas', key: 'cuotas_total', width: 12 }, { header: 'Falta pagar', key: 'monto_restante', width: 14 }, { header: 'Termina', key: 'termina', width: 10 }];
      cuotas.listarPlanes().forEach((p) => w3.addRow(p)); w3.getColumn('monto_cuota').numFmt = '#,##0'; w3.getColumn('monto_restante').numFmt = '#,##0'; estilo(w3);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="finanzas-${mes || 'todo'}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el Excel' }); }
  });

  // ---------- Backup ----------
  app.get('/api/backup', async (req, res) => {
    const tmp = path.join(os.tmpdir(), 'finanzas-backup-' + Date.now() + '.db');
    try {
      await db.backup(tmp);
      res.download(tmp, `finanzas-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(tmp, () => {}));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo hacer el backup' }); }
  });
}

// Copia automática diaria en el mismo volumen (guarda las últimas 7).
function backupDiario() {
  const dir = path.join(__dirname, 'data', 'backups'); fs.mkdirSync(dir, { recursive: true });
  const hoy = path.join(dir, `finanzas-${new Date().toISOString().slice(0, 10)}.db`);
  const hacer = async () => {
    try {
      if (!fs.existsSync(hoy)) await db.backup(hoy);
      const todos = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
      todos.slice(0, Math.max(0, todos.length - 7)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    } catch (e) { console.error('Backup diario falló:', e.message); }
  };
  hacer(); setInterval(hacer, 6 * 60 * 60 * 1000);
}

module.exports = { montar, backupDiario };
