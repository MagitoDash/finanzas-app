require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { inferirCategoria, LISTA_CATEGORIAS_EGRESO, LISTA_CATEGORIAS_INGRESO } = require('./categorias');
const { iniciarBot } = require('./telegramBot');
const { generarPromptAnalisis } = require('./promptAnalisis');
const { calcularSaldos, calcularSaldoReservas } = require('./saldos');
const { iniciarRevisionDiaria, revisarFijos } = require('./cron');

const app = express();
app.use(cors());
app.use(express.json());

// Evita que el navegador o un proxy/CDN (Cloudflare) sirvan datos viejos del API.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'dashboard'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

const API_KEY = process.env.API_KEY;

function chequearApiKey(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'API key inválida' });
  next();
}

// ---------- Medios de pago ----------
app.get('/api/medios', (req, res) => {
  res.json(db.prepare('SELECT * FROM medios_pago WHERE activo = 1 ORDER BY id').all());
});

app.post('/api/medios', (req, res) => {
  const { nombre, moneda } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const info = db.prepare('INSERT INTO medios_pago (nombre, moneda) VALUES (?, ?)').run(nombre, moneda || 'ARS');
    res.json({ id: info.lastInsertRowid, nombre, moneda: moneda || 'ARS' });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe un medio de pago con ese nombre' });
  }
});

