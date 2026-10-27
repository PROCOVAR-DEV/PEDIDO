import { Card, CardBody, Select, SelectItem, Skeleton } from "@heroui/react";
import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useDashboard } from "@/providers/DashboardProvider";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// Tokens de HeroUI, así que sirven en claro y en oscuro.
const config = {
  completed: { label: "Completados", color: "hsl(var(--heroui-success))" },
  pending: { label: "Sin completar", color: "hsl(var(--heroui-primary-300))" },
  anterior: { label: "Año anterior", color: "hsl(var(--heroui-default-400))" },
} satisfies ChartConfig;

const num = (n: number) => n.toLocaleString("es-ES");
const pct = (parte: number, todo: number) =>
  todo ? `${Math.round((parte / todo) * 100)} %` : "—";

/** Mes y año de hoy en Cuba: el mes en curso es el que se resalta. */
const hoyEnCuba = () => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .split("-");

  return { year: Number(y), mes: Number(m) - 1 };
};

interface Fila {
  mes: string;
  completed: number | null;
  pending: number | null;
  total: number | null;
  anterior: number | null;
}

/** Al pasar por un mes: una frase con todo lo que importa de ese mes. */
function Puntero({
  active,
  payload,
  anio,
}: {
  active?: boolean;
  payload?: Array<{ payload: Fila }>;
  anio: number;
}) {
  const f = payload?.[0]?.payload;

  if (!active || !f || f.total == null) return null;

  return (
    <div className="rounded-lg border border-divider bg-content1 px-3 py-2 text-xs shadow-md">
      <span className="font-semibold">{f.mes}</span> · {num(f.total)} pedidos ·{" "}
      {num(f.completed ?? 0)} completados ({pct(f.completed ?? 0, f.total)}) ·{" "}
      {num(f.pending ?? 0)} sin completar
      {f.anterior != null && (
        <span className="text-default-500">
          {" "}
          · {anio - 1}: {num(f.anterior)}
        </span>
      )}
    </div>
  );
}

/**
 * Pedidos del año, mes a mes, en columnas apiladas (completados abajo, sin completar
 * encima: la suma es el total del mes). El mes en curso va resaltado; los meses que aún no
 * han llegado no tienen columna (no son un cero). Una línea punteada marca el promedio
 * mensual y, si el año anterior tiene datos, una línea gris fina da el total de cada mes
 * de entonces para comparar.
 *
 * Ocupa todo el alto del contenedor: la altura la manda quien lo coloca.
 */
