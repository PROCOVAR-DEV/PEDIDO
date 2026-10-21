/**
 * Qué clientes de PEDIDO siguen vivos en Parranda y cuáles ya no.
 *
 * # El problema
 *
 * Parranda desactiva a un cliente DEJANDO DE MANDARLO: no hay un campo «activo». PEDIDO no lo
 * sabía y los seguía teniendo como vivos —1.157 en siete sucursales el 13/10/2026—, y se los
 * seguía dando al reparto. Peor: cuando Parranda RENOMBRA a un cliente (le pone «V3» para
 * distinguirlo) pero conserva su código, el nombre nuevo no casa con la ficha vieja, y quedan
 * DOS fichas: la vieja, con el código y sin uso, y la nueva, que es la que usan los
 * vendedores, sin código. Es lo que se veía con DAGMARIS ZAMBRANA MATOS.
 *
 * # La regla
 *
 * Cada fila de Parranda RECLAMA una sola ficha: la que casa por NOMBRE; sólo si no hay ninguna
 * con ese nombre, la que tiene su CÓDIGO (Parranda renombró sin que nadie creara otra). Así la
 * ficha vieja con el código, teniendo ya otra con el nombre nuevo, no la reclama nadie y queda
 * inactiva. Y el código se le pasa a la ficha viva.
 *
 * Sólo se desactiva a quien TIENE código de Parranda: el cliente que nació de un pedido y
 * nunca estuvo en Parranda no tiene por qué aparecer en su lista. Y sólo en las sucursales
 * cuya provincia llegó en esta pasada: Palma Soriano, Granma y Moa no vienen nunca y no
 * pueden quedar inactivas por eso.
 *
 * Puro, sin base de datos, para poder probarlo.
 */
export type ClienteBase = { id: string; nombre: string; sucursalId: string | null; codigo: string | null; activo: boolean; sucesorId?: string | null; bajaManual?: boolean };
export type FilaDeParranda = { sucursalId: string; nombre: string; codigo: string | null };

export type DecisionActivos = {
  desactivar: string[];
  reactivar: string[];
  /** El código pasa de una ficha inactiva a la ficha viva que Parranda ya nombra con él. */
  codigosMovidos: Array<{ de: string; para: string; codigo: string }>;
  avisos: string[];
};

/**
 * De dos fichas con el MISMO nombre normalizado (tildes, mayúsculas y signos aparte), cuál es la
 * buena: la activa, y entre iguales la que tiene código. Sin esto un mapa por nombre se queda con
 * la última que vio, y la ficha inactiva y sin código podía ganarle a la viva.
 */
export function esMejorFicha(a: { activo: boolean; codigo: string | null }, b: { activo: boolean; codigo: string | null }): boolean {
  if (a.activo !== b.activo) return a.activo;

  return !!a.codigo && !b.codigo;
}

export const MIN_FILAS_POR_SUCURSAL = 50;
// Si una pasada quisiera desactivar a más de esta fracción de los clientes con código de una
// sucursal, es casi seguro un fallo de Parranda (una página vacía, un filtro) y no cientos de
// bajas: no se toca esa sucursal y se avisa.
export const MAX_FRACCION_FUERA = 0.4;

