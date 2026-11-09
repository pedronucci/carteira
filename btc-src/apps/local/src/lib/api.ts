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
subscribeStore(bump);
subscribePrices(bump);
subscribeHl(bump);
subscribeExtra(bump);
subscribePortfolio(bump);
subscribePortfolioPrices(bump);
subscribeIntel(bump);
subscribeAlerts(bump);
export const useDataVersion = () => useSyncExternalStore((f) => { vs.add(f); return () => vs.delete(f); }, () => version, () => version);

let loading = true;
export const setPricesLoading = (v: boolean) => { loading = v; bump(); };

function useSync<T>(fn: () => T) {
  const v = useDataVersion();
  return useMemo(() => {
    try { return { data: fn(), error: null as Error | null, loading: false }; }
    catch (e) {
      const waiting = e instanceof NoPriceError && loading && !prices().spot;
      return { data: null as T | null, error: waiting ? null : (e as Error), loading: waiting };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

export const useSnapshot = () => useSync(() => compute());
export const useMarket = () => useSync(market);
export const usePortfolio = () => useSync(portfolioView);
export const useRisk = () => useSync(riskView);
export const usePerps = () => useSync(perpsView);
export const usePerformance = () => useSync(performanceView);
