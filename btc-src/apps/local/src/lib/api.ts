"use client";
import { useMemo, useSyncExternalStore } from "react";
import { compute, market, NoPriceError } from "./local/engine";
export { NeedsSetup } from "./local/engine";
import { subscribeStore } from "./local/store";
import { prices, subscribePrices } from "./local/prices";
import { subscribeHl } from "./local/hl";
import { subscribeExtra } from "./local/hl-extra";
import { subscribePortfolio } from "./portfolio/db";
import { portfolioView, subscribePortfolioPrices } from "./portfolio/engine";
import { subscribeIntel } from "./market/intel";
import { subscribeAlerts } from "./alerts";
import { performanceView, riskView } from "./intel/views";
import { perpsView } from "./perps/view";

let version = 0;
const vs = new Set<() => void>();
const bump = () => { version++; vs.forEach((f) => f()); };
type Domain = "strategy" | "portfolio" | "market" | "risk" | "perps" | "performance";
const domains: Record<Domain, { version: number; listeners: Set<() => void> }> = Object.fromEntries(["strategy", "portfolio", "market", "risk", "perps", "performance"].map(k => [k, { version: 0, listeners: new Set<() => void>() }])) as Record<Domain, { version: number; listeners: Set<() => void> }>;
const invalidate = (keys: Domain[]) => () => { bump(); for (const key of keys) { const d = domains[key]; d.version++; d.listeners.forEach(f => f()); } };
const all = Object.keys(domains) as Domain[];
subscribeStore(invalidate(all));
subscribePrices(invalidate(all));
subscribeHl(invalidate(["strategy", "portfolio", "risk", "perps", "performance"]));
subscribeExtra(invalidate(["portfolio", "risk", "perps", "performance"]));
subscribePortfolio(invalidate(["portfolio", "risk", "perps", "performance"]));
subscribePortfolioPrices(invalidate(["portfolio", "risk", "performance"]));
subscribeIntel(invalidate(["strategy", "market", "risk", "perps"]));
subscribeAlerts(bump); // Uma preferência de alerta não recalcula a contabilidade.
export const useDataVersion = () => useSyncExternalStore((f) => { vs.add(f); return () => vs.delete(f); }, () => version, () => version);

let loading = true;
export const setPricesLoading = (v: boolean) => { loading = v; invalidate(all)(); };

function useSync<T>(fn: () => T, key: Domain) {
  const domain = domains[key];
  const v = useSyncExternalStore(f => { domain.listeners.add(f); return () => { domain.listeners.delete(f); }; }, () => domain.version, () => domain.version);
  return useMemo(() => {
    try { return { data: fn(), error: null as Error | null, loading: false }; }
    catch (e) {
      const waiting = e instanceof NoPriceError && loading && !prices().spot;
      return { data: null as T | null, error: waiting ? null : (e as Error), loading: waiting };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

export const useSnapshot = () => useSync(() => compute(), "strategy");
export const useMarket = () => useSync(market, "market");
export const usePortfolio = () => useSync(portfolioView, "portfolio");
export const useRisk = () => useSync(riskView, "risk");
export const usePerps = () => useSync(perpsView, "perps");
export const usePerformance = () => useSync(performanceView, "performance");
