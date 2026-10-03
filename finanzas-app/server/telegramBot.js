const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const { inferirCategoria } = require('./categorias');
const { generarPromptAnalisis } = require('./promptAnalisis');
const { calcularSaldos } = require('./saldos');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID_PERMITIDO = process.env.TELEGRAM_CHAT_ID;

function parsearMensaje(texto) {
  const match = texto.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const monto = parseFloat(match[1].replace(',', '.'));
  const descripcion = texto.replace(match[0], '').trim() || 'sin descripción';
  const categoria = inferirCategoria(descripcion);
  return { monto, descripcion, categoria };
}

function medioEfectivoId() {
  const row = db.prepare(`SELECT id FROM medios_pago WHERE nombre = 'Efectivo' LIMIT 1`).get();
  return row ? row.id : null;
}

function iniciarBot() {
  if (!TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN no configurado, el bot no se inicia.');
    return null;
  }
  const bot = new TelegramBot(TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '👋 Registrame un gasto en efectivo mandando algo como: "1500 asado con amigos"\n' +
      '(para tarjetas o dólares, usá el Atajo de iPhone o el dashboard)\n\n' +
      '/hoy — total gastado hoy\n' +
      '/mes — total gastado este mes\n' +
      '/saldos — cuánta plata tenés en cada medio\n' +
      '/resumen — texto para pegar en una IA y que te analice el mes'
    );
  });

  bot.onText(/\/hoy/, (msg) => {
    const row = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM movimientos WHERE tipo='Egreso' AND date(fecha) = date('now','localtime')`).get();
    bot.sendMessage(msg.chat.id, `📅 Gastado hoy: $${row.total.toFixed(2)}`);
  });

  bot.onText(/\/mes/, (msg) => {
    const row = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM movimientos WHERE tipo='Egreso' AND strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now','localtime')`).get();
    bot.sendMessage(msg.chat.id, `📊 Gastado este mes: $${row.total.toFixed(2)}`);
  });

  bot.onText(/\/saldos/, (msg) => {
    const saldos = calcularSaldos();
    const texto = saldos.map((s) => `${s.nombre}: $${s.saldo.toFixed(2)} ${s.moneda}`).join('\n');
    bot.sendMessage(msg.chat.id, `💳 Saldos:\n${texto}`);
  });

  bot.onText(/\/resumen/, (msg) => {
    const prompt = generarPromptAnalisis();
    bot.sendMessage(msg.chat.id, `Copiá este texto y pegalo en tu IA favorita:\n\n${prompt}`);
  });

  bot.on('message', (msg) => {
    const texto = msg.text;
    if (!texto || texto.startsWith('/')) return;
    if (CHAT_ID_PERMITIDO && String(msg.chat.id) !== String(CHAT_ID_PERMITIDO)) return;

    const parsed = parsearMensaje(texto);
    if (!parsed) return bot.sendMessage(msg.chat.id, 'No entendí el monto 🤔. Probá: "1500 asado"');

    db.prepare(
      `INSERT INTO movimientos (tipo, monto, medio_pago_id, categoria, descripcion, origen) VALUES ('Egreso', ?, ?, ?, ?, 'telegram')`
    ).run(parsed.monto, medioEfectivoId(), parsed.categoria, parsed.descripcion);

    bot.sendMessage(msg.chat.id, `✅ Egreso registrado: $${parsed.monto} — ${parsed.categoria} (${parsed.descripcion}) — Efectivo`);
  });

  console.log('🤖 Bot de Telegram iniciado');
  return bot;
}

module.exports = { iniciarBot };
