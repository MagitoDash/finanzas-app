// Clasificación automática: diccionario de palabras (con tolerancia a errores de tipeo)
// + reglas aprendidas de las correcciones que hacés en la web (ver index.js).

const CATEGORIAS = {
  Comida: ['asado', 'comida', 'almuerzo', 'cena', 'desayuno', 'merienda', 'delivery', 'pedidosya', 'rappi', 'super', 'supermercado',
    'carrefour', 'coto', 'jumbo', 'changomas', 'verduleria', 'carniceria', 'panaderia', 'almacen', 'restaurant', 'restaurante',
    'resto', 'cafe', 'cafeteria', 'kiosco', 'pizza', 'empanadas', 'hamburguesa', 'burger', 'mcdonalds', 'mostaza', 'burgerking',
    'sushi', 'milanesa', 'helado', 'facturas', 'medialunas', 'sanguche', 'tostado', 'fiambre', 'bebida'],
  Transporte: ['uber', 'cabify', 'didi', 'nafta', 'combustible', 'ypf', 'shell', 'axion', 'sube', 'colectivo', 'bondi', 'subte',
    'tren', 'taxi', 'remis', 'peaje', 'estacionamiento', 'cochera', 'patente', 'mecanico', 'gomeria', 'vtv'],
  Salidas: ['salida', 'salidas', 'boliche', 'previa', 'juntada', 'cine', 'entrada', 'recital', 'teatro', 'bar', 'birra', 'cerveza',
    'fernet', 'trago', 'tragos', 'joda', 'fiesta', 'after'],
  Hogar: ['alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet', 'wifi', 'edenor', 'edesur', 'metrogas', 'aysa', 'abl', 'cable',
    'limpieza', 'plomero', 'electricista', 'ferreteria', 'muebles', 'arreglo', 'reparacion', 'telefono', 'claro', 'movistar'],
  Salud: ['farmacia', 'medico', 'doctor', 'dentista', 'odontologo', 'obra social', 'prepaga', 'osde', 'swiss', 'medicus',
    'psicologo', 'kinesiologo', 'analisis', 'remedio', 'medicamento', 'gimnasio', 'gym'],
  Ropa: ['ropa', 'zapatillas', 'remera', 'pantalon', 'campera', 'zapatos', 'jean', 'buzo', 'vestido'],
  Suscripcion: ['netflix', 'spotify', 'disney', 'hbo', 'max', 'youtube', 'youtube premium', 'prime', 'icloud', 'chatgpt', 'claude',
    'suscripcion', 'membresia', 'crunchyroll', 'paramount', 'twitch'],
  Ecofusion: ['ecofusion', 'impresion', 'filamento', 'petg', 'pla', 'chapa', 'plegado', 'insumos'],
};

const CATEGORIAS_INGRESO = {
  Sueldo: ['sueldo', 'salario', 'aguinaldo', 'quincena', 'haberes', 'recibo'],
  Freelance: ['freelance', 'freelancer', 'trabajo', 'proyecto', 'cliente', 'honorarios', 'changa'],
  Venta: ['venta', 'ventas', 'vendi', 'vendido', 'mercadolibre', 'ml'],
  Regalo: ['regalo', 'cumple', 'cumpleanos', 'premio'],
};

// ---- utilidades de texto ----
const norm = (t) => (t || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const squeeze = (t) => t.replace(/(.)\1+/g, '$1'); // "comiiiida" -> "comida"
const tokens = (t) => squeeze(norm(t)).split(/[^a-z0-9]+/).filter(Boolean);
// Clave estable de una descripción (para reglas aprendidas)
const claveDe = (t) => tokens(t).join(' ');

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function coincide(tokensTexto, textoPlano, palabra) {
  const p = squeeze(norm(palabra));
  if (p.includes(' ')) return textoPlano.includes(p); // frases: "obra social"
  return tokensTexto.some((t) =>
    t === p ||
    (p.length >= 4 && t.length >= p.length && t.startsWith(p)) ||        // plurales: "farmacias"
    (p.length >= 5 && t.length >= 5 && distancia(t, p) <= 1)             // errores de tipeo: "farmasia"
  );
}

function buscarEn(diccionario, texto) {
  const toks = tokens(texto);
  const plano = toks.join(' ');
  if (!toks.length) return null;
  for (const [cat, palabras] of Object.entries(diccionario)) {
    if (palabras.some((p) => coincide(toks, plano, p))) return cat;
  }
  return null;
}

function inferirCategoria(texto, tipo = 'Egreso') {
  return buscarEn(tipo === 'Ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS, texto) || 'Otros';
}

const LISTA_CATEGORIAS_EGRESO = [...Object.keys(CATEGORIAS), 'Otros'];
const LISTA_CATEGORIAS_INGRESO = [...Object.keys(CATEGORIAS_INGRESO), 'Otros'];

module.exports = { inferirCategoria, claveDe, norm, tokens, LISTA_CATEGORIAS_EGRESO, LISTA_CATEGORIAS_INGRESO };
