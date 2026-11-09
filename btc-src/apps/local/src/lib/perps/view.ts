/** Visão dos perpétuos de TODAS as contas Hyperliquid configuradas (principal + adicionais). Contabilidade separada da Estratégia BTC/USDC. */
import { hlState, type HlHistory, type HlLive } from "../local/hl";
import { extraState } from "../local/hl-extra";
import { getStore } from "../local/store";
import { buildPositions, summarize, type PerpPosition, type PerpSummary } from "./positions";
import { groupTrades, tradeStats, type Trade, type TradeStats } from "./trades";
import type { SimInput } from "./scenario";
import { reconcilePerps, type ReconResult } from "./reconcile";

export const HL_ACCOUNT_ID = "hl-principal";
const STALE_MS = 3 * 60e3;
const STABLE = ["USDC", "USDT", "USDT0", "USDE", "USDH", "UBTC", "BTC"];

export interface PerpAccountView {
  id: string; name: string; address: string; primary: boolean; live: HlLive | null; stale: boolean; at: number | null; error: string | null;
  positions: PerpPosition[]; summary: PerpSummary; trades: Trade[]; stats: TradeStats; historyComplete: boolean; recon: ReconResult | null; sim: SimInput | null;
}
export interface PerpsView {
  connected: boolean; accounts: PerpAccountView[]; stale: boolean; at: number | null; error: string | null;
  /** todas as contas juntas */
  positions: PerpPosition[]; summary: PerpSummary; trades: Trade[]; stats: TradeStats; historyComplete: boolean;
}

function accountView(o: { id: string; name: string; address: string; primary: boolean; live: HlLive | null; history: HlHistory | null; error: string | null }): PerpAccountView {
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  const maint = Number(getStore().settings.maintenanceRate) || 0.0125;
  const { live, history: h } = o;
  const positions = live ? buildPositions(o.id, live.positions) : [];
  const trades = h ? groupTrades(h.fills, h.funding) : [];
  const av0 = h?.accountValue[0] ?? null;
  const flows = h && av0 ? h.ledger.filter((l) => (l.kind === "IN" || l.kind === "OUT") && l.time > av0[0]).reduce((a, l) => a + (l.kind === "IN" ? l.amount : -l.amount), 0) : null;
  const recon = h && live ? reconcilePerps({
    now: Date.now(), liveAt: live.at, officialEquity: live.total, livePositions: live.positions.map((p) => ({ coin: p.coin, szi: p.szi, upnl: p.upnl })),
    fills: h.fills, funding: h.funding, trades, netExternalFlows: flows, startEquity: av0 ? av0[1] : null, since: av0?.[0], historyTruncated: h.truncated,
    unmodeledSpot: live.balances.some((b) => b.where === "spot" && !STABLE.includes(b.coin)),
  }) : null;
  return {
    id: o.id, name: o.name, address: o.address, primary: o.primary, live, stale: !live || Date.now() - live.at > STALE_MS, at: live?.at ?? null, error: o.error,
    positions, summary: summarize(positions, live ? live.total : null, minLiq), trades, stats: tradeStats(trades), historyComplete: Boolean(h) && !h!.truncated, recon,
    sim: live ? { accountValue: live.total, positions: positions.map((p) => ({ coin: p.coin, szi: p.dir === "LONG" ? p.size : -p.size, mark: p.mark ?? 0, upnl: p.upnl, marginUsed: p.margin ?? 0, maintRate: maint, liqPx: p.liq })) } : null,
  };
}

export function perpsView(): PerpsView {
  const hl = hlState();
  const accounts: PerpAccountView[] = [];
  const addr = getStore().settings.hl?.address;
  if (addr && hl.address) accounts.push(accountView({ id: HL_ACCOUNT_ID, name: "Principal (Estratégia)", address: hl.address, primary: true, live: hl.live, history: hl.history, error: hl.error }));
  for (const x of extraState().accounts) accounts.push(accountView({ id: x.id, name: x.name, address: x.address, primary: false, live: x.live, history: x.history, error: x.error }));
  const positions = accounts.flatMap((a) => a.positions);
  const equities = accounts.map((a) => a.live?.total).filter((x): x is number => x != null);
  const trades = accounts.flatMap((a) => a.trades);
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  return {
    connected: accounts.length > 0, accounts, stale: accounts.some((a) => a.stale), at: accounts.length ? Math.min(...accounts.map((a) => a.at ?? 0)) || null : null,
    error: accounts.find((a) => a.error)?.error ?? null,
    positions, summary: summarize(positions, equities.length ? equities.reduce((a, b) => a + b, 0) : null, minLiq), trades, stats: tradeStats(trades), historyComplete: accounts.every((a) => a.historyComplete),
  };
}
