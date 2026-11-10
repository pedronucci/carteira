"use client";
import { useMemo } from "react";
import { usePerps, usePortfolio } from "../api";
import { portfolio } from "../portfolio/db";
import { byOrigin, drawdown, hodlResult, perfByCoin, perpStats, rangeEvolution, resolveRange, splitStrategy, waterfall, type RangeKind } from "./analytics";

export type Custom = { from: number; to: number } | undefined;
/** Todos os números do Performance Analytics para um intervalo. Compartilhado pela página e pelo cartão da Dashboard. */
export function useAnalytics(kind: RangeKind, custom: Custom, strategyStart: number | null) {
  const pq = usePortfolio();
  const perps = usePerps().data ?? null;
  const pv = pq.data ?? null;
  return useMemo(() => {
    const now = Date.now();
    const range = resolveRange(kind, now, custom);
    const snaps = portfolio().snapshots;
    const flows = pv?.flows ?? [];
    const trades = perps?.trades ?? [], funding = perps?.funding ?? [], positions = perps?.positions ?? [];
    const rows = perfByCoin(trades, funding, positions, range);
    const wf = waterfall(rows);
    return {
      now, range, perps, pv, snaps, rows, wf,
      stats: perpStats(trades, range),
      evo: pv ? rangeEvolution(snaps, flows, range) : null,
      dd: drawdown(snaps, flows, range),
      origins: pv ? byOrigin(snaps, flows, pv.accounts, range) : [],
      split: perps?.connected ? splitStrategy(trades, funding, strategyStart, range) : null,
      bench: { BTC: hodlResult(snaps, flows, "BTC", range), ETH: hodlResult(snaps, flows, "ETH", range), SOL: hodlResult(snaps, flows, "SOL", range) },
      unrealized: perps?.connected ? perps.summary.upnl : null,
      topCoin: [...rows].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0] ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, custom?.from, custom?.to, strategyStart, pv, perps]);
}
export type Analytics = ReturnType<typeof useAnalytics>;
