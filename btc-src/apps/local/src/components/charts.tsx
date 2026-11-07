"use client";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, LineSeries, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { fmtMoney } from "@bst/domain";
import { useAppState } from "@/lib/state";

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface TradeMarker { id: string; ts: number; kind: "ENTRY" | "EXIT"; price: number }

export const C = { btc: "#f7931a", accent: "#ebcd2f", gain: "#2ec45a", loss: "#f0474f", muted: "#a1a1a6", grid: "#343436", line: "#3a3a3c", ink2: "#cfcfd2", usdc: "#2775ca" };
const axis = { stroke: C.muted, fontSize: 12, tickLine: false, axisLine: false } as const;
const dateFmt = (ts: number, long = false) => new Intl.DateTimeFormat("pt-BR", long ? { day: "2-digit", month: "short", year: "numeric" } : { day: "2-digit", month: "short" }).format(ts * 1000).replace(".", "");

function Tip({ active, payload, label, fmt, names }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: number; fmt: (v: number) => string; names: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line-strong bg-surface-3 px-3 py-2 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
      <div className="mb-1 text-muted">{label ? dateFmt(label, true) : ""}</div>
      {payload.filter((p) => p.value != null && names[p.dataKey]).map((p) => <div key={p.dataKey} className="num flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: p.color }} />{names[p.dataKey]}: <b>{fmt(p.value)}</b></div>)}
    </div>
  );
}

export interface SeriesPoint { ts: number; equity: number; contrib: number; hodl: number | null; inBtc: boolean }

/** Carteira × valor investido × só segurar BTC. Valores já na moeda de exibição. */
export function EquityChart({ points, height = 260, ccy = "USD" }: { points: SeriesPoint[]; height?: number; ccy?: "USD" | "BRL" }) {
  const { hidden } = useAppState();
  const fmt = (v: number) => (hidden ? "•••" : fmtMoney(v, ccy, { compact: true }).replace(/^R\$\s?|^US\$\s?/, ""));
  const bands = useMemo(() => {
    const out: { x1: number; x2: number }[] = [];
    let s: number | null = null;
    points.forEach((p, i) => {
      if (p.inBtc && s == null) s = p.ts;
      if ((!p.inBtc || i === points.length - 1) && s != null) { out.push({ x1: s, x2: p.inBtc ? p.ts : points[i - 1]!.ts }); s = null; }
    });
    return out;
  }, [points]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={points} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
        {bands.map((b) => <ReferenceArea key={b.x1} x1={b.x1} x2={b.x2} fill={C.btc} fillOpacity={0.08} ifOverflow="visible" />)}
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" {...axis} tickFormatter={(t) => dateFmt(t)} minTickGap={48} />
        <YAxis {...axis} width={52} tickFormatter={(v) => fmt(v)} domain={["auto", "auto"]} />
        <Tooltip content={<Tip fmt={(v) => (hidden ? "•••" : fmtMoney(v, ccy))} names={{ equity: "Carteira", hodl: "Só segurar BTC", contrib: "Investido" }} />} />
        <Line type="stepAfter" dataKey="contrib" stroke={C.muted} strokeDasharray="6 5" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line type="monotone" dataKey="hodl" stroke={C.btc} dot={false} strokeWidth={1.75} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="equity" stroke={C.accent} dot={false} strokeWidth={2.5} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Patrimônio convertido em BTC a cada dia. */
export function BtcChart({ points, height = 200 }: { points: { ts: number; btc: number }[]; height?: number }) {
  const { hidden } = useAppState();
  const f = (v: number) => (hidden ? "•••" : v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <defs><linearGradient id="btcq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.18} /><stop offset="100%" stopColor={C.accent} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" {...axis} tickFormatter={(t) => dateFmt(t)} minTickGap={48} />
        <YAxis {...axis} width={56} tickFormatter={f} domain={["auto", "auto"]} />
        <Tooltip content={<Tip fmt={(v) => `${f(v)} BTC`} names={{ btc: "Patrimônio" }} />} />
        <Area type="monotone" dataKey="btc" stroke={C.accent} fill="url(#btcq)" strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Meia-rosca de alocação. */
export function SemiDonut({ parts, center, sub }: { parts: { label: string; value: number; color: string }[]; center: ReactNode; sub?: ReactNode }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const R = 150, r = 98, cx = 170, cy = 165;
  let a0 = Math.PI;
  const arcs = parts.filter((p) => p.value > 0).map((p) => {
    const a1 = a0 - (p.value / total) * Math.PI;
    const pt = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)} ${cy - rad * Math.sin(ang)}`;
    const large = a0 - a1 > Math.PI ? 1 : 0;
    const path = `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    const out = { path, color: p.color, key: p.label };
    a0 = a1;
    return out;
  });
  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      <svg viewBox="0 0 340 172" className="w-full" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {arcs.length ? arcs.map((a) => <path key={a.key} d={a.path} fill={a.color} />) : <path d={`M 20 165 A 150 150 0 0 1 320 165 L 268 165 A 98 98 0 0 0 72 165 Z`} fill="#343436" />}
        <path d={`M ${cx - r + 8} ${cy} A ${r - 8} ${r - 8} 0 0 1 ${cx + r - 8} ${cy} Z`} fill="#2b2b2c" />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="num text-[30px] font-bold leading-none">{center}</div>
        {sub && <div className="mt-1.5 text-[15px] text-muted">{sub}</div>}
      </div>
    </div>
  );
}

/** Rentabilidade acumulada (%), sem o efeito de aportes e retiradas. */
export function ReturnChart({ points, height = 200 }: { points: { ts: number; equity: number; netFlow: number }[]; height?: number }) {
  const rows = useMemo(() => {
    let idx = 1;
    return points.map((p, i) => {
      if (i > 0) { const prev = points[i - 1]!.equity; if (prev > 0) idx *= (p.equity - p.netFlow) / prev; }
      return { ts: p.ts, r: (idx - 1) * 100 };
    });
  }, [points]);
  const up = (rows.at(-1)?.r ?? 0) >= 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" {...axis} tickFormatter={(t) => dateFmt(t)} minTickGap={56} />
        <YAxis {...axis} width={44} orientation="right" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
        <ReferenceLine y={0} stroke={C.line} />
        <Tooltip content={<Tip fmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`} names={{ r: "Rentabilidade" }} />} />
        <Area type="monotone" dataKey="r" stroke={up ? C.gain : C.loss} fill={up ? C.gain : C.loss} fillOpacity={0.1} strokeWidth={1.75} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ points, height = 140 }: { points: { ts: number; dd: number }[]; height?: number }) {
  const minDd = Math.min(0, ...points.map((p) => -p.dd * 100));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points.map((p) => ({ ts: p.ts, dd: -p.dd * 100 }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" {...axis} tickFormatter={(t) => dateFmt(t)} minTickGap={56} />
        <YAxis {...axis} width={44} orientation="right" allowDecimals tickFormatter={(v) => { const n = Number(v); const k = Math.abs(minDd) < 5 ? 1 : 0; return `${(Object.is(n, -0) ? 0 : n).toFixed(k).replace(".", ",")}%`; }} />
        <Tooltip content={<Tip fmt={(v) => `${v.toFixed(2).replace(".", ",")}%`} names={{ dd: "Queda desde o pico" }} />} />
        <Area type="monotone" dataKey="dd" stroke={C.loss} fill={C.loss} fillOpacity={0.12} strokeWidth={1.25} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Gráfico de preço (TradingView Lightweight Charts) com compras/vendas sobrepostas,
 * preço médio e níveis. Clique num marcador para ver a operação.
 */
export function PriceChart({ candles, markers = [], avgCost, levels = [], height = 420, onMarkerClick, overlays }: {
  candles: Candle[]; markers?: TradeMarker[]; avgCost?: number | null; levels?: { price: number; kind: string }[]; height?: number;
  onMarkerClick?: (m: TradeMarker) => void; overlays?: { sma?: (number | null)[][]; volume?: boolean };
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const cb = useRef(onMarkerClick);
  cb.current = onMarkerClick;

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      height, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.muted, fontFamily: "Inter Variable, -apple-system, sans-serif", fontSize: 11, attributionLogo: true },
      handleScroll: { vertTouchDrag: false }, // no celular, arrastar na vertical rola a página
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line }, timeScale: { borderColor: C.line, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "pt-BR", priceFormatter: (p: number) => (p >= 1000 ? Math.round(p).toLocaleString("pt-BR") : fmtMoney(p, "USD")) },
    });
    const s = chart.addSeries(CandlestickSeries, { upColor: "#2a8a47", downColor: "#a83a40", borderVisible: false, wickUpColor: "#2a8a47", wickDownColor: "#a83a40" });
    chartRef.current = chart; seriesRef.current = s;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current, s = seriesRef.current;
    if (!chart || !s) return;
    s.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    const extra: ISeriesApi<"Line">[] = [];
    const smaColors = ["rgba(247,147,26,0.75)", "#8a919d"];
    overlays?.sma?.forEach((arr, i) => {
      const l = chart.addSeries(LineSeries, { color: smaColors[i], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      l.setData(candles.flatMap((c, j) => (arr[j] != null && Number.isFinite(arr[j]) ? [{ time: c.t as UTCTimestamp, value: arr[j]! }] : [])));
      extra.push(l);
    });
    const lines = [
      ...(avgCost ? [s.createPriceLine({ price: avgCost, color: C.btc, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Entrada" })] : []),
      ...levels.map((l) => s.createPriceLine({ price: l.price, color: l.kind === "SUPPORT" ? "#34c38f66" : "#f6465d66", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" })),
    ];
    const first = candles[0]?.t ?? 0;
    const ms: SeriesMarker<Time>[] = markers.filter((m) => m.ts >= first).map((m) => ({
      time: (Math.floor(m.ts / 86400) * 86400) as UTCTimestamp, position: (m.kind === "ENTRY" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
      color: m.kind === "ENTRY" ? C.btc : C.ink2, shape: (m.kind === "ENTRY" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown", text: m.kind === "ENTRY" ? "Entrada" : "Saída", id: m.id,
    })).sort((a, b) => (a.time as number) - (b.time as number));
    const mk = createSeriesMarkers(s, ms);
    const handler = (p: { hoveredObjectId?: unknown; time?: Time }) => {
      const id = p.hoveredObjectId as string | undefined;
      const hit = id ? markers.find((m) => m.id === id) : p.time ? markers.find((m) => Math.floor(m.ts / 86400) * 86400 === p.time) : undefined;
      if (hit) cb.current?.(hit);
    };
    chart.subscribeClick(handler);
    chart.timeScale().fitContent();
    return () => {
      if (chartRef.current !== chart) return; // gráfico já descartado ao trocar de página
      try {
        chart.unsubscribeClick(handler);
        mk.detach();
        lines.forEach((l) => s.removePriceLine(l));
        extra.forEach((x) => chart.removeSeries(x));
      } catch { /* descartado */ }
    };
  }, [candles, markers, avgCost, levels, overlays]);

  return <div ref={el} style={{ height }} className="w-full" />;
}

