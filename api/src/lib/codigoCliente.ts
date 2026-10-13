/**
 * El código de cliente que trae una fila del archivo de pedidos.
 *
 * Cada fila de los archivos que suben los vendedores lleva el código de Parranda del cliente
 * (`CM01TCP0397`). Esta función sólo aceptaba números, de cuando el archivo traía otro id, así
 * que tiraba el 86 % de los códigos y el cliente entraba SIN código: se quedaba esperando a que
 * el sync de la tarde lo casara por nombre, y los que Parranda no manda (Granma, Palma, Moa)
 * no lo recibían nunca.
 *
 * Se acepta el formato de Parranda —dos letras, dos cifras, tres letras, cuatro cifras— con el
 * `-DUP-n` con que Parranda marca a sus duplicados (el sync los guarda igual: hay 119), y el
 * numérico de siempre. «NO CREADO» (el cliente aún no existe en Parranda) y cualquier otra cosa
 * no son un código: null, como antes.
 */
const FORMATO_PARRANDA = /^[A-Z]{2}\d{2}[A-Z]{3}\d{4}(?:-DUP-\d+)?$/;

export function codigoDeCliente(crudo: unknown): string | null {
  if (crudo == null) return null;

  const texto = String(crudo).trim().toUpperCase();

  return /^\d+$/.test(texto) || FORMATO_PARRANDA.test(texto) ? texto : null;
}
