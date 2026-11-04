import { Button, Chip, Tooltip } from "@heroui/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getApiBaseUrl } from "@/config";

/**
 * Entrada a «Ubicaciones por revisar» desde Clientes: un botón con cuántas hay.
 *
 * Solo lo ve quien puede revisarlas (Supervisor para arriba): para el resto el servidor contesta 403 y el
 * botón no sale.
 */
export function EnlaceUbicaciones() {
  const navegar = useNavigate();
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;

    fetch(`${getApiBaseUrl()}/clientes/geo-dudosos?limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j && typeof j.total === "number") setTotal(j.total);
      })
      .catch(() => undefined);

    return () => {
      vivo = false;
    };
  }, []);

  if (total === null) return null;

  return (
    <div className="flex justify-end">
      <Tooltip content="Clientes cuyo punto en el mapa no cae donde dice su dirección">
        <Button
          color={total > 0 ? "warning" : "default"}
          size="sm"
          startContent={
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          }
          variant="flat"
          onPress={() => navegar("/panel/clientes/ubicaciones")}
        >
          Ubicaciones por revisar
          {total > 0 && (
            <Chip color="warning" size="sm" variant="solid">
              {total}
            </Chip>
          )}
        </Button>
      </Tooltip>
    </div>
  );
}