export function LineChartCard() {
  const { stats, isLoading, selectedYear, setSelectedYear } = useDashboard();
  const { monthlyStats = [], availableYears = [] } = stats || {};

  const year = selectedYear ?? availableYears[0] ?? new Date().getFullYear();

  const d = useMemo(() => {
    const delAnio = (y: number) => monthlyStats.filter((m) => m.year === y);
    const actual = delAnio(year);
    const previo = delAnio(year - 1);
    const filas = MESES.map((mes, i) => {
      const m = actual.find((x) => x.month === i + 1);
      const p = previo.find((x) => x.month === i + 1);

      return {
        mes,
        total: m?.total ?? 0,
        completed: m?.completed ?? 0,
        anterior: p && p.total > 0 ? p.total : null,
      };
    });
    // Último mes con pedidos: de ahí en adelante no hay dato (ni columna ni cero).
    const ult = filas.reduce((u, f, i) => (f.total > 0 ? i : u), -1);
    const datos: Fila[] = filas.map((f, i) => ({
      mes: f.mes,
      completed: i <= ult ? f.completed : null,
      pending: i <= ult ? f.total - f.completed : null,
      total: i <= ult ? f.total : null,
      anterior: f.anterior,
    }));
    const conDatos = filas.slice(0, ult + 1).filter((f) => f.total > 0);
    const suma = conDatos.reduce((a, f) => a + f.total, 0);
    const completados = conDatos.reduce((a, f) => a + f.completed, 0);
    const pico = conDatos.reduce<(typeof filas)[number] | null>(
      (p, f) => (!p || f.total > p.total ? f : p),
      null,
    );

    return {
      datos,
      suma,
      completados,
      sinCompletar: suma - completados,
      promedio: conDatos.length ? Math.round(suma / conDatos.length) : 0,
      pico,
      hayAnterior: filas.some((f) => f.anterior != null),
      totalAnterior: filas.reduce((a, f) => a + (f.anterior ?? 0), 0),
    };
  }, [monthlyStats, year]);

  const hoy = hoyEnCuba();
  const mesEnCurso = hoy.year === year ? hoy.mes : -1;

  if (isLoading) {
    return (
      <Card className="h-full w-full" shadow="none">
        <Skeleton className="h-full min-h-[200px] w-full rounded-lg" />
      </Card>
    );
  }

  const resumen = `${num(d.suma)} pedidos en ${year}: ${num(d.completados)} completados (${pct(d.completados, d.suma)}) y ${num(d.sinCompletar)} sin completar; promedio de ${num(d.promedio)} al mes`;

  // Cada columna lleva su opacidad: el mes en curso, entero; los demás, algo más suaves.
  const forma = (redondeaSiempre: boolean) =>
    function Columna(p: any) {
      const f: Fila = p.payload;
      const arriba = redondeaSiempre || f.pending === 0;
      const opacidad = mesEnCurso < 0 || p.index === mesEnCurso ? 1 : 0.62;

      return (
        <Rectangle
          {...p}
          fillOpacity={opacidad}
          radius={arriba ? [4, 4, 0, 0] : 0}
        />
      );
    };

  return (
    <Card className="h-full w-full" shadow="none">
      <CardBody className="min-h-0 flex-col gap-0 overflow-y-clip border border-divider p-0">
        <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-divider px-4 py-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">Pedidos del año</h2>
            <Select
              disallowEmptySelection
              aria-label="Año"
              className="w-24"
              classNames={{ trigger: "min-h-8 h-8" }}
              selectedKeys={[String(year)]}
              size="sm"
              variant="flat"
              onChange={(e) => {
                if (e.target.value) setSelectedYear(parseInt(e.target.value));
              }}
            >
              {availableYears.map((y) => (
                <SelectItem key={String(y)} textValue={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </Select>
            <span className="text-sm text-default-600">
              <span className="font-semibold tabular-nums text-foreground">
                {num(d.suma)}
              </span>{" "}
              pedidos, {pct(d.completados, d.suma)} completados
            </span>
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 text-xs text-default-600">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: config.completed.color }}
              />
              Completados
              <span className="font-semibold tabular-nums text-foreground">
                {num(d.completados)}
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: config.pending.color }}
              />
              Sin completar
              <span className="font-semibold tabular-nums text-foreground">
                {num(d.sinCompletar)}
              </span>
            </li>
            {d.hayAnterior && (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-3"
                  style={{ background: config.anterior.color }}
                />
                {year - 1}
                <span className="font-semibold tabular-nums text-foreground">
                  {num(d.totalAnterior)}
                </span>
              </li>
            )}
          </ul>
        </div>

        <div
          aria-label={resumen}
          className="relative min-h-[140px] flex-1"
          role="img"
        >
          {d.suma === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-default-500">
              Todavía no hay pedidos en {year}.
            </p>
          ) : (
            <div className="absolute inset-0 px-2 pb-1 pt-3">
              <ChartContainer
                className="aspect-auto h-full w-full"
                config={config}
              >
                <ComposedChart
                  data={d.datos}
                  margin={{ top: 16, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="hsl(var(--heroui-divider))"
                    strokeOpacity={0.5}
                    vertical={false}
                  />
                  <XAxis
                    axisLine={false}
                    dataKey="mes"
                    tickFormatter={(v: string) => v.slice(0, 3).toLowerCase()}
                    tickLine={false}
                    tickMargin={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickCount={3}
                    tickFormatter={num}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    content={<Puntero anio={year} />}
                    cursor={{
                      fill: "hsl(var(--heroui-default-100))",
                      fillOpacity: 0.5,
                    }}
                  />
                  <Bar
                    dataKey="completed"
                    fill={config.completed.color}
                    isAnimationActive={false}
                    maxBarSize={44}
                    shape={forma(false)}
                    stackId="mes"
                  />
                  <Bar
                    dataKey="pending"
                    fill={config.pending.color}
                    isAnimationActive={false}
                    maxBarSize={44}
                    shape={forma(true)}
                    stackId="mes"
                  />
                  {d.hayAnterior && (
                    <Line
                      connectNulls={false}
                      dataKey="anterior"
                      dot={false}
                      isAnimationActive={false}
                      stroke={config.anterior.color}
                      strokeWidth={1}
                      type="monotone"
                    />
                  )}
                  <ReferenceLine
                    ifOverflow="extendDomain"
                    label={{
                      value: `Promedio ${num(d.promedio)}`,
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "hsl(var(--heroui-default-600))",
                    }}
                    stroke="hsl(var(--heroui-default-500))"
                    strokeDasharray="4 4"
                    y={d.promedio}
                  />
                  {d.pico && (
                    <ReferenceDot
                      fill="transparent"
                      label={{
                        value: `máx. ${num(d.pico.total)}`,
                        position: "top",
                        fontSize: 11,
                        fill: "hsl(var(--heroui-foreground))",
                      }}
                      r={0}
                      stroke="transparent"
                      x={d.pico.mes}
                      y={d.pico.total}
                    />
                  )}
                </ComposedChart>
              </ChartContainer>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
