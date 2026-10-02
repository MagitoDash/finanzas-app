const fetch = require('node-fetch');
const db = require('./db');

async function generarResumenIA() {
  const movs = db.prepare(`
    SELECT m.tipo, m.monto, m.categoria, m.descripcion, m.fecha, mp.nombre as medio, mp.moneda
    FROM movimientos m
    LEFT JOIN medios_pago mp ON mp.id = m.medio_pago_id
    WHERE strftime('%Y-%m', m.fecha) = strftime('%Y-%m', 'now','localtime')
    ORDER BY m.fecha DESC
  `).all();

  const fijos = db.prepare(`
    SELECT gf.nombre, gf.monto, gf.categoria, mp.nombre as medio, mp.moneda
    FROM gastos_fijos gf LEFT JOIN medios_pago mp ON mp.id = gf.medio_pago_id
    WHERE gf.activo = 1
  `).all();

  if (movs.length === 0 && fijos.length === 0) {
    return 'Todavía no hay movimientos cargados este mes.';
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

  const prompt = `Sos un asistente financiero personal para alguien en Argentina. Con estos datos del mes actual, dame:
1) Un resumen breve de la situación (por moneda, no mezcles pesos y dólares).
2) 2-3 observaciones concretas (categorías o medios de pago que más pesan, gastos hormiga si se notan, uso de tarjeta vs efectivo).
3) 2-3 consejos accionables y realistas para el próximo mes.
Respondé en español, tono directo y cercano, sin rodeos, máximo 220 palabras, sin usar markdown.

Totales por moneda (ingresos/egresos): ${JSON.stringify(porMoneda)}
Egresos por categoría: ${JSON.stringify(porCategoria)}
Egresos por medio de pago: ${JSON.stringify(porMedio)}
Gastos fijos activos: ${fijos.map((f) => `${f.nombre} (${f.monto} ${f.moneda || 'ARS'})`).join(', ') || 'ninguno'}
Cantidad de movimientos: ${movs.length}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  return data.content?.map((c) => c.text || '').join('\n') || 'No pude generar el análisis.';
}

module.exports = { generarResumenIA };