export function decidirActivos(
  existentes: ClienteBase[],
  feed: FilaDeParranda[],
  norm: (s: string) => string,
  // Fichas que recibieron un pedido hace poco. Una ficha en uso no se desactiva sólo porque
  // Parranda no la mande: entra un pedido, la ingesta la reactiva, y si el sync de la tarde la
  // volviera a apagar estaría encendiéndose y apagándose cada día. Sólo cede si OTRA ficha viva
  // ya lleva su código (la vieja de un renombre: ésa sí se desactiva, tenga pedidos o no).
  conPedidoReciente: ReadonlySet<string> = new Set(),
): DecisionActivos {
  const porNombre = new Map<string, ClienteBase>();
  const porCodigo = new Map<string, ClienteBase>();

  for (const c of existentes) {
    if (!c.sucursalId) continue;
    const k = `${c.sucursalId}|${norm(c.nombre)}`;
    const previa = porNombre.get(k);
    if (!previa || esMejorFicha(c, previa)) porNombre.set(k, c);
    if (c.codigo) porCodigo.set(`${c.sucursalId}|${c.codigo}`, c);
  }

  const codigosDelFeed = new Set(feed.flatMap((f) => (f.codigo ? [`${f.sucursalId}|${f.codigo}`] : [])));
  // El código de esta ficha ¿lo sigue mandando Parranda? Si no, está caducado.
  const codigoVigente = (c: ClienteBase) => !!c.codigo && codigosDelFeed.has(`${c.sucursalId}|${c.codigo}`);

  const vistos = new Set<string>();
  const filasPorSucursal = new Map<string, number>();
  const conflictos: Array<{ quiere: ClienteBase; dueno: ClienteBase; codigo: string }> = [];

  for (const f of feed) {
    filasPorSucursal.set(f.sucursalId, (filasPorSucursal.get(f.sucursalId) ?? 0) + 1);

    const porNom = porNombre.get(`${f.sucursalId}|${norm(f.nombre)}`);
    const dueno = f.codigo ? porCodigo.get(`${f.sucursalId}|${f.codigo}`) : undefined;

    // El nombre solo reclama una ficha que lleve OTRO código si ese código ya caducó: Parranda
    // tiene clientes distintos con el mismo nombre (dos «Los Hermanos», 0289 y 0290), y la
    // segunda fila no puede quedarse con la ficha de la primera dejando sin reclamar al dueño
    // de su código. En cambio, si el código de la ficha ya no viene, la ficha viva es ésta.
    const nombreVale = porNom && (!dueno || dueno.id === porNom.id || !codigoVigente(porNom));

    if (porNom && nombreVale) {
      vistos.add(porNom.id);
      // Parranda dice que ESTE nombre lleva ese código, y lo tiene otra ficha: es la vieja.
      if (dueno && dueno.id !== porNom.id && f.codigo) conflictos.push({ quiere: porNom, dueno, codigo: f.codigo });
    } else if (dueno) {
      vistos.add(dueno.id);
    } else if (porNom) {
      // Mismo nombre y OTRO código que nadie tiene: Parranda lo recodificó. No se desactiva.
      vistos.add(porNom.id);
    }
  }

  const avisos: string[] = [];
  const desactivar: string[] = [];
  const reactivar: string[] = [];
  const quitarDe = new Set<string>();
  const superados = new Set(conflictos.map((x) => x.dueno.id));

  for (const [sucursalId, n] of filasPorSucursal) {
    if (n < MIN_FILAS_POR_SUCURSAL) {
      avisos.push(`Sucursal ${sucursalId}: Parranda sólo mandó ${n} filas; no se desactiva a nadie (hace falta un mínimo de ${MIN_FILAS_POR_SUCURSAL}).`);
      continue;
    }

    const conCodigo = existentes.filter((c) => c.sucursalId === sucursalId && c.codigo);
    const fuera = conCodigo.filter((c) => !vistos.has(c.id));

    if (conCodigo.length > 0 && fuera.length / conCodigo.length > MAX_FRACCION_FUERA) {
      avisos.push(
        `Sucursal ${sucursalId}: faltan ${fuera.length} de ${conCodigo.length} clientes con código (más del ` +
          `${Math.round(MAX_FRACCION_FUERA * 100)} %): parece un fallo de Parranda, no se desactiva a nadie.`,
      );
      continue;
    }

    for (const c of fuera) {
      quitarDe.add(c.id);
      if (c.activo && !(conPedidoReciente.has(c.id) && !superados.has(c.id))) desactivar.push(c.id);
    }
  }

  // Vuelve el que Parranda volvió a mandar, y el que está en uso (pedido reciente) aunque no la mande.
  // Pero NO una ficha vieja con sucesora —su pedido va a la viva— ni la que cede su código a otra:
  // reactivarlas traería de vuelta los duplicados.
  for (const c of existentes) {
    if (c.activo) continue;
    // Dado de baja a mano: Parranda lo siga mandando o no, no vuelve solo.
    if (c.bajaManual) continue;
    const enUso = conPedidoReciente.has(c.id) && !c.sucesorId && !superados.has(c.id);
    if (vistos.has(c.id) || enUso) reactivar.push(c.id);
  }

  const codigosMovidos = conflictos
    .filter((x) => quitarDe.has(x.dueno.id) && !codigoVigente(x.quiere))
    .map((x) => ({ de: x.dueno.id, para: x.quiere.id, codigo: x.codigo }));

  return { desactivar, reactivar, codigosMovidos, avisos };
}
