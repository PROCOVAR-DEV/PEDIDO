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

/** Baldosa compacta de acceso: icono, título y una línea. Todo el rectángulo es el enlace. */
export function AccesoRapido({
  href,
  icon,
  title,
  description,
  color = "primary",
}: {
  href: string;
  icon: keyof typeof Icons | string;
  title: string;
  description: string;
  color?: Color;
}) {
  const Icono = (Icons as any)[icon] as React.ElementType | undefined;

  return (
    <Link
      className="flex items-center gap-3 rounded-large border border-default-200 bg-content1 p-3 text-foreground transition-colors hover:border-default-300 hover:bg-default-100"
      href={href}
    >
      <span
        className={cn(
          "flex shrink-0 rounded-medium border p-2",
          COLORES[color],
        )}
      >
        {Icono && <Icono aria-hidden className="size-6" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-default-500">{description}</span>
      </span>
    </Link>
  );
}

/** Un grupo de accesos con su título; si no queda ninguno visible, no se pinta. */
export function GrupoAccesos({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  const hijos = Array.isArray(children) ? children.filter(Boolean) : children;

  if (!hijos || (Array.isArray(hijos) && hijos.length === 0)) return null;

  return (
    <section aria-label={titulo}>
      <h3 className="mb-2 text-sm font-semibold text-default-500">{titulo}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {hijos}
      </div>
    </section>
  );
}
