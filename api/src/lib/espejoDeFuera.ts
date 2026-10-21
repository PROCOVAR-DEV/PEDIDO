/**
 * Clientes del CRM y vendedores de Accesos, espejados aquí.
 *
 * Decisión de Jose (21/10/2026): PEDIDO deja de ser el dueño de los clientes (son del CRM,
 * con sus PV) y de los vendedores (son las personas de Accesos con su `codigoVendedor`).
 * PEDIDO los LEE de allí y los guarda en sus tablas de siempre, porque los pedidos, el
 * cotejo, los informes y el alcance del gestor cuelgan de esas filas. Nada se borra.
 *
 * Dos interruptores, apagados por defecto (sin ellos todo sigue como antes):
 *   CLIENTES_DESDE_CRM=1        con CRM_URL y CRM_TOKEN (Bearer, red interna):
 *                               GET {CRM_URL}/api/v1/integracion/clientes, incremental.
 *   VENDEDORES_DESDE_ACCESOS=1  con QB_AUTH_URL, QB_AUTH_CLIENT_ID, QB_AUTH_SIGNING_KEY y
 *                               QB_AUTH_KEY_VERSION: POST /api/service/members, firmado.
 * Corre en el worker cada ESPEJO_CADA_MIN minutos (5 por defecto).
 *
 * Convive con los CSV de Retool/n8n: la ingesta sigue creando el cliente o el vendedor que
 * no encuentra (queda sin crmId/accesosId, «sólo de aquí»), y el espejo lo adopta cuando el
 * CRM o Accesos lo traen (por PED-<id>, código CCSA o nombre; por código de vendedor).
 * Ver docs/pedido-clientes-y-vendedores-fuera.md (carpeta docs de Procovar).
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { nombreComparable } from './nombreVendedor';

async function base() {
  return (await import('../prismaClient')).default;
}

export const clientesDesdeCrm = (env: NodeJS.ProcessEnv = process.env) => env.CLIENTES_DESDE_CRM === '1';
export const vendedoresDesdeAccesos = (env: NodeJS.ProcessEnv = process.env) => env.VENDEDORES_DESDE_ACCESOS === '1';

const esUnicoRepetido = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

// ─── Clientes del CRM ────────────────────────────────────────────────────────

export interface PvCrm {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  activo: boolean;
  borrado: boolean;
}

export interface ClienteCrm {
  id: string;
  codigo: string;
  codigo_ccsa: string | null;
  nombre: string;
  sucursal: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  telefono: string | null;
  codigo_vendedor: string | null;
  activo: boolean;
  borrado: boolean;
  row_version: number;
  puntos_venta: PvCrm[];
}

type Pedir = (url: string, init?: RequestInit) => Promise<Response>;

/** Todas las páginas del CRM desde `desde`. Devuelve los clientes y el cursor nuevo. */
export async function traerClientesDelCrm(
  desde: number,
  env: NodeJS.ProcessEnv = process.env,
  pedir: Pedir = fetch,
): Promise<{ clientes: ClienteCrm[]; cursor: number }> {
  const url = (env.CRM_URL || '').trim().replace(/\/+$/, '');
  const token = (env.CRM_TOKEN || '').trim();
  if (!url || !token) throw new Error('CLIENTES_DESDE_CRM=1 sin CRM_URL o CRM_TOKEN');
  const clientes: ClienteCrm[] = [];
  let cursor = desde;
  for (let vuelta = 0; vuelta < 1000; vuelta++) {
    const r = await pedir(`${url}/api/v1/integracion/clientes?limite=1000&desde_row_version=${cursor}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`CRM contestó ${r.status} en /integracion/clientes`);
    const p = (await r.json()) as { clientes: ClienteCrm[]; siguiente_row_version: number; hay_mas: boolean };
    clientes.push(...p.clientes);
    cursor = p.siguiente_row_version;
    if (!p.hay_mas) break;
  }
  return { clientes, cursor };
}

/** Lo que se sabe de la ficha local para no pisar lo que sólo vive aquí. */
export interface FichaLocal {
  activo: boolean;
  bajaManual: boolean;
  geoFuente: string | null;
  latitud: number | null;
  longitud: number | null;
}

/**
 * Los campos que el CRM manda sobre la ficha local. No toca lo que sólo existe aquí
 * (baja manual, vendedor asignado a mano, distancia, sucesor) y no pisa con vacío lo que
 * el CRM no trae. La ubicación corregida por la APK de domicilio (`geoFuente='apk'`) se
 * respeta: la puso quien fue al sitio.
 */
export function datosDeClienteCrm(c: ClienteCrm, local: FichaLocal | null): Record<string, unknown> {
  const pv = c.puntos_venta.find((p) => p.activo && !p.borrado) ?? null;
  const conGeo = c.latitud != null && c.longitud != null ? c : pv && pv.latitud != null && pv.longitud != null ? pv : null;
  const activo = c.activo && !c.borrado && !local?.bajaManual;
  const d: Record<string, unknown> = { crmId: c.id, nombre: nombreComparable(c.nombre), activo };
  if (local && local.activo && !activo) d.desactivadoAt = new Date();
  if (activo) d.desactivadoAt = null;
  if (c.codigo_ccsa) d.codigo = c.codigo_ccsa;
  const direccion = c.direccion || pv?.direccion;
  if (direccion) d.direccion = direccion;
  if (c.telefono) d.telefono = c.telefono;
  if (conGeo && local?.geoFuente !== 'apk' && (conGeo.latitud !== local?.latitud || conGeo.longitud !== local?.longitud)) {
    Object.assign(d, {
      latitud: conGeo.latitud,
      longitud: conGeo.longitud,
      geolocalizacion: `${conGeo.latitud},${conGeo.longitud}`,
      geoFuente: 'crm',
      geoAt: new Date(),
      // Otra ubicación, otra distancia: la vieja se medía a otro sitio (igual que con la APK).
      distanciaKm: null,
      distanciaDesde: null,
      distanciaAt: null,
    });
  }
  return d;
}

/** Los importados por `importar-de-pedido` llevan en el CRM el código `PED-<id de aquí>`. */
export const idLocalDeCodigoCrm = (codigo: string): string | null =>
  codigo.startsWith('PED-') && codigo.length > 4 ? codigo.slice(4) : null;

export interface ResumenClientes {
  vistos: number;
  creados: number;
  actualizados: number;
  sinSucursal: number;
  conflictos: string[];
}

/** Aplica una tanda de clientes del CRM a la tabla Client. */
export async function aplicarClientesDelCrm(clientes: ClienteCrm[]): Promise<ResumenClientes> {
  const prisma = await base();
  const sucursales = new Map(
    (await prisma.sucursal.findMany({ select: { id: true, codigo: true } }))
      .filter((s) => s.codigo)
      .map((s) => [s.codigo!.toUpperCase(), s.id]),
  );
  const vendedores = new Map(
    (await prisma.vendedor.findMany({ where: { codigo: { not: null } }, select: { id: true, codigo: true } }))
      .map((v) => [v.codigo!.toLowerCase(), v.id]),
  );
  const r: ResumenClientes = { vistos: clientes.length, creados: 0, actualizados: 0, sinSucursal: 0, conflictos: [] };
  const campos = { id: true, crmId: true, activo: true, bajaManual: true, geoFuente: true, latitud: true, longitud: true } as const;

  for (const c of clientes) {
    const sucursalId = sucursales.get(c.sucursal.toUpperCase());
    if (!sucursalId) {
      r.sinSucursal++;
      continue;
    }
    const nombre = nombreComparable(c.nombre);
    const idLocal = idLocalDeCodigoCrm(c.codigo);
    // Sólo se adopta una ficha que no sea ya de OTRO cliente del CRM.
    const libre = <T extends { crmId: string | null }>(f: T | null): T | null => (f && (!f.crmId || f.crmId === c.id) ? f : null);
    const local =
      (await prisma.cliente.findUnique({ where: { crmId: c.id }, select: campos })) ??
      libre(idLocal ? await prisma.cliente.findUnique({ where: { id: idLocal }, select: campos }) : null) ??
      libre(c.codigo_ccsa ? await prisma.cliente.findFirst({ where: { sucursalId, codigo: c.codigo_ccsa }, select: campos }) : null) ??
      libre(await prisma.cliente.findFirst({ where: { sucursalId, nombre }, select: campos }));

    const data: Record<string, unknown> = { ...datosDeClienteCrm(c, local), sucursalId };
    const vendedorId = c.codigo_vendedor ? vendedores.get(c.codigo_vendedor.toLowerCase()) : undefined;
    if (vendedorId) data.vendedorAsignadoId = vendedorId;
    try {
      if (local) {
        await prisma.cliente.update({ where: { id: local.id }, data });
        r.actualizados++;
      } else {
        await prisma.cliente.create({ data: data as Prisma.ClienteUncheckedCreateInput });
        r.creados++;
      }
    } catch (e) {
      if (!esUnicoRepetido(e)) throw e;
      // Nombre o código CCSA que ya tiene otra ficha de la sucursal: se deja para mirarlo.
      r.conflictos.push(`${c.sucursal} ${c.codigo} «${c.nombre}»`);
    }
  }
  return r;
}

// ─── Vendedores de Accesos ───────────────────────────────────────────────────

export interface MiembroAccesos {
  id: string;
  name: string;
  codigoVendedor: string | null;
  activo: boolean;
  organizationSlug: string | null;
}

export interface VendedorAccesos {
  accesosId: string;
  codigo: string;
  nombre: string;
  sucursal: string | null;
}

/**
 * Las personas de Accesos que son vendedores: activas y con `codigoVendedor` (LOC0 es el
 * de las pruebas locales). Una persona sale una vez por sucursal; si tiene varias no se le
 * pone ninguna (se deja la que tenga aquí).
 */
export function vendedoresDeMiembros(miembros: MiembroAccesos[]): VendedorAccesos[] {
  const porId = new Map<string, VendedorAccesos & { sucursales: Set<string> }>();
  for (const m of miembros) {
    const codigo = (m.codigoVendedor || '').trim();
    if (!m.activo || !m.id || !codigo || codigo.toUpperCase() === 'LOC0') continue;
    const v = porId.get(m.id) ?? { accesosId: m.id, codigo, nombre: m.name, sucursal: null, sucursales: new Set<string>() };
    if (m.organizationSlug) v.sucursales.add(m.organizationSlug.toUpperCase());
    porId.set(m.id, v);
  }
  return [...porId.values()].map(({ sucursales, ...v }) => ({ ...v, sucursal: sucursales.size === 1 ? [...sucursales][0] : null }));
}

/** POST firmado a Accesos, el mismo esquema que usan el CRM y Reparto (HMAC-SHA256). */
export function cabecerasAccesos(ruta: string, cuerpo: string, env: NodeJS.ProcessEnv = process.env, ahora = Date.now()) {
  const clave = Buffer.from((env.QB_AUTH_SIGNING_KEY || '').trim(), 'hex');
  if (clave.length !== 32 || !env.QB_AUTH_CLIENT_ID) throw new Error('VENDEDORES_DESDE_ACCESOS=1 sin QB_AUTH_CLIENT_ID o QB_AUTH_SIGNING_KEY');
  const ts = String(Math.floor(ahora / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const hashCuerpo = crypto.createHash('sha256').update(cuerpo).digest('hex');
  const firma = crypto.createHmac('sha256', clave).update(['POST', ruta, ts, nonce, hashCuerpo].join('\n')).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Client-Id': env.QB_AUTH_CLIENT_ID,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
    'X-Signature': firma,
    'X-Key-Version': String(Number(env.QB_AUTH_KEY_VERSION || 1)),
  };
}

export async function traerMiembrosDeAccesos(env: NodeJS.ProcessEnv = process.env, pedir: Pedir = fetch): Promise<MiembroAccesos[]> {
  const url = (env.QB_AUTH_URL || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('VENDEDORES_DESDE_ACCESOS=1 sin QB_AUTH_URL');
  const ruta = '/api/service/members';
  const cuerpo = '{}';
  const r = await pedir(url + ruta, { method: 'POST', body: cuerpo, headers: cabecerasAccesos(ruta, cuerpo, env), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Accesos contestó ${r.status} en ${ruta}`);
  return ((await r.json()) as { members: MiembroAccesos[] }).members ?? [];
}

export interface ResumenVendedores {
  vistos: number;
  creados: number;
  actualizados: number;
  conflictos: string[];
}

/**
 * Aplica los vendedores de Accesos a la tabla Seller: por accesosId, si no por código (sin
 * mayúsculas). No toca el gestor, la baja ni a los que Accesos no trae: un vendedor que sólo
 * existe por su CSV sigue igual.
 */
export async function aplicarVendedoresDeAccesos(lista: VendedorAccesos[]): Promise<ResumenVendedores> {
  const prisma = await base();
  const sucursales = new Map(
    (await prisma.sucursal.findMany({ select: { id: true, codigo: true } }))
      .filter((s) => s.codigo)
      .map((s) => [s.codigo!.toUpperCase(), s.id]),
  );
  const r: ResumenVendedores = { vistos: lista.length, creados: 0, actualizados: 0, conflictos: [] };
  for (const v of lista) {
    const sucursalId = v.sucursal ? sucursales.get(v.sucursal) : undefined;
    const local =
      (await prisma.vendedor.findUnique({ where: { accesosId: v.accesosId } })) ??
      (await prisma.vendedor.findFirst({ where: { codigo: { equals: v.codigo, mode: 'insensitive' }, accesosId: null } }));
    const data: Prisma.VendedorUncheckedUpdateInput = { accesosId: v.accesosId, nombre: nombreComparable(v.nombre) };
    // El código sólo se cambia si Accesos lo cambió (no el de mayúsculas: andy.almanza = ANDY.ALMANZA).
    if (local?.codigo?.toLowerCase() !== v.codigo.toLowerCase()) data.codigo = v.codigo;
    if (sucursalId) data.sucursalId = sucursalId;
    try {
      if (local) {
        await prisma.vendedor.update({ where: { id: local.id }, data });
        r.actualizados++;
      } else {
        await prisma.vendedor.create({
          data: { accesosId: v.accesosId, codigo: v.codigo, nombre: nombreComparable(v.nombre), sucursalId: sucursalId ?? null, creadoPor: 'accesos' },
        });
        r.creados++;
      }
    } catch (e) {
      if (!esUnicoRepetido(e)) throw e;
      r.conflictos.push(`${v.codigo} «${v.nombre}»`);
    }
  }
  return r;
}

// ─── El reloj, en el worker ──────────────────────────────────────────────────

/**
 * ponytail: el cursor del CRM vive en memoria; al reiniciar el worker hace una pasada
 * completa (unos miles de clientes, idempotente). Si pesa, guardarlo en Redis.
 */
let cursorCrm = 0;

export async function pasadaDelEspejo(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (vendedoresDesdeAccesos(env)) {
    // Primero los vendedores: los clientes resuelven su vendedor por el código.
    const r = await aplicarVendedoresDeAccesos(vendedoresDeMiembros(await traerMiembrosDeAccesos(env)));
    if (r.creados || r.conflictos.length) console.log('[espejo] vendedores de Accesos:', JSON.stringify(r));
  }
  if (clientesDesdeCrm(env)) {
    const { clientes, cursor } = await traerClientesDelCrm(cursorCrm, env);
    const r = await aplicarClientesDelCrm(clientes);
    cursorCrm = cursor;
    if (r.vistos) console.log('[espejo] clientes del CRM:', JSON.stringify({ ...r, cursor }));
  }
}

export function arrancarEspejo(env: NodeJS.ProcessEnv = process.env): void {
  if (!clientesDesdeCrm(env) && !vendedoresDesdeAccesos(env)) return;
  let enCurso = false;
  const correr = () => {
    if (enCurso) return;
    enCurso = true;
    pasadaDelEspejo(env)
      .catch((e) => console.error('[espejo] fallo:', (e as Error).message))
      .finally(() => { enCurso = false; });
  };
  correr();
  setInterval(correr, Math.max(1, Number(env.ESPEJO_CADA_MIN || 5)) * 60_000).unref();
}
