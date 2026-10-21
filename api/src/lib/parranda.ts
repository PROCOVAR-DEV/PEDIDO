// Cliente de la API de Parranda (Retool) + sync de clientes hacia PEDIDO.
// Reemplaza el Consolidado_Geolocalizacion.xlsx: trae los clientes con geolocalización
// DIRECTA (lat,lng), paginado por `offset` (1000/página). El worker lo corre en segundo
// plano (secuencial, con pausa anti-ban), sin golpear la DB desde el request.
import prisma from '../prismaClient';
import { emitEvent } from './events';
import { decidirActivos, esMejorFicha, type FilaDeParranda } from './clientesActivos';
import { filasGanadoras } from './parrandaFilas';
import { nombreComparable } from './nombreVendedor';
import { esConsumoPropio } from './consumoPropio';
import { esElMismoCliente } from './nombreParecido';

const PARRANDA_URL = process.env.PARRANDA_API_URL || 'https://ccsa.retool.com/url/procovar';
const PARRANDA_KEY = process.env.PARRANDA_API_KEY || ''; // SECRETO: solo por env (nunca en repo)
const PAGE = 1000;
const PAUSA_MS = Number(process.env.PARRANDA_PAUSA_MS || 1000); // pausa entre páginas (anti-ban)

// provincia que manda la API  ->  código de sucursal (el interno, el del Consolidado).
// Se matchea por NOMBRE de provincia (no por el prefijo del codigo del cliente, que usa
// otro esquema: LH/CM/GU… ≠ HAB/CAM/GTO…).
const PROV_TO_CODE: Record<string, string> = {
  'santiago de cuba': 'STG',
  'la habana': 'HAB',
  'camaguey': 'CAM',
  'guantanamo': 'GTO',
  'las tunas': 'TUN',
  'holguin': 'HOL',
  'sancti spiritus': 'SS',
  'granma': 'GR',
};

// Normaliza: sin tildes, minúsculas, espacios simples. Para matchear provincia y nombre
// pese a mayúsculas/tildes/dobles espacios (típico de estos datos).
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParrandaCliente {
  provincia?: string;
  municipio?: string;
  cliente?: string;
  codigo?: string;
  geolocalizacion?: string;
  direccion_cliente?: string;
  canal?: string;
  validado?: boolean;
}

/** Trae una página de clientes de Parranda. Lanza si falta la API key o si responde !2xx. */
/**
 * ¿Son la misma coordenada? Se comparan con margen porque son decimales y el
 * ultimo digito puede bailar entre lecturas sin que el punto haya cambiado. Sin
 * esto, ese baile bastaria para reescribir miles de filas en cada pasada.
 */
function mismoNumero(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  return Math.abs(a - b) < 0.0000001;
}

