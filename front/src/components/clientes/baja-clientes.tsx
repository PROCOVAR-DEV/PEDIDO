import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  addToast,
} from "@heroui/react";
import { useState } from "react";

import { getApiBaseUrl } from "@/config";
import type { Cliente } from "@/stores/datos/clientes";

/**
 * Dar de baja a mano (o volver a dar de alta) los clientes marcados.
 *
 * La baja NO borra nada: el cliente queda inactivo, no sale al reparto ni a Entrega, y los
 * pedidos NUEVOS que traigan los archivos para él se omiten (las demás filas entran). Lo que ya
 * está cargado sigue como estaba. Reactivar lo deshace.
 */
export const BajaClientes = ({
  modo,
  clientes,
  isOpen,
  onClose,
  onHecho,
}: {
  modo: "baja" | "reactivar";
  clientes: Cliente[];
  isOpen: boolean;
  onClose: () => void;
  onHecho: () => void;
}) => {
  const [guardando, setGuardando] = useState(false);
  const baja = modo === "baja";

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await fetch(
        `${getApiBaseUrl()}/clientes/${baja ? "baja" : "reactivar"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteIds: clientes.map((c) => c.id) }),
        },
      );
      const json = await r.json();

      if (!r.ok) throw new Error(json.error || "No se pudo");
      addToast({
        title: baja ? "Clientes dados de baja" : "Clientes reactivados",
        description: `${json.clientes} cliente${json.clientes === 1 ? "" : "s"}.`,
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
    <Modal isDismissable={false} isOpen={isOpen} placement="center" onClose={onClose}>
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              {baja ? "Dar de baja" : "Reactivar"} {clientes.length} cliente
              {clientes.length === 1 ? "" : "s"}
            </ModalHeader>
            <ModalBody>
              <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">
                {clientes.map((c) => (
                  <li key={c.id}>{c.nombre}</li>
                ))}
              </ul>
              <p className="text-sm text-default-600">
                {baja
                  ? "No se borra nada: quedan inactivos y dejan de salir en el reparto y en Entrega. Los pedidos nuevos que lleguen en los archivos para ellos se omiten; el resto de cada archivo entra normal. Lo ya cargado se queda como está."
                  : "Vuelven a estar activos y sus pedidos nuevos vuelven a entrar."}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancelar
              </Button>
              <Button
                color={baja ? "danger" : "primary"}
                isLoading={guardando}
                onPress={guardar}
              >
                {baja ? "Dar de baja" : "Reactivar"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
