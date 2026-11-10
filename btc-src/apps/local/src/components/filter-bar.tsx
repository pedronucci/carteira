"use client";
import { PERIODS } from "@/lib/attribution/engine";
import type { RangeKind } from "@/lib/analytics/analytics";
import { cn } from "./ui";

export function FilterSelect({ label, value, onChange, options, all = "Todos" }: { label: string; value: string | null; onChange: (v: string | null) => void; options: { value: string; label: string }[]; all?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="min-h-10 rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink">
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const dayStr = (t: number | null) => (t == null ? "" : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10));
const parseDay = (s: string, end: boolean) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return end ? new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime() : new Date(y!, m! - 1, d!).getTime(); };

export function PeriodPicker({ p, from, to, onPreset, onCustom }: { p: RangeKind; from: number | null; to: number | null; onPreset: (k: RangeKind) => void; onCustom: (from: number | null, to: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1 text-[11px] text-muted">
      Período
      <div className="flex flex-wrap items-center gap-1">
        {PERIODS.map((x) => <button key={x.kind} onClick={() => onPreset(x.kind)} aria-pressed={p === x.kind} className={cn("min-h-9 rounded-md border px-2.5 text-[12.5px]", p === x.kind ? "border-accent/60 bg-accent/15 text-ink" : "border-line text-muted")}>{x.label}</button>)}
        <input type="date" aria-label="De" value={dayStr(from)} onChange={(e) => onCustom(parseDay(e.target.value, false), to)} className="num min-h-9 rounded-md border border-line bg-surface-2 px-1.5 text-[12px] text-ink" />
        <span>—</span>
        <input type="date" aria-label="Até" value={dayStr(to)} onChange={(e) => onCustom(from, parseDay(e.target.value, true))} className="num min-h-9 rounded-md border border-line bg-surface-2 px-1.5 text-[12px] text-ink" />
      </div>
    </div>
  );
}
