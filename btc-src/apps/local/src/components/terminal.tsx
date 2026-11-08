"use client";
/** Peças do visual "terminal": gráfico do topo, faixa de indicadores, régua de preço, avisos e estado das fontes. */
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { cn, Notice } from "./ui";
import { useIntegrations } from "./nav";

type Tone = "gain" | "loss" | "warn" | null;
const TONE_BG: Record<string, string> = { gain: "bg-gain", loss: "bg-loss", warn: "bg-warn", none: "bg-accent" };
const TONE_TX: Record<string, string> = { gain: "text-gain", loss: "text-loss", warn: "text-warn", none: "text-ink" };

/** Patrimônio (linha cheia) e preço do BTC (tracejado), cada um na sua escala, para ver o ritmo dos dois. */
export function Spark({ points }: { points: { equity: number; price: number }[] }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) return null;
  const W = 320, H = 64, P = 3;
  const line = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    return vals.map((v, i) => [P + (i / (vals.length - 1)) * (W - 2 * P), H - P - ((v - lo) / span) * (H - 2 * P)] as const);
  };
  const eq = line(points.map((p) => p.equity)), px = line(points.map((p) => p.price));
  const path = (a: (readonly [number, number])[]) => a.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = eq[eq.length - 1]!;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img" aria-label="Patrimônio e preço do BTC no período">
        <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" /></linearGradient></defs>
        <path d={`${path(eq)} L${W - P} ${H} L${P} ${H} Z`} fill={`url(#g${id})`} />
        <path d={path(px)} fill="none" stroke="var(--color-btc)" strokeOpacity="0.8" strokeWidth="1.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path(eq)} fill="none" stroke="var(--color-accent)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r="3" fill="var(--color-accent)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-accent" aria-hidden />Patrimônio</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t border-dashed border-btc" aria-hidden />BTC</span>
      </div>
    </div>
  );
}

export interface StripItem { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; bar?: { pct: number; tone?: Tone } }
/** Faixa rolável de indicadores compactos, com mini-barra de contexto. */
export function MetricStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0" role="list">
      {items.map((m) => (
        <div key={m.label} role="listitem" className="panel-raised min-w-[148px] shrink-0 snap-start rounded-lg border border-line px-3.5 py-3 lg:min-w-0">
          <div className="lbl truncate">{m.label}</div>
          <div className={cn("num mt-1.5 truncate text-[18px] font-semibold leading-none", TONE_TX[m.tone ?? "none"])}>{m.value}</div>
          {m.sub && <div className="num mt-1.5 truncate text-[12px] text-muted">{m.sub}</div>}
          {m.bar && (
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div className={cn("h-full rounded-full transition-[width] duration-500", TONE_BG[m.bar.tone ?? "none"])} style={{ width: `${Math.max(3, Math.min(100, m.bar.pct * 100))}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Régua do preço: liquidação, entrada e preço atual na mesma linha, em escala. */
export function PriceRail({ liq, entry, now, px }: { liq: number | null; entry: number; now: number; px: (v: number) => string }) {
  const marks = [
    ...(liq != null ? [{ k: "Liquidação", v: liq, c: "var(--color-loss)" }] : []),
    { k: "Entrada", v: entry, c: "var(--color-ink-2)" },
    { k: "Agora", v: now, c: "var(--color-btc)" },
  ];
  const vals = marks.map((m) => m.v);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || hi * 0.02) * 0.12;
  const A = lo - pad, B = hi + pad;
  const pos = (v: number) => `${((v - A) / (B - A)) * 100}%`;
  const up = now >= entry;
  const [s, e] = [Math.min(entry, now), Math.max(entry, now)];
  return (
    <div className="px-4 pb-4" role="group" aria-label="Preço atual, entrada e liquidação">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
        {liq != null && <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-l-full bg-loss/35" style={{ left: 0, width: pos(liq) }} />}
        <div className={cn("absolute top-1/2 h-1.5 -translate-y-1/2", up ? "bg-gain/70" : "bg-loss/70")} style={{ left: pos(s), width: `calc(${pos(e)} - ${pos(s)})` }} />
        {marks.map((m) => m.k === "Agora"
          ? <span key={m.k} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg" style={{ left: pos(m.v), background: m.c, boxShadow: "0 2px 6px var(--shadow-pop)" }} />
          : <span key={m.k} className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(m.v), background: m.c }} />)}
      </div>
      <ul className="mt-1 flex items-start justify-between gap-2">
        {[...marks].sort((a, b) => a.v - b.v).map((m) => (
          <li key={m.k} className="min-w-0 text-[11px] leading-tight">
            <span className="flex items-center gap-1 text-muted"><span className="size-1.5 rounded-full" style={{ background: m.c }} aria-hidden />{m.k}</span>
            <span className="num mt-0.5 block text-[12px] text-ink-2">{px(m.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Avisos recolhidos em uma linha; tocam para abrir. */
export function Notices({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-warn/25 bg-warn-soft px-3 text-left text-[13px] text-warn-ink transition-colors duration-150">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{items.length === 1 ? items[0] : `${items.length} avisos`}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="fade-in mt-2 space-y-2">{items.map((w) => <Notice key={w}>{w}</Notice>)}</div>}
    </div>
  );
}

/** Um ponto de cor por fonte de dados e o horário da última atualização. */
export function SourceFooter() {
  const list = useIntegrations().filter((i) => i.state !== "none");
  if (!list.length) return null;
  const DOT: Record<string, string> = { ok: "bg-gain", sync: "bg-accent animate-pulse", stale: "bg-warn", error: "bg-loss", off: "bg-loss" };
  const TXT: Record<string, string> = { sync: "sincronizando", stale: "desatualizado", error: "erro", off: "sem dados" };
  return (
    <p className="num mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {list.map((i) => (
        <span key={i.key} className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", DOT[i.state])} aria-hidden />
          <span className="text-ink-2">{i.label}</span>
          <span>{i.state === "ok" && i.at ? fmtRelative(i.at / 1000) : TXT[i.state] ?? ""}</span>
        </span>
      ))}
    </p>
  );
}
