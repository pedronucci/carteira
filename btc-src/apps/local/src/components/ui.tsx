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

/** Bloco de conteúdo: superfície discreta, sem borda pesada. */
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-2xl border border-line bg-surface", className)} {...rest}>{children}</section>;
}

export function SectionTitle({ children, right, sub }: { children: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-ink">{children}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Par rótulo/valor. */
export function Metric({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "warn" | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-[17px] font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="num mt-0.5 text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function Row({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "gain" | "loss" | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
      <span className="text-muted">{label}</span>
      <span className={cn("num text-right font-medium", toneCls(tone))}>{children}</span>
    </div>
  );
}

export function Button({ variant = "secondary", size = "md", className, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cn(
      "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
      size === "sm" ? "h-9 px-3 text-[13px]" : size === "lg" ? "h-[52px] px-5 text-[16px]" : "h-11 px-4 text-[15px]",
      variant === "primary" && "bg-accent text-[#1f1a00] [@media(hover:hover)]:hover:bg-[#f5d94a]",
      variant === "secondary" && "bg-surface-3 text-ink [@media(hover:hover)]:hover:bg-[#404043]",
      variant === "ghost" && "text-ink-2 [@media(hover:hover)]:hover:bg-surface-2",
      variant === "danger" && "bg-loss-soft text-loss", className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

/** Campo com rótulo. Fonte de 16 px para o iPhone não dar zoom ao tocar. */
export function Field({ label, suffix, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; suffix?: string; hint?: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] text-muted">{label}</span>
      <span className="relative block">
        <input {...rest} className={cn("num h-12 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[16px] text-ink placeholder:text-[#77777c] focus:border-accent focus:outline-none", suffix && "pr-16")} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] text-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, full }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string; full?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full border border-line bg-surface p-1", full && "flex w-full")}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cn("min-h-10 flex-1 rounded-full px-4 text-[14px] font-semibold transition-colors", o.value === value ? "bg-accent text-[#1f1a00]" : "text-muted")}>{o.label}</button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div className={cn("skeleton h-4", className)} aria-hidden />; }

export function Notice({ tone = "warn", children }: { tone?: "warn" | "loss" | "info"; children: ReactNode }) {
  return (
    <div role={tone === "loss" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed",
      tone === "warn" && "bg-warn-soft text-[#f4d77d]", tone === "loss" && "bg-loss-soft text-[#ffb7c0]", tone === "info" && "bg-surface text-ink-2")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><div>{children}</div>
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "btc" | "gain" | "loss"; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap",
    tone === "neutral" && "bg-surface-3 text-ink-2", tone === "btc" && "bg-btc-soft text-btc", tone === "gain" && "bg-gain-soft text-gain", tone === "loss" && "bg-loss-soft text-loss", className)}>{children}</span>;
}

/** Título de grupo em caixa alta, como nas listas de ativos. */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("mb-2 mt-1 px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted", className)}>{children}</h3>;
}

/** Linha com barra colorida à esquerda (lista de alocação). */
export function BarRow({ color, icon, title, right, value, sub, onClick }: { color: string; icon?: ReactNode; title: ReactNode; right?: ReactNode; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="flex w-full border-b border-line text-left last:border-b-0">
      <span className="w-[5px] shrink-0" style={{ background: color }} aria-hidden />
      <span className="min-w-0 flex-1 px-4 py-4">
        <span className="flex items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{title}</span>
          {right && <span className="num shrink-0 text-[15px] text-ink-2">{right}</span>}
        </span>
        <span className="num mt-2 block text-[22px] font-bold tracking-tight">{value}</span>
        {sub && <span className="mt-1 block text-[14px] text-muted">{sub}</span>}
      </span>
    </Tag>
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
  if (kind === "cash") return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-[#111112] text-[17px] font-bold text-accent" aria-hidden>$</span>;
  if (kind === "strategy") return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-accent text-[14px] font-extrabold text-[#1f1a00]" aria-hidden>₿</span>;
  return <span style={s} className="grid shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-bold text-ink-2" aria-hidden>•</span>;
}
