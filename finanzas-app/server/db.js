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
  moneda TEXT NOT NULL DEFAULT 'ARS', -- ARS | USD
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,              -- Ingreso | Egreso
  monto REAL NOT NULL,
  medio_pago_id INTEGER,
  categoria TEXT NOT NULL DEFAULT 'Otros',
  descripcion TEXT,
  origen TEXT NOT NULL DEFAULT 'shortcut', -- shortcut | telegram | web
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
  ultimo_periodo TEXT,             -- 'YYYY-MM' del último mes ya agregado
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id)
);
`);

// Medios de pago iniciales, solo si la tabla está vacía
const count = db.prepare('SELECT COUNT(*) as n FROM medios_pago').get().n;
if (count === 0) {
  const insertar = db.prepare('INSERT INTO medios_pago (nombre, moneda) VALUES (?, ?)');
  insertar.run('Efectivo', 'ARS');
  insertar.run('Dólares', 'USD');
}

module.exports = db;
