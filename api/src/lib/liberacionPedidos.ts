import { diaEnCuba, inicioDelDia, minutosEnCuba } from './diaCubano';

/**
 * Liberación de pedidos por hora: cuándo se hace VISIBLE un pedido para facturación.
 *
 * Lo decide la FECHA del pedido (la que trae el CSV), no la hora de subida:
 *
 *   fecha de ayer o antes, entra antes de `ayerHasta`  → visible ya
 *   fecha de hoy (o futura), entra antes de `hoyDesde` → visible a las `hoyDesde`
 *   fecha de ayer o antes, entra entre las dos horas   → visible a las `hoyDesde`
 *   cualquier fecha, entra pasada `hoyDesde`           → visible ya
 *
 * Todo en hora de Cuba. Puro: sin base de datos, para poder probarlo entero.
 */
export type ReglaLiberacion = {
  activa: boolean;
  /** Minutos del día en Cuba hasta los que se aceptan pedidos de días anteriores (510 = 8:30). */
  ayerHasta: number;
  /** Minutos del día en Cuba a los que se liberan los de hoy (900 = 15:00). */
  hoyDesde: number;
};

export const REGLA_APAGADA: ReglaLiberacion = { activa: false, ayerHasta: 510, hoyDesde: 900 };

/** Desde cuándo es visible el pedido; `null` = ya lo es. */
export function visibleDesde(fecha: Date, ahora: Date, regla: ReglaLiberacion): Date | null {
  if (!regla.activa) return null;

  const hoy = diaEnCuba(ahora);
  const inicio = inicioDelDia(hoy);

  if (!inicio) return null;

  const liberacion = new Date(inicio.getTime() + regla.hoyDesde * 60_000);

  if (ahora.getTime() >= liberacion.getTime()) return null;

  const deDiaAnterior = diaEnCuba(fecha) < hoy;

  if (deDiaAnterior && minutosEnCuba(ahora) < regla.ayerHasta) return null;

  return liberacion;
}

/** `"08:30"` → 510. `null` si no es una hora válida. */
export function minutosDeHora(hhmm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());

  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);

  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 510 → `"08:30"`. */
export function horaDeMinutos(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Lo que ve facturación: lo no retenido o ya liberado. Para un `where` de Prisma. */
export const soloVisibles = (ahora: Date = new Date()) => ({
  OR: [{ visibleDesde: null }, { visibleDesde: { lte: ahora } }],
});
