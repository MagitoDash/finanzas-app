require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { inferirCategoria, claveDe, norm, tokens, LISTA_CATEGORIAS_EGRESO, LISTA_CATEGORIAS_INGRESO } = require('./categorias');
const { iniciarBot } = require('./telegramBot');
const { generarPromptAnalisis } = require('./promptAnalisis');
const { calcularSaldos, calcularSaldoReservas } = require('./saldos');
const { iniciarRevisionDiaria, revisarFijos } = require('./cron');

const auth = require('./auth');
const extras = require('./extras');
const cuotas = require('./cuotas');

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// Evita que el navegador o un proxy/CDN (Cloudflare) sirvan datos viejos del API.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

app.use('/api', auth.middleware);
auth.montar(app);

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

// ---- Clasificación automática ----
// Categoría: 1) la que manda el Atajo (si es válida) -> 2) regla aprendida de tus correcciones
//            -> 3) diccionario de palabras -> 4) "Otros".
// Medio de pago: 1) el que manda el Atajo -> 2) el último que usaste con la misma descripción.
function categoriaAprendida(tipo, descripcion) {
  const clave = claveDe(descripcion);
  if (!clave) return null;
  const buscar = db.prepare('SELECT categoria FROM reglas_categoria WHERE clave = ? AND tipo = ?');
  const exacta = buscar.get(clave, tipo);
  if (exacta) return exacta.categoria;
  for (const t of tokens(descripcion)) {
    const r = buscar.get(t, tipo);
    if (r) return r.categoria;
  }
  return null;
}

function resolverCategoria(tipo, categoria, descripcion) {
  const c = (categoria || '').toString().trim();
  const invalida = !c || ['ingreso', 'egreso'].includes(c.toLowerCase());
  if (!invalida) return { categoria: c, origen: 'atajo' };
  const aprendida = categoriaAprendida(tipo, descripcion);
  if (aprendida) return { categoria: aprendida, origen: 'aprendida' };
  const deducida = inferirCategoria(descripcion || '', tipo);
  return { categoria: deducida, origen: deducida === 'Otros' ? 'ninguna' : 'palabras' };
}

// Busca el medio de pago ignorando mayúsculas, espacios y tildes.
function buscarMedio(nombre) {
  if (!nombre) return null;
  const buscado = norm(nombre);
  return db.prepare('SELECT * FROM medios_pago WHERE activo = 1').all().find((m) => norm(m.nombre) === buscado) || null;
}

function resolverMedio(nombre, descripcion) {
  const directo = buscarMedio(nombre);
  if (directo) return { medio: directo, origen: 'atajo' };
  const clave = claveDe(descripcion);
  if (clave) {
    const previos = db.prepare(
      `SELECT m.descripcion, mp.* FROM movimientos m JOIN medios_pago mp ON mp.id = m.medio_pago_id
       WHERE mp.activo = 1 ORDER BY m.id DESC LIMIT 500`
    ).all();
    const igual = previos.find((p) => claveDe(p.descripcion) === clave);
    if (igual) return { medio: igual, origen: 'aprendido' };
  }
  return { medio: null, origen: 'ninguno' };
}

// Cuando corregís algo en la web, el sistema aprende y lo aplica a movimientos parecidos.
function aprender(movId) {
  const m = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(movId);
  if (!m) return;
  const clave = claveDe(m.descripcion);
  if (!clave) return;
  if (m.categoria && m.categoria !== 'Otros') {
    db.prepare('INSERT OR REPLACE INTO reglas_categoria (clave, tipo, categoria) VALUES (?, ?, ?)').run(clave, m.tipo, m.categoria);
  }
  for (const o of db.prepare('SELECT * FROM movimientos WHERE id != ? AND tipo = ?').all(movId, m.tipo)) {
    if (claveDe(o.descripcion) !== clave) continue;
    if (o.categoria === 'Otros' && m.categoria && m.categoria !== 'Otros') db.prepare('UPDATE movimientos SET categoria = ? WHERE id = ?').run(m.categoria, o.id);
    if (!o.medio_pago_id && m.medio_pago_id) db.prepare('UPDATE movimientos SET medio_pago_id = ? WHERE id = ?').run(m.medio_pago_id, o.id);
  }
}

// Al arrancar: reclasifica lo que quedó mal ("Ingreso"/"Egreso" o "Otros") con el diccionario y lo aprendido.
for (const m of db.prepare("SELECT id, tipo, descripcion FROM movimientos WHERE categoria IN ('Ingreso','Egreso','Otros')").all()) {
  const r = resolverCategoria(m.tipo, '', m.descripcion).categoria;
  db.prepare('UPDATE movimientos SET categoria = ? WHERE id = ?').run(r, m.id);
}

// ---------- Medios de pago ----------
app.get('/api/medios', (req, res) => {
  res.json(db.prepare('SELECT * FROM medios_pago WHERE activo = 1 ORDER BY id').all());
});

