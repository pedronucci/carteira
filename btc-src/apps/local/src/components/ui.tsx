"use client";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { d } from "@bst/domain";

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

export const toneOf = (v: { toString(): string } | string | null | undefined): "gain" | "loss" | null => {
  if (v == null) return null;
  const x = d(v.toString());
  return x.gt(0) ? "gain" : x.lt(0) ? "loss" : null;
};
export const toneCls = (t: "gain" | "loss" | null | undefined) => (t === "gain" ? "text-gain" : t === "loss" ? "text-loss" : "");

/** Bloco de conteúdo: superfície com borda fina, cantos discretos. */
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-lg border border-line bg-surface", className)} {...rest}>{children}</section>;
}

/** Cabeçalho de painel: título curto à esquerda, ação ou valor à direita. */
export function PanelHead({ title, right, sub, className }: { title: ReactNode; right?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-2.5", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
        {sub && <p className="text-[12px] text-muted">{sub}</p>}
      </div>
      {right && <div className="shrink-0 text-[12px] text-muted">{right}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, sub }: { children: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{children}</h2>
        {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Célula de indicador: rótulo técnico, valor em mono, linha de apoio. */
export function Kpi({ label, value, sub, tone, className, big }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "warn" | null; className?: string; big?: boolean }) {
  return (
    <div className={cn("min-w-0 px-3.5 py-3", className)}>
      <div className="lbl truncate">{label}</div>
      <div className={cn("num mt-1 truncate font-semibold leading-tight", big ? "text-[17px] sm:text-[20px]" : "text-[16px]", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="num mt-0.5 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}
/** Grade de indicadores separada por linhas finas (sem cartões dentro de cartões). */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-px overflow-hidden rounded-lg border border-line bg-line [&>*]:bg-surface", className)}>{children}</div>;
}

/** Par rótulo/valor. */
export function Metric({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "warn" | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="lbl">{label}</div>
      <div className={cn("num mt-1 text-[16px] font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="num mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Row({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "gain" | "loss" | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[14px]">
      <span className="text-muted">{label}</span>
      <span className={cn("num text-right text-[13.5px] font-medium", toneCls(tone))}>{children}</span>
    </div>
  );
}

export function Button({ variant = "secondary", size = "md", className, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cn(
      "inline-flex select-none items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40",
      size === "sm" ? "h-8 px-3 text-[13px]" : size === "lg" ? "h-12 px-5 text-[15px]" : "h-11 px-4 text-[14px]",
      variant === "primary" && "bg-accent text-[#03201d] [@media(hover:hover)]:hover:bg-[#6be3dc]",
      variant === "secondary" && "border border-line-strong bg-surface-2 text-ink [@media(hover:hover)]:hover:border-[#3a4e68] [@media(hover:hover)]:hover:bg-surface-3",
      variant === "ghost" && "text-ink-2 [@media(hover:hover)]:hover:bg-surface-2",
      variant === "danger" && "border border-loss/30 bg-loss-soft text-loss", className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

/** Campo com rótulo. Fonte de 16 px para o iPhone não dar zoom ao tocar. */
export function Field({ label, suffix, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; suffix?: string; hint?: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-muted">{label}</span>
      <span className="relative block">
        <input {...rest} className={cn("num h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-ink placeholder:text-[#6b7d94] focus:border-accent focus:outline-none", suffix && "pr-16")} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, full, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string; full?: boolean; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border border-line bg-bg p-0.5", full && "flex w-full")}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cn("flex-1 rounded-[4px] font-semibold whitespace-nowrap transition-colors duration-150", size === "sm" ? "min-h-8 px-2.5 text-[12px]" : "min-h-9 px-3.5 text-[13px]",
            o.value === value ? "bg-surface-3 text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted [@media(hover:hover)]:hover:text-ink-2")}>{o.label}</button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div className={cn("skeleton h-4", className)} aria-hidden />; }

export function Notice({ tone = "warn", children }: { tone?: "warn" | "loss" | "info"; children: ReactNode }) {
  return (
    <div role={tone === "loss" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-relaxed",
      tone === "warn" && "border-warn/25 bg-warn-soft text-[#f2d398]", tone === "loss" && "border-loss/30 bg-loss-soft text-[#ffc2ca]", tone === "info" && "border-line bg-surface text-ink-2")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><div>{children}</div>
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "btc" | "gain" | "loss" | "accent" | "gold"; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap",
    tone === "neutral" && "bg-surface-3 text-ink-2", tone === "btc" && "bg-btc-soft text-btc", tone === "gain" && "bg-gain-soft text-gain", tone === "loss" && "bg-loss-soft text-loss", tone === "accent" && "bg-accent-soft text-accent", tone === "gold" && "bg-gold-soft text-gold", className)}>{children}</span>;
}

/** Título de grupo em caixa alta. */
export function GroupLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return <div className={cn("mb-2 mt-1 flex items-center justify-between gap-3 px-0.5", className)}><h3 className="lbl">{children}</h3>{right}</div>;
}

/** Linha de ativo: marcador de cor, título, valor em mono. */
export function BarRow({ color, icon, title, right, value, sub, onClick }: { color: string; icon?: ReactNode; title: ReactNode; right?: ReactNode; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("flex w-full items-start gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0", onClick && "[@media(hover:hover)]:hover:bg-surface-2")}>
      {icon ?? <span className="mt-1.5 size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">{title}</span>
          {right && <span className="num shrink-0 text-[13px] text-ink-2">{right}</span>}
        </span>
        <span className="num mt-1 block text-[20px] font-semibold tracking-tight">{value}</span>
        {sub && <span className="mt-0.5 block text-[13px] text-muted">{sub}</span>}
      </span>
    </Tag>
  );
}

/**
 * Régua de risco horizontal: faixas de cor fixas, marcador no valor atual e, opcionalmente, um limite.
 * Lê mais rápido que um medidor circular e ocupa uma linha.
 */
export function RiskMeter({ label, value, display, max, zones, limit, limitLabel, invert, sub }: {
  label: ReactNode; value: number | null; display: ReactNode; max: number;
  /** limites superiores de cada faixa, do mais seguro ao mais arriscado (ex.: [2, 4] para alavancagem) */
  zones: [number, number]; limit?: number; limitLabel?: string;
  /** true quando valores MAIORES são mais seguros (ex.: distância da liquidação) */
  invert?: boolean; sub?: ReactNode;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const [a, b] = zones;
  const safe = "var(--color-gain)", mid = "var(--color-warn)", hot = "var(--color-loss)";
  const segs = invert ? [{ from: 0, to: a, c: hot }, { from: a, to: b, c: mid }, { from: b, to: max, c: safe }] : [{ from: 0, to: a, c: safe }, { from: a, to: b, c: mid }, { from: b, to: max, c: hot }];
  const zoneOf = (v: number) => (invert ? (v < a ? "loss" : v < b ? "warn" : "gain") : v < a ? "gain" : v < b ? "warn" : "loss");
  const tone = value == null ? null : zoneOf(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="lbl">{label}</span>
        <span className={cn("num text-[15px] font-semibold", tone === "gain" && "text-gain", tone === "warn" && "text-warn", tone === "loss" && "text-loss")}>{display}</span>
      </div>
      <div className="relative mt-2 h-1.5" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined} aria-label={typeof label === "string" ? label : undefined}>
        <div className="absolute inset-0 flex gap-px overflow-hidden rounded-[2px]">
          {segs.map((s) => <span key={s.from} className="h-full opacity-35" style={{ width: pct(s.to - s.from), background: s.c }} />)}
        </div>
        {limit != null && <span className="absolute -top-1 h-3.5 w-px bg-ink-2" style={{ left: pct(limit) }} aria-hidden title={limitLabel} />}
        {value != null && <span className="absolute -top-[5px] h-4 w-[3px] -translate-x-1/2 rounded-[1px] bg-ink shadow-[0_1px_3px_rgba(0,0,0,0.6)]" style={{ left: pct(value) }} aria-hidden />}
      </div>
      {sub && <div className="mt-1.5 flex justify-between text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Ícone redondo de ativo. */
export function CoinIcon({ kind, size = 28 }: { kind: "btc" | "usdc" | "cash" | "strategy" | "other"; size?: number }) {
  const s = { width: size, height: size };
  if (kind === "btc") return (
    <svg viewBox="0 0 64 64" style={s} aria-hidden className="shrink-0"><circle cx="32" cy="32" r="32" fill="#f7931a" />
      <g transform="translate(32 32) rotate(14) scale(0.2) translate(-101 -100)" fill="#fff"><path fillRule="evenodd" d="M60 40 H112 C128 40 136 52 136 68 C136 80 130 88 122 92 C134 96 142 106 142 120 C142 142 128 160 108 160 H60 Z M82 59 H107 C113 59 116 64 116 70.5 C116 77 112 82 106 82 H82 Z M82 101 H110 C117 101 121 107 121 120.5 C121 134 116 141 108 141 H82 Z" />
        {[66, 90].flatMap((x) => [24, 158].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="12" height="18" rx="2" />))}</g></svg>);
  if (kind === "usdc") return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-usdc text-[13px] font-bold text-white" aria-hidden>$</span>;
  if (kind === "cash") return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-[#0c1420] text-[17px] font-bold text-accent" aria-hidden>$</span>;
  if (kind === "strategy") return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-gold text-[14px] font-extrabold text-[#2a1f05]" aria-hidden>₿</span>;
  return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-bold text-ink-2" aria-hidden>•</span>;
}
