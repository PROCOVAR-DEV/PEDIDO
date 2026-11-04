import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pagination,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * Ubicaciones por revisar (issue #13): clientes cuyo punto no cae donde dice su dirección.
 *
 * El punto se compara con los OTROS clientes de la misma calle (ver `api/src/lib/geoDireccion.ts`).
 * Es un aviso: el supervisor decide si el punto está bien (lo confirma, con un motivo) o lo corrige.
 * Queda apuntado quién y cuándo.
 */

interface Vecino {
  id: string;
  nombre: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
}

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
  motivo: "calle" | "lejos_del_municipio";
  vecino: Vecino | null;
  sucursal: { codigo: string | null; nombre: string } | null;
}

interface Respuesta {
  total: number;
  limit: number;
  cuentas: Record<string, number>;
  items: Item[];
}

const mapa = (lat: number, lon: number) =>
  `https://www.google.com/maps?q=${lat},${lon}`;

const km = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());

export function UbicacionesDudosas() {
  const [estado, setEstado] = useState("todos");
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [revisando, setRevisando] = useState(false);

  const [confirmando, setConfirmando] = useState<Item | null>(null);
  const [motivo, setMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState<Item | null>(null);
  const [punto, setPunto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(
        `${getApiBaseUrl()}/clientes/geo-dudosos?estado=${estado}&page=${page}&limit=25`,
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
  }, [estado, page]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    setPage(1);
  }, [estado]);

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
        description: `${r.coincide ?? 0} coinciden · ${r.revisar ?? 0} por revisar · ${r.no_coincide ?? 0} no coinciden · ${r.sin_referencia ?? 0} sin referencia`,
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
      addToast({ title: "Ubicación confirmada", color: "success" });
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

  const corregir = async () => {
    if (!corrigiendo) return;
    const [lat, lon] = punto.split(/[,;\s]+/).map(Number);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      addToast({
        title: "Escribe latitud y longitud",
        description: "Por ejemplo: 20.03000, -75.82084",
        color: "warning",
      });

      return;
    }
    setGuardando(true);
    try {
      await llamar(`/clientes/${corrigiendo.id}/geo`, "PATCH", {
        latitud: lat,
        longitud: lon,
      });
      addToast({ title: "Ubicación corregida", color: "success" });
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

  const cuentas = datos?.cuentas ?? {};
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.limit)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="max-w-xs"
          label="Mostrar"
          selectedKeys={[estado]}
          onChange={(e) => setEstado(e.target.value || "todos")}
        >
          <SelectItem key="todos">{`Todos (${(cuentas.revisar ?? 0) + (cuentas.no_coincide ?? 0)})`}</SelectItem>
          <SelectItem key="no_coincide">{`No coinciden (${cuentas.no_coincide ?? 0})`}</SelectItem>
          <SelectItem key="revisar">{`Por revisar (${cuentas.revisar ?? 0})`}</SelectItem>
        </Select>
        <Button
          color="primary"
          isLoading={revisando}
          variant="flat"
          onPress={volverARevisar}
        >
          Volver a revisar todos
        </Button>
        <p className="text-xs text-default-500">
          Se compara el punto con los demás clientes de la misma calle. Es un
          aviso: tú decides si está bien.
          {cuentas.confirmado ? ` ${cuentas.confirmado} ya confirmados.` : ""}
        </p>
      </div>

      <Table
        aria-label="Ubicaciones por revisar"
        bottomContent={
          paginas > 1 ? (
            <div className="flex justify-center">
              <Pagination page={page} total={paginas} onChange={setPage} />
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn>CLIENTE</TableColumn>
          <TableColumn>DIRECCIÓN</TableColumn>
          <TableColumn>ESTADO</TableColumn>
          <TableColumn>SE COMPARÓ CON</TableColumn>
          <TableColumn>ACCIONES</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={cargando ? " " : "No hay ubicaciones por revisar."}
          isLoading={cargando}
          items={datos?.items ?? []}
          loadingContent={<Spinner />}
        >
          {(it) => (
            <TableRow key={it.id}>
              <TableCell>
                <p className="font-medium">{it.nombre}</p>
                <p className="text-xs text-default-500">
                  {it.sucursal?.codigo ?? ""}{" "}
                  {it.codigo ? `· ${it.codigo}` : ""}
                </p>
              </TableCell>
              <TableCell>
                <p>{it.direccion || "—"}</p>
                <p className="text-xs text-default-500">{it.municipio ?? ""}</p>
              </TableCell>
              <TableCell>
                <Chip
                  color={it.geoEstado === "no_coincide" ? "danger" : "warning"}
                  size="sm"
                  variant="flat"
                >
                  {it.geoEstado === "no_coincide" ? "No coincide" : "Revisar"}
                </Chip>
                <p className="mt-1 text-xs text-default-500">
                  {it.motivo === "lejos_del_municipio"
                    ? "Muy lejos del resto de su municipio"
                    : it.geoDistanciaKm != null
                      ? `A ${km(it.geoDistanciaKm)} km de su calle`
                      : ""}
                </p>
              </TableCell>
              <TableCell>
                {it.vecino ? (
                  <>
                    <p className="text-sm">{it.vecino.nombre}</p>
                    <p className="text-xs text-default-500">
                      {it.vecino.direccion ?? ""}
                    </p>
                    {it.vecino.latitud != null &&
                      it.vecino.longitud != null && (
                        <a
                          className="text-xs text-primary"
                          href={mapa(it.vecino.latitud, it.vecino.longitud)}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Ver en el mapa
                        </a>
                      )}
                  </>
                ) : (
                  <span className="text-xs text-default-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="text-xs text-primary"
                    href={mapa(it.latitud, it.longitud)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Ver su punto
                  </a>
                  <Button
                    color="success"
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      setConfirmando(it);
                      setMotivo("");
                    }}
                  >
                    Está bien
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      setCorrigiendo(it);
                      setPunto(`${it.latitud}, ${it.longitud}`);
                    }}
                  >
                    Corregir
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Modal isOpen={!!confirmando} onClose={() => setConfirmando(null)}>
        <ModalContent>
          <ModalHeader>La ubicación es correcta</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              {confirmando?.nombre} — {confirmando?.direccion}
            </p>
            <Input
              label="Motivo (corto)"
              value={motivo}
              onValueChange={setMotivo}
            />
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
              Confirmar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={!!corrigiendo} onClose={() => setCorrigiendo(null)}>
        <ModalContent>
          <ModalHeader>Corregir la ubicación</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              {corrigiendo?.nombre} — {corrigiendo?.direccion}
            </p>
            <Input
              description="Latitud y longitud, separadas por coma"
              label="Punto"
              value={punto}
              onValueChange={setPunto}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setCorrigiendo(null)}>
              Cancelar
            </Button>
            <Button color="primary" isLoading={guardando} onPress={corregir}>
              Guardar punto
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
