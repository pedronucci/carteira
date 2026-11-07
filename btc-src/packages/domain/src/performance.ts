/**
 * Performance patrimonial a partir de snapshots (diários ou mais frequentes).
 *
 * Separa variação de mercado de aportes/retiradas: retorno ponderado no tempo (TWR)
 * encadeando sub-períodos entre fluxos, para que um aporte não pareça lucro.
 */
import { d, Decimal, safeDiv, ZERO } from "./decimal";

export interface Snapshot {
  ts: number;
  equityUsd: Decimal;
  /** Aporte líquido no intervalo (ts anterior, ts]: + depósito, − saque. */
  netFlowUsd: Decimal;
  realizedCumUsd?: Decimal;
  unrealizedUsd?: Decimal;
  feesCumUsd?: Decimal;
  btcPriceUsd?: Decimal;
}

export interface PerformanceSummary {
  startTs: number;
  endTs: number;
  startEquityUsd: Decimal;
  endEquityUsd: Decimal;
  netFlowsUsd: Decimal;
  marketPnlUsd: Decimal; // Δpatrimônio − fluxos
  twr: Decimal | null;
  maxDrawdown: Decimal; // fração positiva
  currentDrawdown: Decimal;
  realizedInPeriodUsd: Decimal | null;
  unrealizedChangeUsd: Decimal | null;
  feesInPeriodUsd: Decimal | null;
  equityInBtcStart: Decimal | null;
  equityInBtcEnd: Decimal | null;
}

export function summarizePerformance(snaps: Snapshot[]): PerformanceSummary | null {
  if (snaps.length < 2) return null;
  const s = [...snaps].sort((a, b) => a.ts - b.ts);
  const first = s[0]!, lastS = s[s.length - 1]!;
  let twr = d(1);
  let twrValid = true;
  let flows = ZERO;
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]!, cur = s[i]!;
    flows = flows.plus(cur.netFlowUsd);
    // fluxo assumido no fim do sub-período: r = (V1 − F) / V0 − 1
    if (prev.equityUsd.lte(0)) { if (!cur.netFlowUsd.isZero()) continue; twrValid = false; continue; }
    twr = twr.mul(cur.equityUsd.minus(cur.netFlowUsd).div(prev.equityUsd));
  }
  const dd = drawdownSeries(s.map((x) => ({ ts: x.ts, equityUsd: x.equityUsd, netFlowUsd: x.netFlowUsd })));
  const sub = (a?: Decimal, b?: Decimal) => (a !== undefined && b !== undefined ? b.minus(a) : null);
  return {
    startTs: first.ts, endTs: lastS.ts,
    startEquityUsd: first.equityUsd, endEquityUsd: lastS.equityUsd,
    netFlowsUsd: flows,
    marketPnlUsd: lastS.equityUsd.minus(first.equityUsd).minus(flows),
    twr: twrValid ? twr.minus(1) : null,
    maxDrawdown: dd.reduce((m, p) => Decimal.max(m, p.drawdown), ZERO),
    currentDrawdown: dd[dd.length - 1]?.drawdown ?? ZERO,
    realizedInPeriodUsd: sub(first.realizedCumUsd, lastS.realizedCumUsd),
    unrealizedChangeUsd: sub(first.unrealizedUsd, lastS.unrealizedUsd),
    feesInPeriodUsd: sub(first.feesCumUsd, lastS.feesCumUsd),
    equityInBtcStart: first.btcPriceUsd ? safeDiv(first.equityUsd, first.btcPriceUsd) : null,
    equityInBtcEnd: lastS.btcPriceUsd ? safeDiv(lastS.equityUsd, lastS.btcPriceUsd) : null,
  };
}

/**
 * Drawdown sobre o índice de cotas (TWR acumulado), não sobre o patrimônio bruto —
 * assim um saque não aparece como queda.
 */
export function drawdownSeries(snaps: Pick<Snapshot, "ts" | "equityUsd" | "netFlowUsd">[]) {
  const out: { ts: number; index: Decimal; drawdown: Decimal }[] = [];
  let index = d(1), peak = d(1);
  snaps.forEach((cur, i) => {
    if (i > 0) {
      const prev = snaps[i - 1]!;
      if (prev.equityUsd.gt(0)) index = index.mul(cur.equityUsd.minus(cur.netFlowUsd).div(prev.equityUsd));
    }
    if (index.gt(peak)) peak = index;
    out.push({ ts: cur.ts, index, drawdown: peak.isZero() ? ZERO : d(1).minus(index.div(peak)) });
  });
  return out;
}

export const RANGES = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400, "1y": 365 * 86400, all: Infinity } as const;
export type RangeKey = keyof typeof RANGES;

export function sliceRange<T extends { ts: number }>(snaps: T[], range: RangeKey, now = Date.now() / 1000): T[] {
  const span = RANGES[range];
  if (!Number.isFinite(span)) return snaps;
  const from = now - span;
  // inclui o último ponto anterior ao início para ancorar a variação
  const idx = snaps.findIndex((s) => s.ts >= from);
  if (idx < 0) return snaps.slice(-1);
  return snaps.slice(Math.max(0, idx - 1));
}
