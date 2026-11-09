/** Visão dos perpétuos a partir da Hyperliquid configurada. Contabilidade separada da Estratégia BTC/USDC. */
import { hlState, type HlLive } from "../local/hl";
import { getStore } from "../local/store";
import { buildPositions, summarize, type PerpPosition, type PerpSummary } from "./positions";
import { groupTrades, tradeStats, type Trade, type TradeStats } from "./trades";
import type { SimInput } from "./scenario";
import { reconcilePerps, type ReconResult } from "./reconcile";

export const HL_ACCOUNT_ID = "hl-principal";
const STALE_MS = 3 * 60e3;

export interface PerpsView {
  connected: boolean; live: HlLive | null; stale: boolean; at: number | null; error: string | null;
  positions: PerpPosition[]; summary: PerpSummary; trades: Trade[]; stats: TradeStats; historyComplete: boolean;
  /** insumo para o simulador de cenários (margem cruzada) */
  sim: SimInput | null;
  recon: ReconResult | null;
}

export function perpsView(): PerpsView {
  const hl = hlState();
  const connected = Boolean(getStore().settings.hl?.address && hl.address);
  const live = hl.live;
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  const positions = live ? buildPositions(HL_ACCOUNT_ID, live.positions) : [];
  const equity = live ? live.total : null;
  const trades = hl.history ? groupTrades(hl.history.fills, hl.history.funding) : [];
  const h = hl.history;
  const av0 = h?.accountValue[0] ?? null;
  const flows = h && av0 ? h.ledger.filter((l) => (l.kind === "IN" || l.kind === "OUT") && l.time > av0[0]).reduce((a, l) => a + (l.kind === "IN" ? l.amount : -l.amount), 0) : null;
  const recon = h && live ? reconcilePerps({
    now: Date.now(), liveAt: live.at, officialEquity: live.total, livePositions: live.positions.map((p) => ({ coin: p.coin, szi: p.szi, upnl: p.upnl })),
    fills: h.fills, funding: h.funding, trades, netExternalFlows: flows, startEquity: av0 ? av0[1] : null, since: av0?.[0], historyTruncated: h.truncated,
    unmodeledSpot: live.balances.some((b) => b.where === "spot" && !["USDC", "USDT", "USDT0", "USDE", "USDH", "UBTC", "BTC"].includes(b.coin)),
  }) : null;
  return {
    connected, live, stale: !live || Date.now() - live.at > STALE_MS, at: live?.at ?? null, error: hl.error,
    positions, summary: summarize(positions, equity, minLiq), trades, stats: tradeStats(trades), historyComplete: Boolean(hl.history) && !hl.history!.truncated,
    recon,
    sim: live ? { accountValue: live.total, positions: positions.map((p) => ({ coin: p.coin, szi: p.dir === "LONG" ? p.size : -p.size, mark: p.mark ?? 0, upnl: p.upnl, marginUsed: p.margin ?? 0, maintRate: Number(getStore().settings.maintenanceRate) || 0.0125, liqPx: p.liq })) } : null,
  };
}
