const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'finanzas.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS medios_pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,              -- Ingreso | Egreso
  monto REAL NOT NULL,
  medio_pago_id INTEGER,
  categoria TEXT NOT NULL DEFAULT 'Otros',
  descripcion TEXT,
  origen TEXT NOT NULL DEFAULT 'shortcut',
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id)
);

CREATE TABLE IF NOT EXISTS gastos_fijos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  monto REAL NOT NULL,
  medio_pago_id INTEGER,
  categoria TEXT NOT NULL DEFAULT 'Suscripcion',
  dia_cobro INTEGER NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  ultimo_periodo TEXT,
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id)
);

CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  objetivo_monto REAL,
  fecha_objetivo TEXT,
  moneda TEXT NOT NULL DEFAULT 'ARS',
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo TEXT NOT NULL,
  nota TEXT DEFAULT '',
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | completado
  datos_ia TEXT,                              -- JSON leído automáticamente del ticket (opcional)
  movimiento_id INTEGER
);


CREATE TABLE IF NOT EXISTS presupuestos ( categoria TEXT PRIMARY KEY, monto REAL NOT NULL );

CREATE TABLE IF NOT EXISTS frecuentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Egreso',
  descripcion TEXT DEFAULT '',
  medio_pago_id INTEGER,
  categoria TEXT DEFAULT '',
  monto REAL
);

CREATE TABLE IF NOT EXISTS planes_cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descripcion TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Otros',
  medio_pago_id INTEGER,
  monto_total REAL NOT NULL,
  cuotas_total INTEGER NOT NULL,
  monto_cuota REAL NOT NULL,
  primer_mes TEXT NOT NULL,          -- YYYY-MM de la cuota 1
  dia INTEGER NOT NULL DEFAULT 1,
  generadas INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS config ( clave TEXT PRIMARY KEY, valor TEXT );
CREATE TABLE IF NOT EXISTS sesiones ( token TEXT PRIMARY KEY, creado TEXT NOT NULL DEFAULT (datetime('now','localtime')) );

CREATE TABLE IF NOT EXISTS reglas_categoria ( clave TEXT NOT NULL, tipo TEXT NOT NULL, categoria TEXT NOT NULL, PRIMARY KEY (clave, tipo) );
CREATE TABLE IF NOT EXISTS movimientos_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,               -- Aporte | Retiro
  monto REAL NOT NULL,
  medio_pago_id INTEGER,
  descripcion TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (reserva_id) REFERENCES reservas(id),
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id)
);
`);


// Migraciones: tipo de medio (efectivo/débito/crédito/billetera) y días de cierre/vencimiento
const colsMedios = db.prepare('PRAGMA table_info(medios_pago)').all().map((c) => c.name);
if (!colsMedios.includes('tipo_medio')) db.exec("ALTER TABLE medios_pago ADD COLUMN tipo_medio TEXT NOT NULL DEFAULT 'otro'");
if (!colsMedios.includes('dia_cierre')) db.exec('ALTER TABLE medios_pago ADD COLUMN dia_cierre INTEGER');
if (!colsMedios.includes('dia_venc')) db.exec('ALTER TABLE medios_pago ADD COLUMN dia_venc INTEGER');

function inferirTipoMedio(nombre) {
  const n = (nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/credito|visa|master|amex|naranja|cencosud/.test(n) && !/debito/.test(n)) return 'credito';
  if (/debito/.test(n)) return 'debito';
  if (/efectivo|dolar/.test(n)) return 'efectivo';
  if (/mercado ?pago|uala|cocos|billetera|brubank/.test(n)) return 'billetera';
  return 'otro';
}
db.inferirTipoMedio = inferirTipoMedio;

// Medios de pago iniciales, solo si la tabla está vacía (no pisa los 13 que ya cargó el usuario)
const count = db.prepare('SELECT COUNT(*) as n FROM medios_pago').get().n;
if (count === 0) {
  const insertar = db.prepare('INSERT INTO medios_pago (nombre, moneda) VALUES (?, ?)');
  insertar.run('Efectivo', 'ARS');
  insertar.run('Dólares', 'USD');
}

for (const m of db.prepare("SELECT id, nombre FROM medios_pago WHERE tipo_medio = 'otro'").all()) {
  const t = inferirTipoMedio(m.nombre);
  if (t !== 'otro') db.prepare('UPDATE medios_pago SET tipo_medio = ? WHERE id = ?').run(t, m.id);
}

module.exports = db;
