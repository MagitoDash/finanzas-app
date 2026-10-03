const db = require('./db');
const { calcularSaldos, calcularSaldoReservas } = require('./saldos');

// Genera un texto listo para copiar y pegar en cualquier IA (Claude, ChatGPT, etc.)
// Así el usuario no necesita pagar una API propia para el análisis mensual.
function generarPromptAnalisis() {
  const movs = db.prepare(`
    SELECT m.tipo, m.monto, m.categoria, m.descripcion, m.fecha, mp.nombre as medio, mp.moneda
    FROM movimientos m LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
    WHERE strftime('%Y-%m', m.fecha) = strftime('%Y-%m', 'now','localtime')
    ORDER BY m.fecha ASC
  `).all();

  const fijos = db.prepare(`
    SELECT gf.nombre, gf.monto, gf.categoria, mp.nombre as medio, mp.moneda
    FROM gastos_fijos gf LEFT JOIN medios_pago mp ON mp.id = gf.medio_pago_id
    WHERE gf.activo = 1
  `).all();

  const saldos = calcularSaldos();
  const reservas = calcularSaldoReservas();

  if (movs.length === 0 && fijos.length === 0) {
    return 'Todavía no hay movimientos cargados este mes. Cargá algunos gastos o ingresos primero.';
  }

  const porMoneda = {};
  for (const m of movs) {
    const mon = m.moneda || 'ARS';
    porMoneda[mon] = porMoneda[mon] || { ingresos: 0, egresos: 0 };
    if (m.tipo === 'Ingreso') porMoneda[mon].ingresos += m.monto;
    else porMoneda[mon].egresos += m.monto;
  }

  const porCategoria = {};
  for (const m of movs) {
    if (m.tipo !== 'Egreso') continue;
    porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + m.monto;
  }

  const porMedio = {};
  for (const m of movs) {
    if (m.tipo !== 'Egreso') continue;
    const k = m.medio || 'Sin especificar';
    porMedio[k] = (porMedio[k] || 0) + m.monto;
  }

  const lineasMov = movs.map(
    (m) => `${m.fecha} | ${m.tipo} | $${m.monto} | ${m.categoria} | ${m.medio || '-'} (${m.moneda || 'ARS'}) | ${m.descripcion || ''}`
  ).join('\n');

  const lineasFijos = fijos.map((f) => `${f.nombre}: $${f.monto} ${f.moneda || 'ARS'} (${f.categoria}, medio: ${f.medio || '-'})`).join('\n') || 'Ninguno';
  const lineasSaldos = saldos.map((s) => `${s.nombre}: $${s.saldo} ${s.moneda}`).join('\n') || 'Sin datos';
  const lineasReservas = reservas.map((r) => `${r.nombre}: $${r.saldo} ${r.moneda}${r.objetivo_monto ? ` (meta: $${r.objetivo_monto})` : ''} — ${r.descripcion || 'sin descripción'}`).join('\n') || 'Ninguna';

  return `Actuá como un asistente financiero personal. Te paso mis datos financieros del mes actual (Argentina). Quiero que me des:
1) Un resumen breve de mi situación este mes, separando pesos (ARS) y dólares (USD) sin mezclarlos.
2) 2-3 observaciones concretas: qué categorías o medios de pago pesan más, si hay gastos hormiga, cómo estoy usando tarjeta vs efectivo.
3) 2-3 consejos accionables y realistas para el próximo mes.
4) Tu opinión sobre cómo estoy manejando mis reservas/ahorros, si corresponde.
Respondé en español, tono directo y cercano, sin vueltas.

=== TOTALES POR MONEDA (ingresos/egresos este mes) ===
${JSON.stringify(porMoneda, null, 2)}

=== EGRESOS POR CATEGORÍA (este mes) ===
${JSON.stringify(porCategoria, null, 2)}

=== EGRESOS POR MEDIO DE PAGO (este mes) ===
${JSON.stringify(porMedio, null, 2)}

=== GASTOS FIJOS / SUSCRIPCIONES ACTIVAS ===
${lineasFijos}

=== SALDO ACTUAL POR MEDIO DE PAGO ===
${lineasSaldos}

=== RESERVAS / AHORROS ===
${lineasReservas}

=== DETALLE DE MOVIMIENTOS DEL MES ===
${lineasMov}`;
}

module.exports = { generarPromptAnalisis };