export async function fetchParrandaPage(offset: number): Promise<ParrandaCliente[]> {
  if (!PARRANDA_KEY) throw new Error('PARRANDA_API_KEY no configurado (.env)');
  const res = await fetch(PARRANDA_URL, {
    method: 'POST',
    headers: { 'X-Workflow-Api-Key': PARRANDA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ offset }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Parranda ${res.status} en offset ${offset}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { data?: ParrandaCliente[] };
  return Array.isArray(j.data) ? j.data : [];
}

// Extrae [lat, lng] de "20.030005, -75.82084".
function parseGeo(raw: unknown): { lat: number | null; lng: number | null } {
  if (typeof raw !== 'string') return { lat: null, lng: null };
  const m = raw.match(/-?\d{1,3}\.\d+/g);
  if (m && m.length >= 2) {
    const lat = parseFloat(m[0]);
    const lng = parseFloat(m[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
  }
  return { lat: null, lng: null };
}

export interface ParrandaSyncResult {
  paginas: number;
  total: number;
  creados: number;
  actualizados: number;
  /** Encontrados en Parranda pero SIN nada que cambiar. */
  sinCambios: number;
  /** Filas de Parranda que caen en una ficha a la que ya se aplicó OTRA fila (nombres o códigos repetidos). */
  repetidas: number;
  conGeo: number;
  sinGeo: number;
  sinSucursal: number;
  errores: number;
  /** Los primeros motivos distintos, para poder arreglarlos. */
  erroresDetalle: string[];
  /** Códigos que ya tenía otro cliente de la misma sucursal. */
  choquesDeCodigo: number;
  /** Clientes que Parranda ya no manda y se pasaron a INACTIVOS (no se borra nada). */
  desactivados: number;
  /** Inactivos que Parranda volvió a mandar. */
  reactivados: number;
  /** Códigos que pasaron de una ficha inactiva a la ficha viva que Parranda ya nombra con él. */
  codigosMovidos: number;
  /** Códigos con el prefijo de otra sucursal. */
  prefijosAjenos: number;
  /**
   * Lo que hay que enseñarle a Parranda, en cristiano y con nombres.
   *
   * Separado de `erroresDetalle`: un error es algo que se rompió aquí; esto es algo
   * que viene mal de fuera y que aquí se sorteó. Mezclarlos hace que se busque el
   * fallo en el sitio equivocado.
   */
  avisos: string[];
  /**
   * QUÉ cambió, cliente a cliente. Acotado: interesa mirar una muestra y entender qué
   * pasa, no guardar un diario entero en Redis.
   *
   * Sin esto, "198 cambiaron" no se puede ni creer ni desmentir. Y hace falta poder
   * desmentirlo: si son los MISMOS 198 en cada pasada, no es que cambien —es que algo
   * los está reescribiendo en círculo.
   */
  cambios: Array<{
    cliente: string;
    sucursal: string | null;
    campos: Array<{ campo: string; antes: string | null; despues: string | null }>;
  }>;
}

/**
 * Sync completo: pagina Parranda, mapea provincia->sucursal, y upsert cada cliente
 * (match por nombre normalizado dentro de la sucursal, como el import del Consolidado).
 * Escribe geo (lat/lng/direccion/municipio/codigo). Al terminar avisa a delivery.
 */
export async function processParrandaSync(
  onProgress?: (p: ParrandaSyncResult) => void,
): Promise<ParrandaSyncResult> {
  // Mapa código-sucursal -> id.
  const sucursales = await prisma.sucursal.findMany({ select: { id: true, codigo: true } });
  const idByCode = new Map<string, string>();
  for (const s of sucursales) if (s.codigo) idByCode.set(s.codigo.toUpperCase(), s.id);

  // Precarga clientes existentes para matchear por nombre normalizado (rápido y preciso,
  // igual que el import del Consolidado). Clave: `${sucursalId}|${norm(nombre)}`.
  // Se traen TAMBIEN los campos que este sync escribe, para poder comparar antes
  // de tocar nada. Antes solo se traia el id y se hacia un `update` a ciegas:
  // 6127 escrituras en cada pasada aunque no hubiera cambiado ni un dato.
  //
  // Y eso no era solo derroche. Cada `update` pisa `updatedAt`, que es la columna
  // que dice "cuando se sincronizo este cliente por ultima vez": si se toca a
  // todos, todos parecen recien actualizados y esa fecha deja de significar
  // nada. Ahora solo se escribe lo que de verdad cambio.
  const existentes = await prisma.cliente.findMany({
    select: {
      id: true, nombre: true, sucursalId: true, activo: true, bajaManual: true,
      codigo: true, direccion: true, municipio: true,
      latitud: true, longitud: true, geolocalizacion: true,
    },
  });
  type Actual = (typeof existentes)[number];
  const porClave = new Map<string, Actual>();
  const porId = new Map<string, Actual>();

  for (const c of existentes) {
    porId.set(c.id, c);
    if (!c.sucursalId) continue;

    const k = `${c.sucursalId}|${norm(c.nombre)}`;
    const previa = porClave.get(k);
    if (!previa || esMejorFicha(c, previa)) porClave.set(k, c);
  }

  // Quién tiene ya cada código, por sucursal.
  //
  // `(sucursalId, codigo)` es ÚNICO en la base, y Parranda manda a veces un código que
  // en esa misma sucursal ya lo lleva otro cliente. El update reventaba con "Unique
  // constraint failed" —121 de esos en una sola pasada—, no se escribía NADA de ese
  // cliente (ni la dirección, ni la geo) y en la siguiente pasada se volvía a
  // intentar. Para siempre.
  //
  // Con este mapa se ve venir el choque antes de escribir: se guarda todo lo demás y
  // se deja el código como está, en vez de perder la fila entera por un campo.
  const porCodigo = new Map<string, string>();
  const nombrePorId = new Map<string, string>();
  for (const c of existentes) {
    nombrePorId.set(c.id, c.nombre);
    if (c.sucursalId && c.codigo) porCodigo.set(`${c.sucursalId}|${c.codigo}`, c.id);
  }

  // Qué prefijo usa DE VERDAD cada sucursal.
  //
  // Los códigos de Parranda empiezan por dos letras que identifican la sucursal, pero
  // con un esquema distinto del nuestro: SC es Santiago, LT es Las Tunas, CM Camagüey,
  // SS Sancti Spíritus… No hay tabla en ninguna parte, así que en vez de inventarme una
  // —y equivocarme el día que aparezca una sucursal nueva— se mira lo que ya hay: el
  // prefijo que lleva la mayoría de los clientes de esa sucursal es el suyo.
  //
  // Sirve para señalar los códigos que vienen con el prefijo de OTRA sucursal, que es
  // lo que hay que enseñarle a Parranda.
  const cuentaPrefijos = new Map<string, Map<string, number>>();
  for (const c of existentes) {
    if (!c.sucursalId || !c.codigo || c.codigo.length < 2) continue;
    const pre = c.codigo.slice(0, 2).toUpperCase();
    if (!cuentaPrefijos.has(c.sucursalId)) cuentaPrefijos.set(c.sucursalId, new Map());
    const m = cuentaPrefijos.get(c.sucursalId)!;
    m.set(pre, (m.get(pre) ?? 0) + 1);
  }
  const prefijoDe = new Map<string, string>();
  for (const [sid, m] of cuentaPrefijos) {
    const [mejor] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (mejor && mejor[1] >= 5) prefijoDe.set(sid, mejor[0]);
  }

  const r: ParrandaSyncResult = {
    paginas: 0, total: 0, creados: 0, actualizados: 0, sinCambios: 0, repetidas: 0, conGeo: 0, sinGeo: 0, sinSucursal: 0, errores: 0,
    erroresDetalle: [], cambios: [], choquesDeCodigo: 0, prefijosAjenos: 0, avisos: [],
    desactivados: 0, reactivados: 0, codigosMovidos: 0,
  };
  // Lo que Parranda mandó en esta pasada, para decidir al final quién ya no está.
  const delFeed: FilaDeParranda[] = [];

  // 1) TODO el feed, página a página. Si Parranda falla a mitad, la excepción sale antes de
  // escribir nada: ni se cambia una ficha ni se desactiva a nadie por una pasada cortada.
  const crudo: ParrandaCliente[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await fetchParrandaPage(offset);
    if (!data.length) break;
    r.paginas++;
    crudo.push(...data);
    if (data.length < PAGE) break; // última página
    await new Promise((res) => setTimeout(res, PAUSA_MS)); // pausa anti-ban
  }

  // La ficha que lleva este código. Los códigos «OTR» («otros») los reparte Parranda a VARIOS
  // clientes —en los archivos de pedidos, 8 % de ellos salen con dos o más clientes distintos—, así
  // que para esos sólo vale si el nombre se parece: si no, se le pondría a un cliente la dirección
  // o el nombre de otro.
  const fichaDelCodigo = (sucursalId: string | null, codigo: string | null, nombreFila: string) => {
    if (!sucursalId || !codigo) return undefined;
    const id = porCodigo.get(`${sucursalId}|${codigo}`);
    const ficha = id ? porId.get(id) : undefined;

    return ficha && (!/^[A-Z]{2}\d{2}OTR/i.test(codigo) || esElMismoCliente(ficha.nombre, nombreFila)) ? ficha : undefined;
  };

  // 2) A qué ficha cae cada fila, y cuál se APLICA cuando varias caen en la misma. Parranda manda
  // nombres y códigos repetidos con datos distintos; escribir cada fila según llega dejaba la
  // ficha oscilando (la primera la cambiaba, la segunda la devolvía) y en cada pasada salían como
  // «cambios» las mismas fichas de siempre.
  const filas = crudo.map((c) => {
    const code = PROV_TO_CODE[norm(c.provincia)];
    const sucursalId = code ? idByCode.get(code) ?? null : null;
    const nombre = String(c.cliente ?? '').toUpperCase().trim();

    return { c, code, sucursalId, nombre, codigo: c.codigo ? String(c.codigo).trim() : null };
  });
  const aplica = filasGanadoras(
    filas,
    (f) => {
      if (!f.sucursalId || !f.nombre) return undefined;
      return porClave.get(`${f.sucursalId}|${norm(f.nombre)}`) ?? fichaDelCodigo(f.sucursalId, f.codigo, f.nombre);
    },
    (f, ficha) => norm(f.nombre) === norm(ficha.nombre),
  );

  // 3) Se escribe UNA fila por ficha.
  for (const [i, { c, code, sucursalId, nombre }] of filas.entries()) {
    if (i > 0 && i % PAGE === 0) onProgress?.(r);
    r.total++;
    try {
      if (!sucursalId) { r.sinSucursal++; continue; }
      if (!nombre) { r.errores++; continue; }

      delFeed.push({ sucursalId, nombre, codigo: c.codigo ? String(c.codigo).trim() : null });

      const { lat, lng } = parseGeo(c.geolocalizacion);
      if (lat != null && lng != null) r.conGeo++; else r.sinGeo++;

      const geoData = {
        codigo: c.codigo ? String(c.codigo).trim() : null,
        direccion: c.direccion_cliente ? String(c.direccion_cliente).trim() : null,
        municipio: c.municipio ? String(c.municipio).trim() : null,
        latitud: lat,
        longitud: lng,
        geolocalizacion: typeof c.geolocalizacion === 'string' ? c.geolocalizacion : null,
      };

      const key = `${sucursalId}|${norm(nombre)}`;
      // Sin ficha por NOMBRE pero con una que YA lleva este código: es el mismo cliente con el
      // nombre escrito distinto («Mi8 Tatiana Hurtado» / «TATIANA HURTADO»). El código es exacto,
      // no se adivina nada. Sin esto esas fichas no recibían nunca su dirección ni su geo.
      const actual = porClave.get(key) ?? fichaDelCodigo(sucursalId, geoData.codigo, nombre);

      // Otra fila de Parranda cae en esta misma ficha y es la que se aplica: ésta no se escribe.
      if (actual && !aplica.has(i)) { r.repetidas++; continue; }

      // La ficha se encontró por el CÓDIGO y no por el nombre: Parranda la llama de otra manera
      // (le cambió el nombre: el código es único y es de Parranda, así que es el mismo cliente).
      // Se le pone el nombre de Parranda, que es el que traen los archivos de pedidos; si no, el
      // siguiente pedido de ese cliente no la encuentra por nombre. Sólo si ese nombre está libre
      // en la sucursal, y nunca a una ficha inactiva.
      const nuevoNombre = nombreComparable(nombre);
      const renombrar =
        !!actual &&
        actual.activo &&
        nuevoNombre !== actual.nombre &&
        // «CONSUMO PROPIO …» se reconoce por el nombre: PEDIDO la trata aparte (filtro, reportes).
        !esConsumoPropio(actual.nombre) &&
        // El `-DUP-n` es el código con que Parranda marca a un duplicado: no identifica a nadie.
        !/-DUP-/i.test(geoData.codigo ?? '') &&
        !porClave.has(key) &&
        !porClave.has(`${sucursalId}|${norm(nuevoNombre)}`);

      if (actual) {
        // Solo se escribe si algo CAMBIO de verdad. Las coordenadas se comparan
        // con margen: son decimales y una diferencia en el ultimo digito no es
        // un cambio real, pero bastaria para escribir las 6127 filas otra vez.
        // Qué campos cambian, uno a uno, en vez de un sí/no. Es lo que hay que
        // poder MIRAR: "198 cambiaron" no se puede ni creer ni desmentir, y "198
        // cambiaron el municipio de Camagüey a CAMAGÜEY" se arregla en cinco
        // minutos.
        const campos: Array<{ campo: string; antes: string | null; despues: string | null }> = [];
        const anota = (campo: string, antes: unknown, despues: unknown) => {
          campos.push({
            campo,
            antes: antes == null ? null : String(antes),
            despues: despues == null ? null : String(despues),
          });
        };

        if (renombrar) anota('nombre', actual.nombre, nuevoNombre);
        if ((geoData.codigo ?? null) !== (actual.codigo ?? null)) anota('código', actual.codigo, geoData.codigo);
        if ((geoData.direccion ?? null) !== (actual.direccion ?? null)) anota('dirección', actual.direccion, geoData.direccion);
        if ((geoData.municipio ?? null) !== (actual.municipio ?? null)) anota('municipio', actual.municipio, geoData.municipio);
        if ((geoData.geolocalizacion ?? null) !== (actual.geolocalizacion ?? null)) anota('geolocalización', actual.geolocalizacion, geoData.geolocalizacion);
        if (!mismoNumero(geoData.latitud, actual.latitud)) anota('latitud', actual.latitud, geoData.latitud);
        if (!mismoNumero(geoData.longitud, actual.longitud)) anota('longitud', actual.longitud, geoData.longitud);

        // ¿El código que viene lo tiene ya otro cliente de esta sucursal?
        const dueñoDelCodigo = geoData.codigo
          ? porCodigo.get(`${sucursalId}|${geoData.codigo}`)
          : undefined;
        const codigoOcupado = dueñoDelCodigo != null && dueñoDelCodigo !== actual.id;

        // ¿Viene con el prefijo de otra sucursal? Se anota y se sigue: el dato es
        // válido igualmente, pero es la prueba de que en el origen están asignando
        // códigos que no corresponden.
        const preEsperado = prefijoDe.get(sucursalId);
        const preRecibido = geoData.codigo?.slice(0, 2).toUpperCase();
        if (preEsperado && preRecibido && preEsperado !== preRecibido) {
          r.prefijosAjenos++;
          if (r.avisos.length < 30) {
            r.avisos.push(
              `${nombre} (${code}): el código ${geoData.codigo} empieza por ${preRecibido}, ` +
                `y en ${code} todos los demás empiezan por ${preEsperado}`,
            );
          }
        }

        if (codigoOcupado) {
          // Se escribe todo menos el código, y se deja dicho quién lo tiene: eso es
          // lo que hay que arreglar en el origen, y sin el nombre del otro cliente
          // no hay por dónde empezar.
          geoData.codigo = actual.codigo ?? null;
          const i = campos.findIndex((f) => f.campo === 'código');
          if (i >= 0) campos.splice(i, 1);

          r.choquesDeCodigo++;
          if (r.avisos.length < 30) {
            const otro = nombrePorId.get(dueñoDelCodigo!) ?? 'otro cliente';
            r.avisos.push(
              `${nombre} (${code}): Parranda le manda el código ${String(c.codigo).trim()}, ` +
                `que en esa misma sucursal ya lo tiene ${otro}. Se guardó el resto sin tocar su código.`,
            );
          }
        }

        const cambio = campos.length > 0;

        if (cambio) {
          if (r.cambios.length < 200) {
            r.cambios.push({ cliente: nombre, sucursal: code ?? null, campos });
          }
          const datos = renombrar ? { ...geoData, nombre: nuevoNombre } : geoData;
          await prisma.cliente.update({ where: { id: actual.id }, data: datos });
          r.actualizados++;

          // Y la foto se actualiza con lo que se acaba de escribir.
          //
          // Sin esto, el mismo cliente repetido en el origen se comparaba SIEMPRE
          // contra el valor que tenía antes de empezar: la segunda aparición veía
          // una diferencia que ya se había escrito y volvía a escribir. Parranda
          // manda 12.049 filas para 8.850 clientes, o sea que repetir es lo normal,
          // no la excepción.
          //
          // Y no era solo contar de más: gana la última aparición, así que si el
          // orden cambia entre pasadas el valor guardado va y viene, y en la
          // siguiente "cambia" otra vez. Eso es lo que hacía que el número subiera
          // solo —5703, 5913, 6127, 6602— sin que nadie tocara nada.
          const foto = { ...actual, ...datos };
          porClave.delete(`${sucursalId}|${norm(actual.nombre)}`);
          porClave.set(`${sucursalId}|${norm(foto.nombre)}`, foto);
          porId.set(actual.id, foto);
          // El código recién escrito pasa a estar ocupado por este cliente: si más
          // abajo llega otro con el mismo, se ve el choque igual que si viniera de
          // la base.
          if (geoData.codigo) porCodigo.set(`${sucursalId}|${geoData.codigo}`, actual.id);
        } else {
          r.sinCambios++;
        }
      } else {
        // Parranda SOLO enriquece a MIS clientes (los que vienen de los pedidos). Un cliente
        // de Parranda que NO existe aquí se OMITE: no se importa el catálogo entero de Parranda.
        r.creados = 0;
      }
    } catch (e) {
      // P2002 (codigo/nombre duplicado) u otro: no tumbar el sync, contar y seguir.
      //
      // Pero se guardan los primeros motivos. "114 err" a secas no se puede
      // arreglar: no dice si son 114 veces lo mismo o 114 cosas distintas, y sin
      // eso nadie sabe por dónde empezar.
      r.errores++;
      if (r.erroresDetalle.length < 5) {
        const msg = (e as Error)?.message ?? String(e);
        if (!r.erroresDetalle.includes(msg)) r.erroresDetalle.push(msg);
      }
    }
  }
  onProgress?.(r);

  // ACTIVOS E INACTIVOS. Sólo llegamos aquí si se recorrieron TODAS las páginas: si Parranda
  // fallara a mitad, la excepción sale antes y nadie se desactiva por una pasada cortada.
  // Se marcan inactivos y NO se borran: los pedidos viejos siguen colgando de ellos.
  try {
    const frescos = await prisma.cliente.findMany({ select: { id: true, nombre: true, sucursalId: true, codigo: true, activo: true, sucesorId: true, bajaManual: true } });
    // Fichas con un pedido de los últimos 30 días: están en uso, y no se desactivan por no venir.
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const conPedido = await prisma.pedido.groupBy({ by: ['clienteId'], where: { createdAt: { gte: hace30 } } });
    const conPedidoReciente = new Set(conPedido.flatMap((x) => (x.clienteId ? [x.clienteId] : [])));
    const d = decidirActivos(frescos, delFeed, norm, conPedidoReciente);

    r.avisos.push(...d.avisos.slice(0, Math.max(0, 30 - r.avisos.length)));

    // El DETALLE, cliente a cliente, en el mismo «Qué cambió» de la pantalla de Parranda: quién
    // pasó a inactivo, quién se reactivó y a qué ficha se le pasó cada código. Va ANTES que los
    // cambios de geolocalización —son lo que importa— y acotado: la primera pasada puede mover
    // miles, las diarias unos pocos.
    const porId = new Map(frescos.map((c) => [c.id, c]));
    const codigoDeSuc = new Map(sucursales.map((x) => [x.id, x.codigo]));
    const detalle: ParrandaSyncResult['cambios'] = [];
    const caso = (id: string) => {
      const c = porId.get(id);

      return { cliente: c?.nombre ?? id, sucursal: (c?.sucursalId && codigoDeSuc.get(c.sucursalId)) || null };
    };

    for (const m of d.codigosMovidos) {
      detalle.push({
        ...caso(m.para),
        campos: [
          { campo: 'código', antes: null, despues: m.codigo },
          { campo: 'ficha anterior (queda inactiva)', antes: porId.get(m.de)?.nombre ?? m.de, despues: null },
        ],
      });
    }
    for (const id of d.desactivar) {
      detalle.push({ ...caso(id), campos: [{ campo: 'estado', antes: 'activo', despues: 'inactivo: Parranda ya no lo manda' }] });
    }
    for (const id of d.reactivar) {
      detalle.push({ ...caso(id), campos: [{ campo: 'estado', antes: 'inactivo', despues: 'activo: Parranda lo volvió a mandar' }] });
    }
    r.cambios = [...detalle.slice(0, 500), ...r.cambios];

    // El código de la ficha vieja pasa a la viva: primero se libera, porque (sucursal, código)
    // es único.
    for (const m of d.codigosMovidos) {
      try {
        await prisma.$transaction([
          prisma.cliente.update({ where: { id: m.de }, data: { codigo: null, sucesorId: m.para } }),
          prisma.cliente.update({ where: { id: m.para }, data: { codigo: m.codigo } }),
        ]);
        r.codigosMovidos++;
      } catch (e) {
        r.errores++;
        if (r.erroresDetalle.length < 5) r.erroresDetalle.push(`mover código ${m.codigo}: ${(e as Error)?.message}`);
      }
    }

    for (let i = 0; i < d.desactivar.length; i += 500) {
      const lote = d.desactivar.slice(i, i + 500);
      const x = await prisma.cliente.updateMany({ where: { id: { in: lote }, activo: true }, data: { activo: false, desactivadoAt: new Date() } });

      r.desactivados += x.count;
    }

    for (let i = 0; i < d.reactivar.length; i += 500) {
      const lote = d.reactivar.slice(i, i + 500);
      const x = await prisma.cliente.updateMany({ where: { id: { in: lote }, activo: false }, data: { activo: true, desactivadoAt: null, sucesorId: null } });

      r.reactivados += x.count;
    }
  } catch (e) {
    // Es información derivada: si falla no se pierde ningún dato, sólo queda sin marcar.
    r.errores++;
    if (r.erroresDetalle.length < 5) r.erroresDetalle.push(`activos/inactivos: ${(e as Error)?.message}`);
  }

  // Avisar a delivery: hay clientes nuevos/geolocalizados -> el mirror se re-sincroniza.
  if (r.creados > 0 || r.actualizados > 0 || r.desactivados > 0 || r.reactivados > 0) {
    // Y avisar al front por SSE: el sync corre en el worker, así que sin este evento la
    // lista de clientes se queda con los datos viejos hasta que alguien recargue.
    emitEvent('cliente', { accion: 'sync-parranda' });
  }
  return r;
}
