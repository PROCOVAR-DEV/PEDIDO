import { Link } from "@heroui/react";

import Icons from "@/components/icons/iconify";
import { cn } from "@/lib/utils";

type Color = "primary" | "secondary" | "success" | "warning" | "danger";

// Clases enteras y no `bg-${color}-50`: Tailwind sólo genera las que lee escritas.
const COLORES: Record<Color, string> = {
  primary: "bg-primary-50 border-primary-100 text-primary-600",
  secondary: "bg-secondary-50 border-secondary-100 text-secondary",
  success: "bg-success-50 border-success-100 text-success",
  warning: "bg-warning-50 border-warning-100 text-warning-600",
  danger: "bg-danger-50 border-danger-100 text-danger",
};

// Foco visible (teclado), sin transiciones si el usuario pidió menos movimiento.
const FOCO =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";

const icono = (nombre: string) =>
  (Icons as any)[nombre] as React.ElementType | undefined;

/**
 * Baldosa de acceso. Todo el rectángulo es el enlace. Sólo borde: sin sombra, que el
 * peso lo lleve el tamaño y no la decoración.
 */
export function AccesoRapido({
  href,
  icon,
  title,
  description,
  color = "primary",
  insignia,
  className,
}: {
  href: string;
  icon: keyof typeof Icons | string;
  title: string;
  description: string;
  color?: Color;
  /** Un recuento que pide atención (p. ej. pedidos retenidos). Sólo se pinta si es > 0. */
  insignia?: { valor: number; etiqueta: string };
  className?: string;
}) {
  const Icono = icono(icon);
  const conInsignia = !!insignia && insignia.valor > 0;

  return (
    <Link
      className={cn(
        "relative flex min-h-[88px] items-center gap-3 rounded-xl border border-default-200 bg-content1 p-3 text-foreground transition-colors hover:border-default-400 hover:bg-default-100",
        FOCO,
        className,
      )}
      href={href}
    >
      <span
        className={cn("flex shrink-0 rounded-lg border p-2.5", COLORES[color])}
      >
        {Icono && <Icono aria-hidden className="size-7" />}
      </span>
      <span className={cn("flex min-w-0 flex-col", conInsignia && "pr-9")}>
        <span className="text-base font-semibold leading-tight">{title}</span>
        <span className="line-clamp-2 text-xs text-default-500">
          {description}
        </span>
      </span>
      {conInsignia && (
        <span className="absolute right-2.5 top-2.5 min-w-6 rounded-full bg-warning px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-warning-foreground">
          {insignia!.valor}
          <span className="sr-only"> {insignia!.etiqueta}</span>
        </span>
      )}
    </Link>
  );
}

/**
 * La baldosa que manda: Pedidos, a color pleno y el doble de grande, con el dato vivo del
 * día dentro. La jerarquía sale de ahí —tamaño y color—, no de adornos.
 *
 * `alto`: en escritorio ocupa dos filas y se coloca en columna; si no, va en una fila.
 */
export function AccesoPrincipal({
  href,
  icon,
  title,
  description,
  dato,
  etiquetaDato,
  cargando,
  alto,
  className,
}: {
  href: string;
  icon: keyof typeof Icons | string;
  title: string;
  description: string;
  dato?: number | null;
  etiquetaDato?: string;
  cargando?: boolean;
  alto?: boolean;
  className?: string;
}) {
  const Icono = icono(icon);
  const hayDato = dato != null || cargando;

  return (
    <Link
      className={cn(
        "flex min-h-[88px] items-center gap-3 rounded-2xl bg-primary p-4 text-primary-foreground transition-colors hover:bg-primary-600",
        alto && "xl:flex-col xl:items-stretch xl:justify-between",
        FOCO,
        className,
      )}
      href={href}
    >
      <span className="flex items-center gap-3">
        <span className="flex shrink-0 rounded-xl bg-primary-foreground/15 p-3">
          {Icono && <Icono aria-hidden className="size-9" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-xl font-semibold leading-tight">{title}</span>
          <span className="text-sm opacity-90">{description}</span>
        </span>
      </span>
      {hayDato && (
        <span
          className={cn(
            "ml-auto flex items-baseline gap-2 text-right",
            alto && "xl:ml-0 xl:text-left",
          )}
        >
          {cargando && dato == null ? (
            <span
              aria-label="Cargando"
              className="inline-block h-9 w-12 animate-pulse rounded bg-primary-foreground/30 motion-reduce:animate-none"
            />
          ) : (
            <span className="text-4xl font-semibold tabular-nums leading-none">
              {dato}
            </span>
          )}
          <span className="text-sm opacity-90">{etiquetaDato}</span>
        </span>
      )}
    </Link>
  );
}
