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

// Medios de pago iniciales, solo si la tabla está vacía (no pisa los 13 que ya cargó el usuario)
const count = db.prepare('SELECT COUNT(*) as n FROM medios_pago').get().n;
if (count === 0) {
  const insertar = db.prepare('INSERT INTO medios_pago (nombre, moneda) VALUES (?, ?)');
  insertar.run('Efectivo', 'ARS');
  insertar.run('Dólares', 'USD');
}

module.exports = db;
