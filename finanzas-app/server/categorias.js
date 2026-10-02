const CATEGORIAS = {
  Comida: ['asado', 'comida', 'almuerzo', 'cena', 'delivery', 'pedidosya', 'rappi', 'super', 'supermercado', 'restaurant', 'bar', 'cafe', 'kiosco'],
  Transporte: ['uber', 'cabify', 'nafta', 'combustible', 'sube', 'taxi', 'peaje', 'estacionamiento'],
  Salidas: ['salida', 'boliche', 'previa', 'juntada', 'cine', 'entrada'],
  Hogar: ['alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet'],
  Salud: ['farmacia', 'medico', 'obra social'],
  Ropa: ['ropa', 'zapatillas'],
};

function inferirCategoria(texto) {
  const t = (texto || '').toLowerCase();
  for (const [cat, palabras] of Object.entries(CATEGORIAS)) {
    if (palabras.some((p) => t.includes(p))) return cat;
  }
  return 'Otros';
}

const LISTA_CATEGORIAS = [...Object.keys(CATEGORIAS), 'Ingreso', 'Otros'];

module.exports = { inferirCategoria, LISTA_CATEGORIAS };
