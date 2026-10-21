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
import { useMemo, useState } from "react";

import { VendedorSelect } from "../vendedor-select";
import { ACCION_TARJETA } from "../primitives";

import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import type { Vendedor } from "@/stores/datos/vendedores";

/**
 * Pasar TODOS los clientes de un vendedor a otro, de una vez.
 *
 * El cliente no tiene vendedor propio: lo es de quien tiene pedidos suyos, así que esto mueve
 * todos los pedidos del vendedor. Solo a uno de su misma sucursal y de alta. Solo
 * Supervisor para arriba; la API lo vuelve a comprobar.
 */
export const PasarClientes = ({
  vendedor,
  todos,
  onHecho,
}: {
  vendedor: Vendedor;
  todos: Vendedor[];
  onHecho: () => void;
}) => {
  const { session } = useAuthStore();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);

  const candidatos = useMemo(
    () =>
      todos.filter(
        (v) =>
          v.id !== vendedor.id &&
          v.activo &&
          v.sucursalId &&
          v.sucursalId === vendedor.sucursalId,
      ),
    [todos, vendedor],
  );

  const pedidos = vendedor._count?.pedidos ?? 0;

  if (
    !session?.isGlobalAdmin &&
    !["SUPERVISOR", "GERENTE", "ADMINISTRADOR"].includes(session?.rol ?? "")
  )
    return null;
  if (pedidos === 0 || !vendedor.sucursalId) return null;

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await fetch(
        `${getApiBaseUrl()}/vendedores/${vendedor.id}/reasignar-clientes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendedorId: elegido }),
        },
      );
      const json = await r.json();

      if (!r.ok) throw new Error(json.error || "No se pudo reasignar");
      addToast({
        title: "Clientes reasignados",
        description: `${json.clientes} cliente${json.clientes === 1 ? "" : "s"} pasaron a ${json.vendedor} (${json.pedidosAbiertos} pedidos abiertos).`,
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
        variant="ghost"
        onPress={() => {
          setElegido("");
          onOpen();
        }}
      >
        Pasar sus clientes
      </Button>
      <Modal isOpen={isOpen} placement="center" onClose={onClose}>
        <ModalContent>
          {() => (
            <>
              <ModalHeader>Pasar los clientes de {vendedor.nombre}</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  Todos sus clientes pasarán a ser del vendedor que elijas, de la
                  misma sucursal. Sus pedidos abiertos (en proceso) van con
                  ellos; lo ya hecho se queda con {vendedor.nombre}.
                </p>
                <VendedorSelect
                  claveTodos=""
                  etiquetaTodos="Elige el vendedor nuevo"
                  value={elegido}
                  vendedores={candidatos}
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
                  Pasar todos
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};