app.post('/api/medios', (req, res) => {
  const { nombre, moneda, tipo_medio, dia_cierre, dia_venc } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const tipo = ['efectivo', 'debito', 'credito', 'billetera', 'otro'].includes(tipo_medio) ? tipo_medio : db.inferirTipoMedio(nombre);
  try {
    const info = db.prepare('INSERT INTO medios_pago (nombre, moneda, tipo_medio, dia_cierre, dia_venc) VALUES (?, ?, ?, ?, ?)')
      .run(nombre, moneda || 'ARS', tipo, parseInt(dia_cierre, 10) || null, parseInt(dia_venc, 10) || null);
    res.json({ id: info.lastInsertRowid, nombre, moneda: moneda || 'ARS' });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe un medio de pago con ese nombre' });
  }
});

app.delete('/api/medios/:id', (req, res) => {
  db.prepare('UPDATE medios_pago SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/saldos', (req, res) => { cuotas.generarPendientes(); res.json(calcularSaldos()); });

app.get('/api/categorias', (req, res) => {
  res.json({ egreso: LISTA_CATEGORIAS_EGRESO, ingreso: LISTA_CATEGORIAS_INGRESO });
});

// ---------- Movimientos (lo usa el Atajo de iPhone) ----------
const registrarMovimiento = (req, res) => {
  let { tipo, monto, medio_pago, categoria, descripcion } = req.body;
  monto = parseFloat(monto);
  if (!tipo || !['Ingreso', 'Egreso'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser Ingreso o Egreso' });
  if (isNaN(monto)) return res.status(400).json({ error: 'monto inválido' });

  const rm = resolverMedio(medio_pago, descripcion);
  const medioRow = rm.medio;
  const rc = resolverCategoria(tipo, categoria, descripcion);
  const cat = rc.categoria;

  // Compra en cuotas (tarjeta de crédito): se crea un plan y cada cuota se carga sola en su mes.
  const nCuotas = parseInt(req.body.cuotas, 10);
  if (tipo === 'Egreso' && nCuotas > 1) {
    if (!medioRow) return res.status(400).json({ error: 'Elegí la tarjeta para cargar cuotas' });
    try {
      const p = cuotas.crearPlan({ descripcion: descripcion || 'Compra en cuotas', categoria: cat, medio_id: medioRow.id, monto_total: monto,
        cuotas: nCuotas, empieza_proximo: !!req.body.empieza_proximo });
      if (req.body.ticket_id) db.prepare("UPDATE tickets SET estado = 'completado' WHERE id = ?").run(req.body.ticket_id);
      return res.json({ ok: true, plan_id: p.id, cuotas: nCuotas, monto_cuota: p.monto_cuota, categoria: cat, medio: medioRow.nombre,
        categoria_origen: rc.origen, medio_origen: rm.origen });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  const info = db.prepare(
    `INSERT INTO movimientos (tipo, monto, medio_pago_id, categoria, descripcion, origen) VALUES (?, ?, ?, ?, ?, 'shortcut')`
  ).run(tipo, monto, medioRow ? medioRow.id : null, cat, descripcion || '');

  if (req.body.ticket_id) {
    db.prepare("UPDATE tickets SET estado = 'completado', movimiento_id = ? WHERE id = ?").run(info.lastInsertRowid, req.body.ticket_id);
  }

  res.json({
    ok: true, id: info.lastInsertRowid, categoria: cat, medio: medioRow ? medioRow.nombre : null,
    categoria_origen: rc.origen, medio_origen: rm.origen,
    // Diagnóstico: lo que mandó realmente el Atajo
    recibido: { tipo, categoria: categoria ?? null, medio_pago: medio_pago ?? null },
  });
};
app.post('/api/movimiento', chequearApiKey, registrarMovimiento);
// Mismo registro pero para la página del celular (/registrar.html), sin API key.
app.post('/api/registrar', registrarMovimiento);

// Vista previa mientras escribís: qué categoría y medio se asignarían.
app.get('/api/sugerir', (req, res) => {
  const tipo = req.query.tipo === 'Ingreso' ? 'Ingreso' : 'Egreso';
  const d = (req.query.descripcion || '').toString();
  const rc = resolverCategoria(tipo, '', d);
  const rm = resolverMedio('', d);
  res.json({ categoria: rc.categoria, categoria_origen: rc.origen, medio: rm.medio ? rm.medio.nombre : null });
});


// ---------- Tickets (fotos para completar después) ----------
const fs = require('fs');
const DIR_TICKETS = path.join(__dirname, 'data', 'tickets');
fs.mkdirSync(DIR_TICKETS, { recursive: true });

// Lectura automática opcional: solo si definís ANTHROPIC_API_KEY en el servidor.
async function leerTicketConIA(id, base64, mediaType) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Es un ticket o comprobante de Argentina. Respondé SOLO un JSON con: {"monto": número total pagado (sin símbolo, punto decimal), "descripcion": comercio o concepto en pocas palabras, "fecha": "YYYY-MM-DD" o null}. Si no se puede leer, usá null en ese campo.' },
        ] }],
      }),
    });
    const j = await r.json();
    const txt = (j.content && j.content[0] && j.content[0].text) || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) db.prepare('UPDATE tickets SET datos_ia = ? WHERE id = ?').run(JSON.stringify(JSON.parse(m[0])), id);
  } catch (e) { console.error('Lectura de ticket falló:', e.message); }
}

