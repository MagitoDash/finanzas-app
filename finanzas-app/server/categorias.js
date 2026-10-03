const CATEGORIAS = {
  Comida: ['asado', 'comida', 'almuerzo', 'cena', 'delivery', 'pedidosya', 'rappi', 'super', 'supermercado', 'restaurant', 'bar', 'cafe', 'kiosco'],
  Transporte: ['uber', 'cabify', 'nafta', 'combustible', 'sube', 'taxi', 'peaje', 'estacionamiento'],
  Salidas: ['salida', 'boliche', 'previa', 'juntada', 'cine', 'entrada'],
  Hogar: ['alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet'],
  Salud: ['farmacia', 'medico', 'obra social'],
  Ropa: ['ropa', 'zapatillas'],
  Suscripcion: ['netflix', 'spotify', 'disney', 'hbo', 'youtube premium', 'suscripcion'],
};

function inferirCategoria(texto) {
  const t = (texto || '').toLowerCase();
  for (const [cat, palabras] of Object.entries(CATEGORIAS)) {
    if (palabras.some((p) => t.includes(p))) return cat;
  }
  return 'Otros';
}

// Categorías para Egreso. "Ingreso" se usa aparte para movimientos de tipo Ingreso.
const LISTA_CATEGORIAS_EGRESO = [...Object.keys(CATEGORIAS), 'Otros'];
const LISTA_CATEGORIAS_INGRESO = ['Sueldo', 'Freelance', 'Venta', 'Regalo', 'Otros'];

module.exports = { inferirCategoria, LISTA_CATEGORIAS_EGRESO, LISTA_CATEGORIAS_INGRESO };
