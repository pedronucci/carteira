"use client";
/** Filtros compartilhados (Journal e Attribution) guardados na URL, para que os links entre as telas levem o mesmo recorte. */
import { useMemo } from "react";
import { replaceUrl, splitUrl, useUrl } from "../router";
import { resolveRange, type Range, type RangeKind } from "../analytics/analytics";
import type { Market } from "../attribution/ledger";

export interface UrlFilters {
  coin: string | null; acc: string | null; strat: string | null; market: Market | null; ex: string | null;
  /** período: preset ou intervalo exato (from/to em ms) */ p: RangeKind; from: number | null; to: number | null;
  trade: string | null; q: string; res: "win" | "loss" | "open" | null; dir: "LONG" | "SHORT" | null; tab: string | null;
}
const num = (s: string | null) => { const n = s == null ? NaN : Number(s); return Number.isFinite(n) ? n : null; };
const KINDS: RangeKind[] = ["1", "7", "30", "90", "ytd", "all"];

export function parseFilters(search: string): UrlFilters {
  const q = new URLSearchParams(search);
  const from = num(q.get("from")), to = num(q.get("to"));
  const p = q.get("p") as RangeKind | null;
  const m = q.get("market");
  const r = q.get("res");
  const d = q.get("dir");
  return {
    coin: q.get("coin") || null, acc: q.get("acc") || null, strat: q.get("strat") || null, market: m === "perp" || m === "spot" || m === "other" ? m : null, ex: q.get("ex") || null,
    p: from != null || to != null ? "custom" : p && KINDS.includes(p) ? p : "all", from, to, trade: q.get("trade") || null, q: q.get("q") ?? "",
    res: r === "win" || r === "loss" || r === "open" ? r : null, dir: d === "LONG" || d === "SHORT" ? d : null, tab: q.get("tab"),
  };
}
export function buildSearch(f: Partial<UrlFilters>): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined) => { if (v != null && v !== "") q.set(k, String(v)); };
  put("coin", f.coin); put("acc", f.acc); put("strat", f.strat); put("market", f.market); put("ex", f.ex);
  if (f.p === "custom") { put("from", f.from != null ? Math.round(f.from) : null); put("to", f.to != null ? Math.round(f.to) : null); }
  else if (f.p && f.p !== "all") put("p", f.p);
  put("trade", f.trade); put("q", f.q); put("res", f.res); put("dir", f.dir); put("tab", f.tab);
  const s = q.toString();
  return s ? `?${s}` : "";
}
export const rangeOf = (f: UrlFilters, now = Date.now()): Range => resolveRange(f.p, now, f.p === "custom" ? { from: f.from ?? 0, to: f.to ?? now } : undefined);

export function useUrlFilters() {
  const url = useUrl();
  const { path, search } = splitUrl(url);
  const f = useMemo(() => parseFilters(search), [search]);
  const set = (patch: Partial<UrlFilters>) => {
    const next = { ...f, ...patch };
    if (patch.p && patch.p !== "custom") { next.from = null; next.to = null; }
    replaceUrl(`${path}${buildSearch(next)}`);
  };
  const clear = () => replaceUrl(path);
  return { f, set, clear, path };
}
