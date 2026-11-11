/** Visões de risco e desempenho a partir dos dados reais (Estratégia + Portfólio + mercado). */
import { concentration, dailyStats, exposure, shockScenarios, xirr, type RiskPosition } from "@bst/domain";
import { compute, drawdownPoints } from "../local/engine";
import { drawdowns } from "../local/strategy";
import { getStore } from "../local/store";
import { portfolio } from "../portfolio/db";
import { portfolioView } from "../portfolio/engine";
import { prices } from "../local/prices";
import { marketIntel } from "../market/intel";

const EXCHANGE_KINDS = new Set(["okx", "hyperliquid", "strategy"]);
const SELF_KINDS = new Set(["bitcoin", "evm", "solana"]);

export function riskView() {
  const pv = portfolioView();
  const px = prices().spot?.btcUsd ?? 0;
  const positions: RiskPosition[] = pv.positions.map((p) => ({ instrument: p.instrument, dir: p.dir, size: p.size, sizeUnit: p.sizeUnit, mark: p.mark, entry: p.entry, liq: p.liq, accountId: p.accountId, notional: p.notional }));
  const ex = exposure(positions, pv.c.btcHeld.total, px, pv.c.totalUsd);
  const shocks = px ? shockScenarios({ btcPx: px, spotBtc: pv.c.btcHeld.total, totalUsd: pv.c.totalUsd, positions }) : [];
  const kindOf = new Map(pv.accounts.map((a) => [a.id, a.kind]));
  let onExchange = 0, selfCustody = 0, unknown = 0;
  for (const a of pv.c.byAccount) { const k = kindOf.get(a.accountId) ?? ""; if (EXCHANGE_KINDS.has(k)) onExchange += a.valueUsd; else if (SELF_KINDS.has(k)) selfCustody += a.valueUsd; else unknown += a.valueUsd; }
  let strat: ReturnType<typeof compute> | null = null;
  try { strat = compute(); } catch { /* sem ciclo */ }
  const sdd = strat ? drawdownPoints(strat.points) : [];
  const pIdx = pv.series;
  let peak = 0, pdd = 0;
  for (const p of pIdx) { peak = Math.max(peak, p.index); pdd = Math.max(pdd, peak > 0 ? 1 - p.index / peak : 0); }
  const margins = pv.positions.reduce((x, p) => x + (p.margin ?? 0), 0);
  const live = strat?.live;
  return {
    px, total: pv.c.totalUsd, positions: pv.positions, accounts: pv.accounts, exposure: ex, shocks,
    concentrationAsset: concentration(pv.c.assets.map((a) => a.share ?? 0)), topAsset: pv.c.assets[0] ?? null,
    concentrationInst: concentration(pv.c.byInstitution.map((x) => x.share)), topInst: pv.c.byInstitution[0] ?? null,
    counterparty: { onExchange, selfCustody, unknown },
    marginUsed: margins, marginAvailable: live?.withdrawable ?? (strat?.acc.kind === "manual" ? strat.free : null),
    strategyDD: { max: strat?.maxDD ?? null, current: sdd.at(-1)?.dd ?? null },
    portfolioDD: { max: pIdx.length > 1 && pIdx.every((p) => p.valid) ? pdd : null },
    strat, pv,
  };
}

/** Contexto dos alertas (preço em US$, frações em 0–1, tempo em segundos). */
export function alertContext() {
  const r = riskView();
  const s = r.strat;
  const intel = marketIntel();
  const syncFailures = Object.values(portfolio().sync).filter((x) => x.state === "error").length;
  const b = s?.btc;
  return {
    now: Math.floor(Date.now() / 1000), price: r.px || null, leverage: s?.current?.effLeverage ?? null,
    minLiqDistance: s?.current?.liqDist?.toNumber() ?? null, drawdown: r.strategyDD.current,
    equityUsd: s?.equity.toNumber() ?? null, syncFailures, funding: intel?.funding1h && Date.now() - intel.funding1h.at < 5 * 60e3 ? intel.funding1h.value : null,
    btcNet: r.exposure.btcNet, divergenceUsd: s?.reconciliation != null ? Math.abs(s.reconciliation) : null,
    btcEquivChange: b?.start && b.equivalent != null ? b.equivalent / b.start - 1 : null,
  };
}

/** Desempenho separado: Estratégia, Portfólio e (diário de) Trading. */
export function performanceView() {
  const s = getStore();
  const cycles = s.strategies.map((c) => { try { return { c, r: compute(c.id) }; } catch { return { c, r: null }; } });
  let strat: ReturnType<typeof compute> | null = null;
  try { strat = compute(); } catch { /* sem ciclo */ }
  const sIndex = strat ? drawdowns(strat.points).map(p => ({ t: p.ts * 1000, index: p.index })) : [];
  const sStats = dailyStats(sIndex);
  // TIR da estratégia: patrimônio inicial e aportes como saídas do investidor, retiradas e valor atual como entradas
  const sMwr = strat ? xirr([{ t: strat.startT, amount: -strat.equity0 }, ...strat.events.filter((e) => e.k === "flow").map((e) => ({ t: e.t, amount: -(e as { usd: number }).usd })), { t: strat.endT, amount: strat.perfEquity }]) : null;
  const pv = portfolioView();
  const pStats = dailyStats(pv.series.every(p => p.valid) ? pv.series.map((p) => ({ t: p.t, index: p.index })) : []);
  const byAsset = pv.c.assets.filter((a) => a.pnlUsd != null).map((a) => ({ key: a.symbol, pnl: a.pnlUsd!, cost: a.costUsd! }));
  return { cycles, strat, sStats, sMwr, pv, pStats, byAsset, spanDays: strat ? (strat.endT - strat.startT) / 86400e3 : 0 };
}
