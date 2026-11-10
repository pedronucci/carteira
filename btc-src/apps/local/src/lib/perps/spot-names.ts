/** Nomes dos pares spot ("@107" → "HYPE"), consultados uma vez e guardados por 7 dias. Sem o mapa, o par aparece com o próprio código. */
import { useSyncExternalStore } from "react";
import { fetchSpotNames } from "../local/hl";

const KEY = "bst.hl.spotnames.v1", TTL = 7 * 86400e3;
let names: Record<string, string> | null = null;
let loading: Promise<void> | null = null;
let v = 0;
const subs = new Set<() => void>();
try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as { at: number; names: Record<string, string> } | null; if (s?.names) names = s.names; } catch { /* sem cache */ }
export const spotNames = () => names;
export function ensureSpotNames(): Promise<void> {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as { at: number } | null; if (names && s && Date.now() - s.at < TTL) return Promise.resolve(); } catch { /* segue */ }
  if (loading) return loading;
  loading = fetchSpotNames().then((n) => { names = n; try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), names: n })); } catch { /* cheio */ } v++; subs.forEach((f) => f()); }).catch(() => undefined).finally(() => { loading = null; });
  return loading;
}
export const useSpotNames = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => v, () => 0);