app.post('/api/tickets', (req, res) => {
  const { imagen, nota } = req.body;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imagen || '');
  if (!m) return res.status(400).json({ error: 'imagen inválida' });
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  const archivo = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  fs.writeFileSync(path.join(DIR_TICKETS, archivo), Buffer.from(m[2], 'base64'));
  const info = db.prepare('INSERT INTO tickets (archivo, nota) VALUES (?, ?)').run(archivo, (nota || '').toString().slice(0, 200));
  leerTicketConIA(info.lastInsertRowid, m[2], m[1]); // en segundo plano
  res.json({ ok: true, id: info.lastInsertRowid, lectura_automatica: !!process.env.ANTHROPIC_API_KEY });
});

app.get('/api/tickets', (req, res) => {
  const estado = req.query.estado === 'completado' ? 'completado' : 'pendiente';
  res.json(db.prepare('SELECT id, nota, fecha, estado, datos_ia FROM tickets WHERE estado = ? ORDER BY id DESC LIMIT 50').all(estado)
    .map((t) => ({ ...t, datos_ia: t.datos_ia ? JSON.parse(t.datos_ia) : null })));
});

app.get('/api/tickets/:id/foto', (req, res) => {
  const t = db.prepare('SELECT archivo FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(DIR_TICKETS, t.archivo));
});

app.delete('/api/tickets/:id', (req, res) => {
  const t = db.prepare('SELECT archivo FROM tickets WHERE id = ?').get(req.params.id);
  if (t) { try { fs.unlinkSync(path.join(DIR_TICKETS, t.archivo)); } catch (e) {} }
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Últimos movimientos (para la página del celular).
app.get('/api/movimientos-recientes', (req, res) => {
  res.json(db.prepare(
    `SELECT m.id, m.tipo, m.monto, m.categoria, m.descripcion, m.fecha, mp.nombre AS medio
     FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
     ORDER BY m.id DESC LIMIT 8`).all());
});

app.put('/api/movimiento/:id', (req, res) => {
  const { tipo, monto, medio_pago, categoria, descripcion, fecha } = req.body;
  const medioRow = medio_pago ? db.prepare('SELECT id FROM medios_pago WHERE nombre = ?').get(medio_pago) : null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) db.prepare("UPDATE movimientos SET fecha = ? || substr(fecha, 11) WHERE id = ?").run(fecha, req.params.id);
  db.prepare(
    `UPDATE movimientos SET tipo = COALESCE(?, tipo), monto = COALESCE(?, monto), medio_pago_id = COALESCE(?, medio_pago_id),
     categoria = COALESCE(?, categoria), descripcion = COALESCE(?, descripcion) WHERE id = ?`
  ).run(tipo || null, monto != null ? parseFloat(monto) : null, medioRow ? medioRow.id : null, categoria || null, descripcion ?? null, req.params.id);
  aprender(req.params.id);
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
  cuotas.generarPendientes();
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : cuotas.mesDe();
  const movs = db.prepare(`
    SELECT m.*, mp.nombre as medio_nombre, mp.moneda
    FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
    WHERE strftime('%Y-%m', m.fecha) = ?
    ORDER BY m.fecha DESC, m.id DESC
  `).all(mes);

  const fijos = db.prepare(`
    SELECT gf.*, mp.nombre as medio_nombre, mp.moneda
    FROM gastos_fijos gf LEFT JOIN medios_pago mp ON mp.id = gf.medio_pago_id
    WHERE gf.activo = 1
  `).all();

  const porMoneda = {};
  const porCategoria = {};
  const porCategoriaIngreso = {};
  const porMedio = {};
  for (const m of movs) {
    const mon = m.moneda || 'ARS';
    porMoneda[mon] = porMoneda[mon] || { ingresos: 0, egresos: 0 };
    if (m.tipo === 'Ingreso') {
      porMoneda[mon].ingresos += m.monto;
      porCategoriaIngreso[m.categoria] = (porCategoriaIngreso[m.categoria] || 0) + m.monto;
    } else {
      porMoneda[mon].egresos += m.monto;
      porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + m.monto;
      const k = m.medio_nombre || 'Sin especificar';
      porMedio[k] = (porMedio[k] || 0) + m.monto;
    }
  }

  res.json({ mes, movimientos: movs, fijos, porMoneda, porCategoria, porCategoriaIngreso, porMedio });
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

extras.montar(app);
cuotas.generarPendientes();
setInterval(cuotas.generarPendientes, 1000 * 60 * 60 * 6);
extras.backupDiario();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));

iniciarBot();
iniciarRevisionDiaria();
