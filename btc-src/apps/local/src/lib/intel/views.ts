/** Visões de risco e desempenho a partir dos dados reais (Estratégia + Portfólio + mercado). */
import { concentration, dailyStats, exposure, shockScenarios, xirr, type RiskPosition } from "@bst/domain";
import { perpsView } from "../perps/view";

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
  const pIdx = pv.series;
  let peak = 0, pdd = 0;
  for (const p of pIdx) { peak = Math.max(peak, p.index); pdd = Math.max(pdd, peak > 0 ? 1 - p.index / peak : 0); }
  const margins = pv.positions.reduce((x, p) => x + (p.margin ?? 0), 0);
  const perps = perpsView();
  const available = perps.accounts.filter(a=>a.live && !a.stale);
  return {
    px, total: pv.c.totalUsd, positions: pv.positions, accounts: pv.accounts, exposure: ex, shocks,
    concentrationAsset: concentration(pv.c.assets.map((a) => a.share ?? 0)), topAsset: pv.c.assets[0] ?? null,
    concentrationInst: concentration(pv.c.byInstitution.map((x) => x.share)), topInst: pv.c.byInstitution[0] ?? null,
    counterparty: { onExchange, selfCustody, unknown },
    marginUsed: margins, marginAvailable: available.length === perps.accounts.length && available.length ? available.reduce((n,a)=>n+a.live!.withdrawable,0) : null,

    portfolioDD: { max: pIdx.length > 1 && pIdx.every((p) => p.valid) ? pdd : null },
    pv, perps,
  };
}

/** Contexto dos alertas (preço em US$, frações em 0–1, tempo em segundos). */
export function alertContext() {
  const r = riskView();

  const intel = marketIntel();
  const syncFailures = Object.values(portfolio().sync).filter((x) => x.state === "error").length;

  return {
    now: Math.floor(Date.now() / 1000), price: r.px || null, leverage: r.exposure.effLeverage,
    minLiqDistance: r.exposure.minLiqDistance, drawdown: r.portfolioDD.max,
    equityUsd: r.pv.quality === "complete" ? r.total : null, syncFailures, funding: intel?.funding1h && Date.now() - intel.funding1h.at < 5 * 60e3 ? intel.funding1h.value : null,
    btcNet: r.exposure.btcNet, divergenceUsd: null,
    btcEquivChange: null,
  };
}

/** Desempenho separado: Estratégia, Portfólio e (diário de) Trading. */
export function performanceView() {
  const pv = portfolioView();
  const pStats = dailyStats(pv.series.every(p => p.valid) ? pv.series.map((p) => ({ t: p.t, index: p.index })) : []);
  const byAsset = pv.c.assets.filter((a) => a.pnlUsd != null).map((a) => ({ key: a.symbol, pnl: a.pnlUsd!, cost: a.costUsd! }));
  return { pv, pStats, byAsset };
}
