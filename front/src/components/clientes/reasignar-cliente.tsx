import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  addToast,
  useDisclosure,
} from "@heroui/react";
import { useState } from "react";

import Icons from "../icons/iconify";
import { ACCION_TARJETA } from "../primitives";
import { VendedorSelect, type VendedorOpcion } from "../vendedor-select";

import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import type { Cliente } from "@/stores/datos/clientes";

/**
 * Pasar un cliente a otro vendedor.
 *
 * El cliente no tiene vendedor propio: lo es de quien tiene pedidos suyos. Reasignarlo mueve
 * TODOS sus pedidos al vendedor nuevo, y cada uno queda en su historial. Solo Administrador y
 * roles globales; la API lo vuelve a comprobar.
 */
export const ReasignarCliente = ({
  cliente,
  onHecho,
}: {
  cliente: Cliente;
  onHecho: () => void;
}) => {
  const { session } = useAuthStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [vendedores, setVendedores] = useState<VendedorOpcion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!session?.isGlobalAdmin && session?.rol !== "ADMINISTRADOR") return null;

  const abrir = async () => {
    setElegido("");
    onOpen();
    setCargando(true);
    try {
      // Los de la sucursal DEL CLIENTE, no la que haya activa: la API no deja cruzar.
      const q = cliente.sucursalId ? `?sucursalId=${cliente.sucursalId}` : "";
      const r = await fetch(`${getApiBaseUrl()}/vendedores${q}`);
      const v = r.ok ? await r.json() : [];

      setVendedores(
        (Array.isArray(v) ? v : []).filter(
          (x: VendedorOpcion & { activo?: boolean }) => x.activo !== false,
        ),
      );
    } finally {
      setCargando(false);
    }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await fetch(
        `${getApiBaseUrl()}/clientes/${cliente.id}/reasignar-vendedor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendedorId: elegido }),
        },
      );
      const json = await r.json();

      if (!r.ok) throw new Error(json.error || "No se pudo reasignar");
      addToast({
        title: "Cliente reasignado",
        description:
          json.movidos > 0
            ? `${json.movidos} pedido${json.movidos === 1 ? "" : "s"} pasaron a ${json.vendedor}.`
            : `Ya era todo de ${json.vendedor}.`,
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

  return (
    <>
      <Button
        className={ACCION_TARJETA}
        color="default"
        startContent={<Icons.client className="size-5" />}
        variant="ghost"
        onPress={abrir}
      >
        Reasignar
      </Button>
      <Modal isOpen={isOpen} placement="center" onClose={onClose}>
        <ModalContent>
          {() => (
            <>
              <ModalHeader>Reasignar a {cliente.nombre}</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  Todos sus pedidos pasarán al vendedor que elijas. Cada cambio queda en el
                  historial del pedido.
                </p>
                <VendedorSelect
                  claveTodos=""
                  etiquetaTodos="Elige el vendedor nuevo"
                  isLoading={cargando}
                  value={elegido}
                  vendedores={vendedores}
                  onChange={setElegido}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancelar
                </Button>
                <Button
                  color="primary"
                  isDisabled={!elegido}
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
    </>
  );
};
