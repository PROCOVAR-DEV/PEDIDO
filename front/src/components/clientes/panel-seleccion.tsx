import { Button, Chip, Pagination } from "@heroui/react";
import { useEffect, useState } from "react";

import type { Cliente } from "@/stores/datos/clientes";

const POR_PAGINA = 6;

/**
 * El resumen de lo marcado en el modo reasignar, flotando abajo a la derecha.
 *
 * Va fuera de la lista a propósito: con decenas de marcados, un resumen dentro de la página
 * la estiraría sin fin. Aquí tiene su propia paginación y su propio alto, y se puede plegar.
 */
export const PanelSeleccion = ({
  marcados,
  onQuitar,
  onLimpiar,
  onReasignar,
  onSalir,
}: {
  marcados: Cliente[];
  onQuitar: (c: Cliente) => void;
  onLimpiar: () => void;
  onReasignar: () => void;
  onSalir: () => void;
}) => {
  const [pagina, setPagina] = useState(1);
  const [plegado, setPlegado] = useState(false);
  const paginas = Math.max(1, Math.ceil(marcados.length / POR_PAGINA));

  // Si se quitan los de la última página, no quedarse mirando una que ya no existe.
  useEffect(() => {
    if (pagina > paginas) setPagina(paginas);
  }, [pagina, paginas]);

  const visibles = marcados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-default-200 bg-content1 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <button
          className="text-sm font-semibold"
          type="button"
          onClick={() => setPlegado((p) => !p)}
        >
          {marcados.length} seleccionado{marcados.length === 1 ? "" : "s"}{" "}
          <span className="text-default-500">{plegado ? "▲" : "▼"}</span>
        </button>
        {marcados.length > 0 && (
          <Button size="sm" variant="light" onPress={onLimpiar}>
            Desmarcar todos
          </Button>
        )}
      </div>
      {!plegado && marcados.length > 0 && (
        <>
          <div className="flex flex-col gap-1">
            {visibles.map((c) => (
              <Chip
                key={c.id}
                className="max-w-full"
                size="sm"
                variant="flat"
                onClose={() => onQuitar(c)}
              >
                {c.nombre}
                {c.vendedorNombre ? ` · ${c.vendedorNombre}` : ""}
              </Chip>
            ))}
          </div>
          {paginas > 1 && (
            <Pagination
              showControls
              className="self-center"
              page={pagina}
              size="sm"
              total={paginas}
              onChange={setPagina}
            />
          )}
        </>
      )}
      <div className="flex gap-2">
        <Button
          fullWidth
          color="primary"
          isDisabled={marcados.length === 0}
          size="sm"
          onPress={onReasignar}
        >
          Reasignar a otro vendedor
        </Button>
        <Button size="sm" variant="flat" onPress={onSalir}>
          Salir
        </Button>
      </div>
    </div>
  );
};
