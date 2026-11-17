const crypto = require('crypto');
const db = require('./db');

const API_KEY = process.env.API_KEY;
const getCfg = (k) => (db.prepare('SELECT valor FROM config WHERE clave = ?').get(k) || {}).valor || null;
const setCfg = (k, v) => db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(k, v);

// Recuperación: si olvidás el PIN, poné PIN_RESET=1 en Dokploy, hacé Deploy, y después sacá la variable.
if (process.env.PIN_RESET === '1') {
  db.prepare("DELETE FROM config WHERE clave = 'pin_hash'").run();
  db.prepare('DELETE FROM sesiones').run();
  console.log('🔓 PIN eliminado (PIN_RESET=1). Sacá esa variable después.');
}

const hayPin = () => !!getCfg('pin_hash');
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pin, salt, 32).toString('hex');
}
function verificarPin(pin) {
  const h = getCfg('pin_hash'); if (!h) return true;
  const [salt, hash] = h.split(':');
  const x = crypto.scryptSync(String(pin || ''), salt, 32);
  const y = Buffer.from(hash, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function leerCookie(req, nombre) {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nombre + '='));
  return c ? decodeURIComponent(c.slice(nombre.length + 1)) : null;
}
function sesionValida(req) {
  const t = leerCookie(req, 'sid'); if (!t) return false;
  return !!db.prepare("SELECT 1 FROM sesiones WHERE token = ? AND creado > datetime('now','localtime','-30 days')").get(t);
}
function abrirSesion(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token) VALUES (?)').run(token);
  const seguro = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`);
}

// Freno a la fuerza bruta: 5 errores seguidos -> bloqueo de 15 minutos por IP.
const intentos = new Map();
function ipDe(req) { return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?'; }

function middleware(req, res, next) {
  if (!hayPin()) return next();
  const p = req.path;
  if (p === '/auth-estado' || p === '/login') return next();
  if (p === '/movimiento' && req.method === 'POST' && API_KEY && req.headers['x-api-key'] === API_KEY) return next(); // Atajo viejo
  if (sesionValida(req)) return next();
  res.status(401).json({ error: 'pin_requerido' });
}

function montar(app) {
  app.get('/api/auth-estado', (req, res) => res.json({ pin: hayPin(), ok: !hayPin() || sesionValida(req) }));

  app.post('/api/login', (req, res) => {
    const ip = ipDe(req), r = intentos.get(ip) || { n: 0, hasta: 0 };
    if (r.hasta > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Probá en 15 minutos.' });
    if (!verificarPin(req.body.pin)) {
      r.n++; if (r.n >= 5) { r.hasta = Date.now() + 15 * 60 * 1000; r.n = 0; }
      intentos.set(ip, r);
      return res.status(401).json({ error: 'PIN incorrecto' });
    }
    intentos.delete(ip); abrirSesion(req, res); res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const t = leerCookie(req, 'sid'); if (t) db.prepare('DELETE FROM sesiones WHERE token = ?').run(t);
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true });
  });

  // Crear o cambiar el PIN (si ya hay uno, hay que mandar el actual)
  app.post('/api/pin', (req, res) => {
    const { pin, actual } = req.body;
    if (!/^\d{4,8}$/.test(String(pin || ''))) return res.status(400).json({ error: 'El PIN tiene que ser de 4 a 8 números' });
    if (hayPin() && !verificarPin(actual)) return res.status(401).json({ error: 'El PIN actual no coincide' });
    setCfg('pin_hash', hashPin(String(pin)));
    db.prepare('DELETE FROM sesiones').run();   // cierra las demás sesiones
    abrirSesion(req, res); res.json({ ok: true });
  });

  app.delete('/api/pin', (req, res) => {
    if (hayPin() && !verificarPin(req.body && req.body.actual)) return res.status(401).json({ error: 'El PIN actual no coincide' });
    db.prepare("DELETE FROM config WHERE clave = 'pin_hash'").run(); db.prepare('DELETE FROM sesiones').run();
    res.json({ ok: true });
  });
}

module.exports = { middleware, montar };
