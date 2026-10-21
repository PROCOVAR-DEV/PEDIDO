import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  addToast,
} from "@heroui/react";
import { useEffect, useState } from "react";

import { VendedorSelect, type VendedorOpcion } from "../vendedor-select";

import { getApiBaseUrl } from "@/config";
import type { Cliente } from "@/stores/datos/clientes";

/**
 * Pasar los clientes elegidos a otro vendedor.
 *
 * El cliente no tiene vendedor propio: lo es de quien tiene pedidos suyos. Reasignarlo mueve
 * TODOS sus pedidos al vendedor nuevo, y cada uno queda en su historial. Los clientes tienen
 * que ser de una sola sucursal (la del vendedor); la API lo vuelve a comprobar.
 */
export const ReasignarClientes = ({
  clientes,
  isOpen,
  onClose,
  onHecho,
}: {
  clientes: Cliente[];
  isOpen: boolean;
  onClose: () => void;
  onHecho: () => void;
}) => {
  const [vendedores, setVendedores] = useState<VendedorOpcion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);

  const sucursales = new Set(clientes.map((c) => c.sucursalId ?? ""));
  const mezcla = sucursales.size > 1;
  const sucursalId = clientes[0]?.sucursalId ?? "";

  useEffect(() => {
    if (!isOpen || mezcla || !sucursalId) return;
    setElegido("");
    setCargando(true);
    // Los de la sucursal DE LOS CLIENTES, no la que haya activa: la API no deja cruzar.
    fetch(`${getApiBaseUrl()}/vendedores?sucursalId=${sucursalId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v) =>
        setVendedores(
          (Array.isArray(v) ? v : []).filter(
            (x: VendedorOpcion & { activo?: boolean }) => x.activo !== false,
          ),
        ),
      )
      .catch(() => setVendedores([]))
      .finally(() => setCargando(false));
  }, [isOpen, mezcla, sucursalId]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/clientes/reasignar-vendedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteIds: clientes.map((c) => c.id),
          vendedorId: elegido,
        }),
      });
      const json = await r.json();

      if (!r.ok) throw new Error(json.error || "No se pudo reasignar");
      addToast({
        title: "Clientes reasignados",
        description:
          json.movidos > 0
            ? `${json.clientes} cliente${json.clientes === 1 ? "" : "s"} pasaron a ${json.vendedor} (${json.movidos} pedidos abiertos).`
            : `${json.clientes} cliente${json.clientes === 1 ? "" : "s"} pasaron a ${json.vendedor}.`,
        color: "success",
      });
      onClose();
      onHecho();
    } catch (err) {
      addToast({
        title: "No se pudo",
        description: err instanceof Error ? err.message : "Error desconocido",
        color: "danger",
      });
    } finally {
      setGuardando(false);
    }
  };

  // isDismissable={false}: la lista del selector se dibuja FUERA de la ventana, y con el cierre
  // por pulsar fuera, elegir un vendedor cerraba todo antes de poder reasignar.
  return (
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      placement="center"
      onClose={onClose}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              Reasignar {clientes.length} cliente{clientes.length === 1 ? "" : "s"}
            </ModalHeader>
            <ModalBody>
              {mezcla ? (
                <p className="text-sm text-danger">
                  Hay clientes de sucursales distintas. Reasigna de una sucursal
                  cada vez.
                </p>
              ) : (
                <>
                  <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">
                    {clientes.map((c) => (
                      <li key={c.id}>
                        {c.nombre}
                        {c.vendedorNombre ? (
                          <span className="text-default-500">
                            {" "}
                            · hoy de {c.vendedorNombre}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-default-600">
                    Desde ahora son del vendedor que elijas. Sus pedidos abiertos
                    (en proceso) pasan con ellos; lo ya hecho se queda con el
                    vendedor de entonces.
                  </p>
                  <VendedorSelect
                    claveTodos=""
                    etiquetaTodos="Elige el vendedor nuevo"
                    isLoading={cargando}
                    value={elegido}
                    vendedores={vendedores}
                    onChange={setElegido}
                  />
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancelar
              </Button>
              <Button
                color="primary"
                isDisabled={!elegido || mezcla}
                isLoading={guardando}
                onPress={guardar}
              >
                Reasignar
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
