/** Visão dos perpétuos de TODAS as contas Hyperliquid configuradas (principal + adicionais). Contabilidade separada da Estratégia BTC/USDC. */
import { hlState, type HlHistory, type HlLive } from "../local/hl";
import { extraState } from "../local/hl-extra";
import { getStore } from "../local/store";
import { buildPositions, summarize, type PerpPosition, type PerpSummary } from "./positions";
import { groupTrades, tradeStats, type Trade, type TradeStats } from "./trades";
import type { SimInput } from "./scenario";
import { reconcilePerps, type ReconResult } from "./reconcile";
import { isSpotCoin } from "./market-kind";
import type { Fill } from "./trades";
import type { HlLedger, HlOrderKind } from "../local/hl";

export const HL_ACCOUNT_ID = "hl-principal";
const STALE_MS = 3 * 60e3;
const STABLE = ["USDC", "USDT", "USDT0", "USDE", "USDH", "UBTC", "BTC"];

export interface PerpAccountView {
  id: string; name: string; address: string; primary: boolean; live: HlLive | null; stale: boolean; at: number | null; error: string | null;
  positions: PerpPosition[]; summary: PerpSummary; trades: Trade[]; stats: TradeStats; historyComplete: boolean; recon: ReconResult | null; sim: SimInput | null;
  /** pagamentos de funding (usd > 0 = recebido) */ funding: { key: string; time: number; coin: string; usd: number }[];
  /** execuções de pares spot (fora das operações de perpétuos), movimentações da conta e tipos de ordem conhecidos */
  spotFills: Fill[]; ledger: HlLedger[]; orderKinds: Record<string, HlOrderKind>; historyAt: number | null;
}
export interface PerpsView {
  connected: boolean; accounts: PerpAccountView[]; stale: boolean; at: number | null; error: string | null;
  /** todas as contas juntas */
  positions: PerpPosition[]; summary: PerpSummary; trades: Trade[]; stats: TradeStats; historyComplete: boolean;
  funding: { key: string; time: number; coin: string; usd: number }[];
}

/**
 * Janela e entradas da reconciliação da conta.
 * Histórico completo: a conta vale ZERO antes do primeiro evento (execução, funding ou movimentação) — esse é o único
 * patrimônio inicial exato. O 1º ponto "allTime" da Hyperliquid NÃO serve: ele pode vir como 0,00 depois de a conta já
 * ter recebido dinheiro e operado (caso real: 693,81 de diferença).
 * Histórico truncado: mantém o 1º ponto oficial como referência e o status fica "Histórico incompleto".
 */
export function reconInputs(h: HlHistory, live: HlLive) {
  const firstEvent = Math.min(...[h.fills[0]?.time, h.funding[0]?.time, h.ledger[0]?.time].filter((x): x is number => x != null), Infinity);
  const av0 = h.accountValue[0] ?? null;
  const complete = !h.truncated && Number.isFinite(firstEvent);
  const since = complete ? firstEvent : av0?.[0];
  const startEquity = complete ? 0 : av0 ? av0[1] : null;
  const inWin = (t: number) => since == null || t >= since;
  const win = h.ledger.filter((l) => inWin(l.time));
  const flows = since == null ? null : win.filter((l) => l.kind === "IN" || l.kind === "OUT").reduce((a, l) => a + (l.kind === "IN" ? l.amount : -l.amount), 0);
  // recompensas são resultado; taxas de saque/envio são custo — nenhuma das duas é fluxo de capital
  const otherIncome = win.reduce((a, l) => a + (l.kind === "INCOME" ? l.amount : 0) - (l.fee ?? 0), 0);
  return {
    now: Date.now(), liveAt: live.at, officialEquity: live.total, livePositions: live.positions.map((p) => ({ coin: p.coin, szi: p.szi, upnl: p.upnl })),
    funding: h.funding, netExternalFlows: flows, startEquity, since, otherIncome, historyTruncated: h.truncated,
    unmodeledSpot: live.balances.some((b) => b.where === "spot" && !STABLE.includes(b.coin)),
  };
}

function accountView(o: { id: string; name: string; address: string; primary: boolean; live: HlLive | null; history: HlHistory | null; error: string | null }): PerpAccountView {
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  const maint = Number(getStore().settings.maintenanceRate) || 0.0125;
  const { live, history: h } = o;
  const positions = live ? buildPositions(o.id, live.positions) : [];
  // a Hyperliquid mistura execuções spot ("@107") e de perpétuos no mesmo histórico: só os perpétuos formam operações
  const perpFills = h ? h.fills.filter((f) => !isSpotCoin(f.coin)) : [];
  const spotFills = h ? h.fills.filter((f) => isSpotCoin(f.coin)) : [];
  const trades = h ? groupTrades(perpFills, h.funding) : [];
  const recon = h && live ? reconcilePerps({ ...reconInputs(h, live), fills: perpFills, trades }) : null;
  return {
    id: o.id, name: o.name, address: o.address, primary: o.primary, live, stale: !live || Date.now() - live.at > STALE_MS, at: live?.at ?? null, error: o.error,
    positions, summary: summarize(positions, live ? live.total : null, minLiq), trades, stats: tradeStats(trades), historyComplete: Boolean(h) && !h!.truncated, recon, funding: h?.funding ?? [],
    spotFills, ledger: h?.ledger ?? [], orderKinds: h?.orders ?? {}, historyAt: h?.at ?? null,
    sim: live ? { accountValue: live.total, liquidationAvailable: false, unavailableReason: "Impacto no patrimônio estimado. Liquidação simulada indisponível: faltam faixas de manutenção e garantia elegível por pool cross/isolated. Consulte o preço oficial de liquidação de cada posição.", positions: positions.map((p) => ({ coin: p.coin, szi: p.dir === "LONG" ? p.size : -p.size, mark: p.mark ?? 0, upnl: p.upnl, marginUsed: p.margin ?? 0, maintRate: maint, liqPx: p.liq, marginMode: p.levType })) } : null,
  };
}

export function perpsView(): PerpsView {
  const hl = hlState();
  const accounts: PerpAccountView[] = [];
  const addr = getStore().settings.hl?.address;
  if (addr && hl.address === addr.toLowerCase()) accounts.push(accountView({ id: HL_ACCOUNT_ID, name: "Principal (Estratégia)", address: hl.address, primary: true, live: hl.live, history: hl.history, error: hl.error }));
  const seen = new Set(accounts.map((a) => a.address.toLowerCase()));
  for (const x of extraState().accounts) { if (seen.has(x.address.toLowerCase())) continue; seen.add(x.address.toLowerCase()); accounts.push(accountView({ id: x.id, name: x.name, address: x.address, primary: false, live: x.live, history: x.history, error: x.error })); }
  const positions = accounts.flatMap((a) => a.positions);
  const equities = accounts.map((a) => a.live?.total).filter((x): x is number => x != null);
  const trades = accounts.flatMap((a) => a.trades);
  const minLiq = Number(getStore().settings.minLiqDistance) || 0.1;
  return {
    connected: accounts.length > 0, accounts, stale: accounts.some((a) => a.stale), at: accounts.length ? Math.min(...accounts.map((a) => a.at ?? 0)) || null : null,
    error: accounts.find((a) => a.error)?.error ?? null,
    positions, summary: summarize(positions, equities.length ? equities.reduce((a, b) => a + b, 0) : null, minLiq), trades, stats: tradeStats(trades), historyComplete: accounts.every((a) => a.historyComplete), funding: accounts.flatMap((a) => a.funding),
  };
}
