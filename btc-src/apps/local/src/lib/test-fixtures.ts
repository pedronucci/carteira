/** Dados fabricados SÓ para testes automatizados (nunca importado pelo app). */
import { groupTrades, type Fill, type FundingRow } from "./perps/trades";
import type { PerpAccountView } from "./perps/view";
import type { HlLedger, HlOrderKind } from "./local/hl";
import { buildJournalTrades, type JTrade } from "./journal/trades";
import { buildAttrLedger } from "./attribution/ledger";
import type { TradeNote } from "./journal/types";

export const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
export const H = 3600e3, D = 86400e3;
let n = 0;
export const fill = (t: number, coin: string, side: "B" | "A", sz: number, px: number, start: number, o: { pnl?: number; fee?: number; oid?: number; liq?: boolean; feeToken?: string } = {}): Fill =>
  ({ key: `f|${++n}`, time: t, coin, px, sz, side, dir: "", fee: o.fee ?? 0, closedPnl: o.pnl ?? 0, startPosition: start, ...(o.oid != null ? { oid: o.oid } : {}), ...(o.liq ? { liq: true } : {}), ...(o.feeToken ? { feeToken: o.feeToken } : {}) });
export const fund = (t: number, coin: string, usd: number, key?: string): FundingRow => ({ key: key ?? `u|${t}|${coin}`, time: t, coin, usd });

export interface FixtureOpts { id?: string; name?: string; extraFills?: Fill[]; extraFunding?: FundingRow[]; ledger?: HlLedger[]; orderKinds?: Record<string, HlOrderKind>; inherited?: boolean; complete?: boolean }
export function account(fills: Fill[], funding: FundingRow[], positions: { coin: string; dir: "LONG" | "SHORT"; size: number; upnl: number; entry?: number }[] = [], o: FixtureOpts = {}): PerpAccountView {
  const perp = fills.filter((f) => !f.coin.startsWith("@")), spot = fills.filter((f) => f.coin.startsWith("@"));
  return {
    id: o.id ?? "hl-principal", name: o.name ?? "Principal", address: "0x" + "a".repeat(40), primary: true, live: null, stale: false, at: T0, error: null,
    positions: positions.map((p) => ({ id: `x|perp|${p.coin}`, accountId: o.id ?? "hl-principal", coin: p.coin, dir: p.dir, size: p.size, entry: p.entry ?? 1, mark: 1, notional: 1, leverage: 3, levType: "cross", margin: 1, upnl: p.upnl, roiOnMargin: 0, liq: null, liqDistance: null, funding: 0, linkedStrategy: p.coin === "BTC" })),
    summary: {} as never, trades: groupTrades(perp, funding), stats: {} as never, historyComplete: o.complete ?? true, recon: null, sim: null,
    funding, spotFills: spot, ledger: o.ledger ?? [], orderKinds: o.orderKinds ?? {}, historyAt: T0,
  } as unknown as PerpAccountView;
}
export function ledgerFor(accts: PerpAccountView[], opts: { notes?: Record<string, TradeNote>; strategyStart?: number | null; spotNames?: Record<string, string> | null; own?: string[] } = {}) {
  const trades: JTrade[] = buildJournalTrades(accts, opts.notes ?? {}, opts.strategyStart ?? null, T0 + 60 * D);
  const ledger = buildAttrLedger({ accounts: accts, trades, strategyStart: opts.strategyStart ?? null, spotNames: opts.spotNames ?? null, ownAddresses: opts.own ?? [] });
  return { trades, ledger };
}

/** Mês de exemplo: BTC (aumento + redução parcial + fechamento), HYPE +850, SOL short perdedor, ETH aberto, spot HYPE, fluxos. */
export function monthFixture() {
  n = 0;
  const fills: Fill[] = [
    fill(T0 + 1 * H, "BTC", "B", 0.5, 70000, 0, { fee: 10, oid: 1 }),
    fill(T0 + 2 * H, "BTC", "B", 0.5, 72000, 0.5, { fee: 11, oid: 2 }),
    fill(T0 + 3 * D, "BTC", "A", 0.4, 74000, 1, { pnl: 1200, fee: 8, oid: 3 }),
    fill(T0 + 4 * D, "BTC", "A", 0.6, 73000, 0.6, { pnl: 1200, fee: 9, oid: 4 }),
    fill(T0 + 5 * D, "HYPE", "B", 100, 40, 0, { fee: 1.4 }),
    fill(T0 + 6 * D, "HYPE", "A", 100, 48.5, 100, { pnl: 850, fee: 1.7, oid: 5 }),
    fill(T0 + 7 * D, "SOL", "A", 20, 170, 0, { fee: 1.2 }),
    fill(T0 + 8 * D, "SOL", "B", 20, 175, -20, { pnl: -100, fee: 1.2, oid: 6 }),
    fill(T0 + 9 * D, "ETH", "B", 1, 3000, 0, { fee: 1 }),
    // spot HYPE ("@107"): compra 10 a 38 (taxa em HYPE), venda de 4 a 45
    fill(T0 + 10 * D, "@107", "B", 10, 38, 0, { fee: 0.01, feeToken: "HYPE" }),
    fill(T0 + 11 * D, "@107", "A", 4, 45, 0, { fee: 0.18 }),
  ];
  const funding = [fund(T0 + 2 * D, "BTC", -6), fund(T0 + 5.5 * D, "HYPE", 3), fund(T0 + 9.5 * D, "ETH", -0.5), fund(T0 + 20 * D, "SOL", 0.25) /* sem operação aberta */];
  const ledger: HlLedger[] = [
    { key: "l1", time: T0, kind: "IN", amount: 1000, label: "via Arbitrum", type: "deposit" },
    { key: "l2", time: T0 + 10 * D, kind: "OUT", amount: 300, label: "para Arbitrum", type: "withdraw" },
    { key: "l3", time: T0 + 12 * D, kind: "INTERNAL", amount: 500, label: "Spot → Perp", type: "accountClassTransfer" },
    { key: "l4", time: T0 + 13 * D, kind: "OUT", amount: 200, label: "enviado para outra conta", type: "send", peer: "0x" + "b".repeat(40) },
    { key: "l5", time: T0 + 14 * D, kind: "INCOME", amount: 5, label: "recompensa resgatada", type: "rewardsClaim" },
  ];
  const acc = account(fills, funding, [{ coin: "ETH", dir: "LONG", size: 1, upnl: 50, entry: 3000 }], { ledger, orderKinds: { "3": "TP", "4": "TP", "5": "TP", "6": "SL" } });
  // spot: balance live para teste de P&L não realizado
  (acc as unknown as { live: unknown }).live = { balances: [{ coin: "HYPE", total: 6, usd: 6 * 50, where: "spot" }, { coin: "USDC", total: 100, usd: 100, where: "spot" }], positions: [] };
  return { acc, fills, funding, ledger };
}
