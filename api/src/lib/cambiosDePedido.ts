/**
 * Qué cambia una fila del archivo en un pedido que ya existe. Es lo que decide qué entra en el
 * historial (`historialPedido.ts`); aparte porque no toca la base y se prueba sola.
 */

/** Una línea del pedido tal como se lee en el historial: «90 u · 15 formatos». */
export function textoDeLinea(unidades: number, packs: number | null | undefined): string {
  const formatos = Number(packs) || 0;

  return formatos > 0 ? `${unidades} u · ${formatos} formato${formatos === 1 ? '' : 's'}` : `${unidades} u`;
}

export type Cambio = { campo: string; antes: string | null; despues: string | null };

type Linea = { producto: string; unidades: number; packs?: number | null };

/**
 * Lo que una fila del archivo cambia en la LÍNEA de su producto: cantidades distintas, o un
 * producto que el pedido no tenía. Nada si es lo mismo.
 *
 * Se compara igual que la ingesta (producto sin distinguir mayúsculas; `packs` vacío = 0),
 * porque la pregunta es la misma: ¿esta fila movería algo?
 */
export function cambioDeLinea(lineas: Linea[], nueva: Linea): Cambio | null {
  const clave = nueva.producto.toUpperCase();
  const actual = lineas.find((l) => l.producto.toUpperCase() === clave);
  const despues = textoDeLinea(nueva.unidades, nueva.packs);

  if (!actual) return { campo: nueva.producto, antes: null, despues };

  const mismoUnidades = actual.unidades === nueva.unidades;
  const mismosPacks = (actual.packs || 0) === (nueva.packs || 0);

  return mismoUnidades && mismosPacks ? null : { campo: actual.producto, antes: textoDeLinea(actual.unidades, actual.packs), despues };
}

type Cabecera = {
  fecha_comprometida?: Date | null;
  pedido_cobrado?: string | null;
  requiere_domicilio?: boolean | null;
};

const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const siNo = (b: boolean | null | undefined) => (b == null ? null : b ? 'sí' : 'no');

/**
 * Lo que una fila del archivo cambia en la CABECERA del pedido, con las mismas reglas que la
 * ingesta: la fecha comprometida sólo se mueve hacia ADELANTE, y un dato que el archivo no
 * trae no cambia nada.
 *
 * Si se cambia la regla en `processOrderRecord`, se cambia aquí: es la que decide qué se apunta.
 */
export function cambiosDeCabecera(actual: Cabecera, nueva: Cabecera): Cambio[] {
  const cambios: Cambio[] = [];

  if (nueva.fecha_comprometida && (!actual.fecha_comprometida || nueva.fecha_comprometida > actual.fecha_comprometida)) {
    cambios.push({ campo: 'Fecha comprometida', antes: dia(actual.fecha_comprometida), despues: dia(nueva.fecha_comprometida) });
  }

  if (nueva.pedido_cobrado !== undefined && (nueva.pedido_cobrado ?? null) !== (actual.pedido_cobrado ?? null)) {
    cambios.push({ campo: 'Cobro', antes: actual.pedido_cobrado ?? null, despues: nueva.pedido_cobrado ?? null });
  }

  if (nueva.requiere_domicilio !== undefined && (nueva.requiere_domicilio ?? null) !== (actual.requiere_domicilio ?? null)) {
    cambios.push({ campo: 'Domicilio', antes: siNo(actual.requiere_domicilio), despues: siNo(nueva.requiere_domicilio) });
  }

  return cambios;
}