app.delete('/api/medios/:id', (req, res) => {
  db.prepare('UPDATE medios_pago SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/saldos', (req, res) => res.json(calcularSaldos()));

app.get('/api/categorias', (req, res) => {
  res.json({ egreso: LISTA_CATEGORIAS_EGRESO, ingreso: LISTA_CATEGORIAS_INGRESO });
});

// ---------- Movimientos (lo usa el Atajo de iPhone) ----------
app.post('/api/movimiento', chequearApiKey, (req, res) => {
  let { tipo, monto, medio_pago, categoria, descripcion } = req.body;
  monto = parseFloat(monto);
  if (!tipo || !['Ingreso', 'Egreso'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser Ingreso o Egreso' });
  if (isNaN(monto)) return res.status(400).json({ error: 'monto inválido' });

  let medioRow = null;
  if (medio_pago) medioRow = db.prepare('SELECT * FROM medios_pago WHERE nombre = ? AND activo = 1').get(medio_pago);

  const cat = categoria || (tipo === 'Ingreso' ? 'Otros' : inferirCategoria(descripcion || ''));

  const info = db.prepare(
    `INSERT INTO movimientos (tipo, monto, medio_pago_id, categoria, descripcion, origen) VALUES (?, ?, ?, ?, ?, 'shortcut')`
  ).run(tipo, monto, medioRow ? medioRow.id : null, cat, descripcion || '');

  res.json({ ok: true, id: info.lastInsertRowid, categoria: cat, medio: medioRow ? medioRow.nombre : null });
});

app.put('/api/movimiento/:id', (req, res) => {
  const { tipo, monto, medio_pago, categoria, descripcion } = req.body;
  const medioRow = medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(medio_pago) : null;
  db.prepare(
    `UPDATE movimientos SET tipo = COALESCE(?, tipo), monto = COALESCE(?, monto), medio_pago_id = COALESCE(?, medio_pago_id),
     categoria = COALESCE(?, categoria), descripcion = COALESCE(?, descripcion) WHERE id = ?`
  ).run(tipo || null, monto != null ? parseFloat(monto) : null, medioRow ? medioRow.id : null, categoria || null, descripcion ?? null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/movimiento/:id', (req, res) => {
  db.prepare('DELETE FROM movimientos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Gastos fijos ----------
app.get('/api/fijos', (req, res) => {
  res.json(db.prepare(`
    SELECT gf.*, mp.nombre as medio_nombre, mp.moneda
    FROM gastos_fijos gf LEFT JOIN medios_pago mp ON mp.id = gf.medio_pago_id
    WHERE gf.activo = 1 ORDER BY gf.dia_cobro
  `).all());
});

app.post('/api/fijos', (req, res) => {
  const { nombre, monto, medio_pago, categoria, dia_cobro } = req.body;
  if (!nombre || !monto || !dia_cobro) return res.status(400).json({ error: 'nombre, monto y dia_cobro son requeridos' });
  const medioRow = medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(medio_pago) : null;
  const info = db.prepare(
    'INSERT INTO gastos_fijos (nombre, monto, medio_pago_id, categoria, dia_cobro) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, monto, medioRow ? medioRow.id : null, categoria || 'Suscripcion', parseInt(dia_cobro, 10));
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/fijos/:id', (req, res) => {
  db.prepare('UPDATE gastos_fijos SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Reservas / ahorros ----------
app.get('/api/reservas', (req, res) => res.json(calcularSaldoReservas()));

app.post('/api/reservas', (req, res) => {
  const { nombre, descripcion, objetivo_monto, fecha_objetivo, moneda } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const info = db.prepare(
    'INSERT INTO reservas (nombre, descripcion, objetivo_monto, fecha_objetivo, moneda) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, descripcion || '', objetivo_monto ? parseFloat(objetivo_monto) : null, fecha_objetivo || null, moneda || 'ARS');
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/reservas/:id', (req, res) => {
  db.prepare('UPDATE reservas SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Mover plata: Aporte (medio -> reserva) o Retiro (reserva -> medio)
app.post('/api/reservas/:id/movimiento', (req, res) => {
  const { tipo, monto, medio_pago, descripcion } = req.body;
  if (!['Aporte', 'Retiro'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser Aporte o Retiro' });
  const m = parseFloat(monto);
  if (isNaN(m) || m <= 0) return res.status(400).json({ error: 'monto inválido' });
  const medioRow = medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(medio_pago) : null;

  db.prepare(
    'INSERT INTO movimientos_reserva (reserva_id, tipo, monto, medio_pago_id, descripcion) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, tipo, m, medioRow ? medioRow.id : null, descripcion || '');

  res.json({ ok: true });
});

app.get('/api/reservas/:id/movimientos', (req, res) => {
  res.json(db.prepare(`
    SELECT mr.*, mp.nombre as medio_nombre
    FROM movimientos_reserva mr LEFT JOIN medios_pago mp ON mp.id = mr.medio_pago_id
    WHERE mr.reserva_id = ? ORDER BY mr.fecha DESC
  `).all(req.params.id));
});

// ---------- Dashboard ----------
app.get('/api/resumen-mes', (req, res) => {
  const movs = db.prepare(`
    SELECT m.*, mp.nombre as medio_nombre, mp.moneda
    FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
    WHERE strftime('%Y-%m', m.fecha) = strftime('%Y-%m', 'now','localtime')
    ORDER BY m.fecha DESC
  `).all();

  const fijos = db.prepare(`
    SELECT gf.*, mp.nombre as medio_nombre, mp.moneda
    FROM gastos_fijos gf LEFT JOIN medios_pago mp ON mp.id = gf.medio_pago_id
    WHERE gf.activo = 1
  `).all();

  const porMoneda = {};
  const porCategoria = {};
  const porMedio = {};
  for (const m of movs) {
    const mon = m.moneda || 'ARS';
    porMoneda[mon] = porMoneda[mon] || { ingresos: 0, egresos: 0 };
    if (m.tipo === 'Ingreso') {
      porMoneda[mon].ingresos += m.monto;
    } else {
      porMoneda[mon].egresos += m.monto;
      porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + m.monto;
      const k = m.medio_nombre || 'Sin especificar';
      porMedio[k] = (porMedio[k] || 0) + m.monto;
    }
  }

  res.json({ movimientos: movs, fijos, porMoneda, porCategoria, porMedio });
});

app.get('/api/historico', (req, res) => {
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', m.fecha) as periodo, mp.moneda as moneda,
           SUM(CASE WHEN m.tipo='Egreso' THEN m.monto ELSE 0 END) as egresos,
           SUM(CASE WHEN m.tipo='Ingreso' THEN m.monto ELSE 0 END) as ingresos
    FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
    GROUP BY periodo, moneda ORDER BY periodo ASC
  `).all();
  res.json(rows);
});

app.get('/api/prompt-analisis', (req, res) => {
  res.json({ texto: generarPromptAnalisis() });
});

app.post('/api/revisar-fijos', (req, res) => {
  res.json({ agregados: revisarFijos() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));

iniciarBot();
iniciarRevisionDiaria();
