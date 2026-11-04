import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pagination,
  Spinner,
  Tab,
  Tabs,
  Tooltip,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Ubicaciones por revisar (issue #13): clientes cuyo punto no cae donde dice su dirección.
 *
 * La dirección escrita se compara con lo que el mapa dice del punto (calle, barrio, municipio) y con dónde
 * ubica el mapa el texto de la dirección (ver `api/src/lib/geoComprobacion.ts`).
 * Es un aviso: el supervisor decide si el punto está bien (lo confirma, con un motivo) o lo corrige.
 * Queda apuntado quién y cuándo.
 *
 * Una tarjeta por cliente, con la frase que explica POR QUÉ salta el aviso y, en un clic, la dirección
 * y el punto cada uno en su mapa: la decisión es visual.
 */

interface Item {
  id: string;
  codigo: string | null;
  nombre: string;
  direccion: string | null;
  municipio: string | null;
  latitud: number;
  longitud: number;
  geoEstado: "revisar" | "no_coincide";
  geoDistanciaKm: number | null;
  geoFuente: string | null;
  geoAt: string | null;
  delPunto: {
    calle: string | null;
    barrio: string | null;
    municipios: string[];
  } | null;
  dondeSeUbicaLaDireccion: { latitud: number; longitud: number } | null;
  sucursal: { codigo: string | null; nombre: string } | null;
}

interface Respuesta {
  total: number;
  limit: number;
  pendientes: number;
  cuentas: Record<string, number>;
  items: Item[];
}

const MOTIVOS = [
  "La calle es larga y el punto está bien",
  "Confirmado con el vendedor",
  "Confirmado con el cliente",
  "Es una zona rural",
];

const Icono = ({ d }: { d: string }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height="18"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="18"
  >
    <path d={d} />
  </svg>
);

const Visto = () => <Icono d="M5 13l4 4L19 7" />;
const Lapiz = () => <Icono d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />;
const Mapa = () => (
  <Icono d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
);

const km = (v: number) =>
  (v < 10 ? v.toFixed(1) : Math.round(v).toString()).replace(".", ",");

const abrirMapa = (lat: number, lon: number) =>
  `https://www.google.com/maps?q=${lat},${lon}`;

/** Dónde dice el texto de la dirección que está el cliente: lo busca Google. */
const textoDeLaDireccion = (it: {
  direccion: string | null;
  municipio: string | null;
  sucursal: { nombre: string } | null;
}) =>
  [it.direccion, it.municipio ?? it.sucursal?.nombre, "Cuba"]
    .filter(Boolean)
    .join(", ");

const mapaDeLaDireccion = (it: Parameters<typeof textoDeLaDireccion>[0]) =>
  `https://maps.google.com/maps?q=${encodeURIComponent(textoDeLaDireccion(it))}&z=15&output=embed`;

const mapaDelPunto = (it: { latitud: number; longitud: number }) =>
  `https://maps.google.com/maps?q=${it.latitud},${it.longitud}&z=15&output=embed`;

/** La dirección escrita contra el punto guardado, cada uno en su mapa: lo que hay que comparar. */
function MapasComparados({ it, alto = "h-64" }: { it: Item; alto?: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-default-500">
          Donde dice la dirección:{" "}
          <span className="font-medium text-default-700">
            {it.direccion || "sin dirección"}
          </span>
        </p>
        <iframe
          className={`${alto} w-full rounded-lg border border-default-200`}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={mapaDeLaDireccion(it)}
          title={`Dirección de ${it.nombre}`}
        />
        <a
          className="text-xs text-primary underline"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(textoDeLaDireccion(it))}`}
          rel="noreferrer"
          target="_blank"
        >
          Abrir la dirección en Google Maps
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-default-500">
          Donde cae el punto guardado:{" "}
          <span className="font-medium text-default-700">
            {it.latitud.toFixed(5)}, {it.longitud.toFixed(5)}
          </span>
        </p>
        <iframe
          className={`${alto} w-full rounded-lg border border-default-200`}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={mapaDelPunto(it)}
          title={`Punto de ${it.nombre}`}
        />
        <a
          className="text-xs text-primary underline"
          href={abrirMapa(it.latitud, it.longitud)}
          rel="noreferrer"
          target="_blank"
        >
          Abrir el punto en Google Maps
        </a>
      </div>
    </div>
  );
}

const fuenteDelPunto = (f: string | null, cuando: string | null) => {
  const quien = !f
    ? "Parranda"
    : f === "parranda"
      ? "Parranda"
      : f === "apk"
        ? "la app de entrega"
        : f.replace("usuario:", "");
  const fecha = cuando
    ? new Date(cuando).toLocaleDateString("es-CU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  return `Punto puesto por ${quien}${fecha ? ` el ${fecha}` : ""}`;
};

/** Saca latitud y longitud de lo que se pegue: «20.03, -75.82», o un enlace de Google Maps. */
function leerPunto(texto: string): { lat: number; lon: number } | null {
  const t = texto.trim();
  const enlace =
    t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) ??
    t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  const par =
    enlace ?? t.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);

  if (!par) return null;
  const lat = Number(par[1]);
  const lon = Number(par[2]);

  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function Explicacion({ it }: { it: Item }) {
  const p = it.delPunto;
  const donde = p
    ? [
        p.calle ? `la calle ${p.calle}` : "ninguna calle conocida",
        p.barrio ? `barrio ${p.barrio}` : null,
        p.municipios[0] ? `municipio ${p.municipios[0]}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "nada conocido";
  const otroMunicipio =
    !!p?.municipios.length &&
    !!it.municipio &&
    !p.municipios.some((m) => {
      const a = m.toLowerCase();
      const b = it.municipio!.toLowerCase();

      return a.includes(b) || b.includes(a);
    });

  return (
    <div className="flex flex-col gap-1 text-sm text-default-700">
      <p>
        La dirección dice <strong>{it.direccion || "—"}</strong>
        {it.municipio ? ` (${it.municipio})` : ""}. En el punto guardado el mapa
        ve {donde}.
      </p>
      {otroMunicipio ? (
        <p>El punto cae en otro municipio que el de la dirección.</p>
      ) : null}
      {it.geoDistanciaKm != null ? (
        <p>
          El mapa ubica la dirección a{" "}
          <strong>{km(it.geoDistanciaKm)} km</strong> del punto guardado.
        </p>
      ) : !otroMunicipio && it.dondeSeUbicaLaDireccion == null ? (
        <p>El mapa no supo ubicar la dirección escrita.</p>
      ) : null}
    </div>
  );
}

export function UbicacionesDudosas() {
  const [estado, setEstado] = useState("todos");
  const [buscar, setBuscar] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [revisando, setRevisando] = useState(false);
  const [mapas, setMapas] = useState<Record<string, boolean>>({});

  const [confirmando, setConfirmando] = useState<Item | null>(null);
  const [motivo, setMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState<Item | null>(null);
  const [punto, setPunto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const q = busqueda ? `&search=${encodeURIComponent(busqueda)}` : "";
      const r = await fetch(
        `${getApiBaseUrl()}/clientes/geo-dudosos?estado=${estado}&page=${page}&limit=15${q}`,
      );
      const j = await r.json();

      if (!r.ok) throw new Error(j.error || "No se pudo leer la lista");
      setDatos(j);
    } catch (e) {
      addToast({
        title: "No se pudo leer la lista",
        description: (e as Error).message,
        color: "danger",
      });
    } finally {
      setCargando(false);
    }
  }, [estado, page, busqueda]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    setPage(1);
  }, [estado, busqueda]);

  // La búsqueda espera a que se deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(buscar.trim()), 350);

    return () => clearTimeout(t);
  }, [buscar]);

  const llamar = async (url: string, metodo: string, cuerpo: unknown) => {
    const r = await fetch(`${getApiBaseUrl()}${url}`, {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));

    if (!r.ok) throw new Error(j.error || "No se pudo guardar");

    return j;
  };

  const volverARevisar = async () => {
    setRevisando(true);
    try {
      const j = await llamar("/clientes/geo-evaluar", "POST", {});
      const r = j.resumen ?? {};

      addToast({
        title: "Revisión hecha",
        description: `${r.coincide ?? 0} coinciden, ${r.revisar ?? 0} por revisar, ${r.no_coincide ?? 0} no coinciden y ${r.sin_referencia ?? 0} sin referencia.`,
        color: "success",
      });
      await cargar();
    } catch (e) {
      addToast({
        title: "No se pudo revisar",
        description: (e as Error).message,
        color: "danger",
      });
    } finally {
      setRevisando(false);
    }
  };

  const confirmar = async () => {
    if (!confirmando) return;
    setGuardando(true);
    try {
      await llamar(`/clientes/${confirmando.id}/geo-confirmar`, "POST", {
        motivo,
      });
      addToast({
        title: "Ubicación confirmada",
        description: confirmando.nombre,
        color: "success",
      });
      setConfirmando(null);
      setMotivo("");
      await cargar();
    } catch (e) {
      addToast({
        title: "No se pudo confirmar",
        description: (e as Error).message,
        color: "danger",
      });
    } finally {
      setGuardando(false);
    }
  };

  const nuevo = leerPunto(punto);

  const corregir = async () => {
    if (!corrigiendo || !nuevo) return;
    setGuardando(true);
    try {
      await llamar(`/clientes/${corrigiendo.id}/geo`, "PATCH", {
        latitud: nuevo.lat,
        longitud: nuevo.lon,
      });
      addToast({
        title: "Ubicación corregida",
        description: corrigiendo.nombre,
        color: "success",
      });
      setCorrigiendo(null);
      await cargar();
    } catch (e) {
      addToast({
        title: "No se pudo corregir",
        description: (e as Error).message,
        color: "danger",
      });
    } finally {
      setGuardando(false);
    }
  };

  const c = datos?.cuentas ?? {};
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.limit)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          aria-label="Qué mostrar"
          selectedKey={estado}
          onSelectionChange={(k) => setEstado(String(k))}
        >
          <Tab
            key="todos"
            title={`Todas (${(c.revisar ?? 0) + (c.no_coincide ?? 0)})`}
          />
          <Tab
            key="no_coincide"
            title={`No coinciden (${c.no_coincide ?? 0})`}
          />
          <Tab key="revisar" title={`Por revisar (${c.revisar ?? 0})`} />
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            isClearable
            className="w-64"
            placeholder="Buscar por nombre o código"
            size="sm"
            value={buscar}
            onClear={() => setBuscar("")}
            onValueChange={setBuscar}
          />
          <Button
            color="primary"
            isLoading={revisando}
            size="sm"
            variant="flat"
            onPress={volverARevisar}
          >
            Volver a revisar todos
          </Button>
        </div>
      </div>

      <p className="max-w-3xl text-sm text-default-500">
        La dirección de cada cliente se compara con su punto: lo que el mapa ve
        en ese punto (calle, barrio, municipio) y dónde ubica el mapa la
        dirección escrita. Si no coinciden, aparece aquí. Es un aviso: tú
        decides si el punto está bien o hay que corregirlo.
        {c.confirmado ? ` Ya confirmaste ${c.confirmado}.` : ""}
        {datos?.pendientes
          ? ` Faltan por comprobar ${datos.pendientes} puntos; se van revisando solos, cada uno unos segundos.`
          : ""}
      </p>

      {cargando && !datos ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (datos?.items.length ?? 0) === 0 ? (
        <Card className="border border-default-200" shadow="none">
          <CardBody className="py-12 text-center text-default-500">
            {busqueda
              ? `Ningún cliente por revisar se llama «${busqueda}».`
              : "No hay ubicaciones por revisar."}
          </CardBody>
        </Card>
      ) : (
        <div className={`flex flex-col gap-3 ${cargando ? "opacity-60" : ""}`}>
          {datos!.items.map((it) => (
            <Card
              key={it.id}
              className="border border-default-200"
              shadow="none"
            >
              <CardBody className="gap-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{it.nombre}</h3>
                      <Chip
                        color={
                          it.geoEstado === "no_coincide" ? "danger" : "warning"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {it.geoEstado === "no_coincide"
                          ? "No coincide"
                          : "Revisar"}
                        {it.geoDistanciaKm != null
                          ? ` · ${km(it.geoDistanciaKm)} km`
                          : ""}
                      </Chip>
                      <span className="text-xs text-default-500">
                        {[it.sucursal?.codigo, it.codigo, it.municipio]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <p className="text-sm">
                      <span className="text-default-500">Dirección: </span>
                      <span className="font-medium">
                        {it.direccion || "sin dirección"}
                      </span>
                    </p>
                    <Explicacion it={it} />
                    <p className="text-xs text-default-400">
                      {fuenteDelPunto(it.geoFuente, it.geoAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip content="El punto está bien">
                      <Button
                        isIconOnly
                        aria-label="El punto está bien"
                        color="success"
                        size="sm"
                        variant="flat"
                        onPress={() => {
                          setConfirmando(it);
                          setMotivo("");
                        }}
                      >
                        <Visto />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Corregir el punto">
                      <Button
                        isIconOnly
                        aria-label="Corregir el punto"
                        color="primary"
                        size="sm"
                        variant="flat"
                        onPress={() => {
                          setCorrigiendo(it);
                          setPunto("");
                        }}
                      >
                        <Lapiz />
                      </Button>
                    </Tooltip>
                    <Tooltip
                      content={
                        mapas[it.id]
                          ? "Ocultar los mapas"
                          : "Ver la dirección y el punto en el mapa"
                      }
                    >
                      <Button
                        isIconOnly
                        aria-label="Ver en el mapa"
                        color={mapas[it.id] ? "secondary" : "default"}
                        size="sm"
                        variant="flat"
                        onPress={() =>
                          setMapas((m) => ({ ...m, [it.id]: !m[it.id] }))
                        }
                      >
                        <Mapa />
                      </Button>
                    </Tooltip>
                  </div>
                </div>

                {mapas[it.id] && <MapasComparados it={it} />}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {paginas > 1 && (
        <div className="flex justify-center">
          <Pagination page={page} total={paginas} onChange={setPage} />
        </div>
      )}

      <Modal
        isOpen={!!confirmando}
        size="lg"
        onClose={() => setConfirmando(null)}
      >
        <ModalContent>
          <ModalHeader>Confirmar que el punto está bien</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              {confirmando?.nombre}: {confirmando?.direccion || "sin dirección"}
            </p>
            <p className="text-sm">
              ¿Por qué está bien? Elige un motivo o escribe el tuyo.
            </p>
            <div className="flex flex-wrap gap-2">
              {MOTIVOS.map((m) => (
                <Chip
                  key={m}
                  className="cursor-pointer"
                  color={motivo === m ? "success" : "default"}
                  variant={motivo === m ? "solid" : "bordered"}
                  onClick={() => setMotivo(m)}
                >
                  {m}
                </Chip>
              ))}
            </div>
            <Input label="Motivo" value={motivo} onValueChange={setMotivo} />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              color="success"
              isDisabled={motivo.trim().length < 3}
              isLoading={guardando}
              onPress={confirmar}
            >
              Confirmar el punto
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={!!corrigiendo}
        size="2xl"
        onClose={() => setCorrigiendo(null)}
      >
        <ModalContent>
          <ModalHeader>Corregir el punto</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              {corrigiendo?.nombre}: {corrigiendo?.direccion || "sin dirección"}
            </p>
            {corrigiendo && <MapasComparados alto="h-48" it={corrigiendo} />}
            <Input
              description="En Google Maps, haz clic derecho sobre el sitio correcto y copia las coordenadas. También vale pegar el enlace del mapa."
              label="Punto nuevo"
              placeholder="20.03000, -75.82084"
              value={punto}
              onValueChange={setPunto}
            />
            {punto.trim() !== "" && (
              <p
                className={`text-sm ${nuevo ? "text-success-600" : "text-danger"}`}
              >
                {nuevo
                  ? `Se guardará ${nuevo.lat.toFixed(5)}, ${nuevo.lon.toFixed(5)}.`
                  : "No encuentro una latitud y una longitud en lo que escribiste."}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setCorrigiendo(null)}>
              Cancelar
            </Button>
            <Button
              color="primary"
              isDisabled={!nuevo}
              isLoading={guardando}
              onPress={corregir}
            >
              Guardar el punto
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
