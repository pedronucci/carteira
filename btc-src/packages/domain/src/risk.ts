/**
 * Risco de posições alavancadas, liquidação aproximada e testes de estresse.
 *
 * O preço de liquidação OFICIAL vem sempre da plataforma (ex.: `liquidationPx` da Hyperliquid).
 * A fórmula abaixo é usada apenas em simulações e estresse, e segue a documentação da Hyperliquid:
 *   liq = price − side × margemDisponível / tamanho / (1 − l × side),  l = 1 / alavancagemDeManutenção
 * Modelos simplificados não substituem as regras reais de cada protocolo.
 */
import { d, Decimal, DecimalInput, safeDiv, ZERO } from "./decimal";

export interface PositionInput {
  id: string;
  coin: string;
  side: "LONG" | "SHORT";
  sizeBtc: DecimalInput; // tamanho absoluto
  entryPriceUsd: DecimalInput;
  markPriceUsd: DecimalInput;
  marginMode: "CROSS" | "ISOLATED";
  /** Margem isolada alocada (ISOLATED) — ignorada em CROSS. */
  isolatedMarginUsd?: DecimalInput;
  /** Taxa de margem de manutenção (ex.: 0.0125 para BTC na Hyperliquid com 40x máx.). */
  maintenanceMarginRate: DecimalInput;
  liquidationPxOfficial?: DecimalInput | null;
  fundingAccruedUsd?: DecimalInput;
}

export interface AccountInput {
  /** Valor da conta de margem cruzada (colateral + PnL não realizado das posições cross). */
  crossAccountValueUsd: DecimalInput;
  positions: PositionInput[];
}

const sideSign = (s: "LONG" | "SHORT") => (s === "LONG" ? 1 : -1);

export function positionMetrics(p: PositionInput) {
  const size = d(p.sizeBtc), entry = d(p.entryPriceUsd), mark = d(p.markPriceUsd);
  const s = sideSign(p.side);
  const notional = size.mul(mark);
  const upnl = mark.minus(entry).mul(size).mul(s);
  const mm = notional.mul(d(p.maintenanceMarginRate));
  const liq = p.liquidationPxOfficial != null ? d(p.liquidationPxOfficial) : null;
  const distance = liq ? mark.minus(liq).abs().div(mark) : null;
  return { notionalUsd: notional, unrealizedPnlUsd: upnl, maintenanceMarginUsd: mm, liquidationPxUsd: liq, liquidationDistance: distance };
}

/** Liquidação estimada (fórmula Hyperliquid). */
export function estimateLiquidationPx(args: {
  side: "LONG" | "SHORT"; sizeBtc: DecimalInput; markPriceUsd: DecimalInput;
  marginAvailableUsd: DecimalInput; maintenanceMarginRate: DecimalInput;
}): Decimal | null {
  const s = sideSign(args.side);
  const size = d(args.sizeBtc);
  if (size.isZero()) return null;
  const l = d(args.maintenanceMarginRate);
  const px = d(args.markPriceUsd).minus(d(args.marginAvailableUsd).mul(s).div(size).div(d(1).minus(l.mul(s))));
  return px.lte(0) ? ZERO : px;
}

export interface StressRow {
  shock: number; // ex.: -0.1
  btcPriceUsd: Decimal;
  equityUsd: Decimal;
  equityChangeUsd: Decimal;
  equityChangePct: Decimal | null;
  unrealizedPnlUsd: Decimal;
  marginRatio: Decimal | null; // margem de manutenção / valor da conta (≥ 1 = liquidação)
  liquidatedPositions: string[];
}

/**
 * Estresse: aplica choques ao preço do BTC sobre spot + posições.
 * Assume posições em BTC; outras moedas permanecem no preço atual (limitação declarada).
 */
export function stressTest(args: {
  btcPriceUsd: DecimalInput;
  spotBtc: DecimalInput;
  stableUsd: DecimalInput;
  otherUsd?: DecimalInput;
  account?: AccountInput | null;
  shocks?: number[];
}): StressRow[] {
  const shocks = args.shocks ?? [-0.05, -0.1, -0.15, -0.2, -0.3, -0.4];
  const p0 = d(args.btcPriceUsd);
  const spot = d(args.spotBtc), stable = d(args.stableUsd), other = d(args.otherUsd ?? 0);
  const positions = (args.account?.positions ?? []).filter((p) => p.coin.toUpperCase() === "BTC");
  const cross0 = d(args.account?.crossAccountValueUsd ?? 0);
  const upnl0 = positions.reduce((a, p) => a.plus(positionMetrics(p).unrealizedPnlUsd), ZERO);
  const isoMargin = positions.filter((p) => p.marginMode === "ISOLATED").reduce((a, p) => a.plus(d(p.isolatedMarginUsd ?? 0)), ZERO);
  const equity0 = spot.mul(p0).plus(stable).plus(other).plus(cross0).plus(isoMargin)
    .plus(positions.filter((p) => p.marginMode === "ISOLATED").reduce((a, p) => a.plus(positionMetrics(p).unrealizedPnlUsd), ZERO));

  return shocks.map((shock) => {
    const px = p0.mul(1 + shock);
    let upnl = ZERO, mmCross = ZERO, crossUpnlDelta = ZERO;
    const liquidated: string[] = [];
    let isoEquity = ZERO;
    for (const p of positions) {
      const m = positionMetrics({ ...p, markPriceUsd: px });
      const m0 = positionMetrics(p);
      upnl = upnl.plus(m.unrealizedPnlUsd);
      if (p.marginMode === "CROSS") {
        mmCross = mmCross.plus(m.maintenanceMarginUsd);
        crossUpnlDelta = crossUpnlDelta.plus(m.unrealizedPnlUsd.minus(m0.unrealizedPnlUsd));
      } else {
        const eq = d(p.isolatedMarginUsd ?? 0).plus(m.unrealizedPnlUsd);
        if (eq.lte(m.maintenanceMarginUsd)) { liquidated.push(p.id); isoEquity = isoEquity.plus(ZERO); }
        else isoEquity = isoEquity.plus(eq);
      }
    }
    let crossValue = cross0.plus(crossUpnlDelta);
    const marginRatio = crossValue.gt(0) ? safeDiv(mmCross, crossValue) : mmCross.gt(0) ? d(Infinity) : null;
    if (mmCross.gt(0) && crossValue.lte(mmCross)) {
      positions.filter((p) => p.marginMode === "CROSS").forEach((p) => liquidated.push(p.id));
      crossValue = Decimal.max(crossValue, ZERO); // após liquidação o que resta é ≥ 0 (aprox.)
    }
    const equity = spot.mul(px).plus(stable).plus(other).plus(crossValue).plus(isoEquity);
    return {
      shock, btcPriceUsd: px, equityUsd: equity, equityChangeUsd: equity.minus(equity0),
      equityChangePct: safeDiv(equity.minus(equity0), equity0), unrealizedPnlUsd: upnl.minus(upnl0),
      marginRatio, liquidatedPositions: liquidated,
    };
  });
}

export function exposureSummary(args: { btcPriceUsd: DecimalInput; spotBtc: DecimalInput; equityUsd: DecimalInput; positions: PositionInput[] }) {
  const px = d(args.btcPriceUsd), equity = d(args.equityUsd);
  const spotNotional = d(args.spotBtc).mul(px);
  let longN = ZERO, shortN = ZERO, minDist: Decimal | null = null;
  for (const p of args.positions) {
    const m = positionMetrics(p);
    if (p.side === "LONG") longN = longN.plus(m.notionalUsd); else shortN = shortN.plus(m.notionalUsd);
    if (m.liquidationDistance && (!minDist || m.liquidationDistance.lt(minDist))) minDist = m.liquidationDistance;
  }
  const netBtcExposure = spotNotional.plus(longN).minus(shortN);
  const gross = spotNotional.plus(longN).plus(shortN);
  return {
    spotNotionalUsd: spotNotional, longNotionalUsd: longN, shortNotionalUsd: shortN,
    netExposureUsd: netBtcExposure, grossExposureUsd: gross,
    effectiveLeverage: safeDiv(netBtcExposure.abs(), equity),
    grossLeverage: safeDiv(gross, equity),
    netExposureBtc: safeDiv(netBtcExposure, px),
    minLiquidationDistance: minDist,
  };
}
