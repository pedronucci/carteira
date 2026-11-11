/**
 * Planejador de compras e vendas e simulador de preço médio.
 * Todos os valores em USD e BTC com Decimal.
 */
import { d, Decimal, DecimalInput, safeDiv, ZERO } from "./decimal";

export interface BuyPlanInput {
  entryPriceUsd: DecimalInput;
  /** Capital próprio alocado (margem, se alavancado). */
  capitalUsd: DecimalInput;
  leverage?: DecimalInput; // 1 = spot
  stopPriceUsd?: DecimalInput | null;
  targetsUsd?: DecimalInput[];
  feeRate?: DecimalInput; // por lado, ex.: 0.0005
  slippageRate?: DecimalInput; // ex.: 0.001
  fundingRate8h?: DecimalInput; // para alavancado
  holdingDays?: DecimalInput;
  /** Posição atual para calcular o novo preço médio. */
  currentQtyBtc?: DecimalInput;
  currentAvgCostUsd?: DecimalInput | null;
  portfolioEquityUsd?: DecimalInput | null;
  side?: "LONG" | "SHORT";
  market?: "SPOT" | "PERP";
}

export interface BuyPlanResult {
  effectiveEntryUsd: Decimal;
  qtyBtc: Decimal;
  notionalUsd: Decimal;
  marginUsd: Decimal;
  entryFeeUsd: Decimal;
  estFundingUsd: Decimal;
  lossAtStopUsd: Decimal | null;
  lossAtStopPctOfCapital: Decimal | null;
  targets: { priceUsd: Decimal; grossPnlUsd: Decimal; netPnlUsd: Decimal; rr: Decimal | null; returnOnMarginPct: Decimal }[];
  newQtyBtc: Decimal;
  newAvgCostUsd: Decimal | null;
  exposureShareOfEquity: Decimal | null;
  warnings: string[];
}

export function planBuy(i: BuyPlanInput): BuyPlanResult {
  const side = i.side ?? "LONG";
  const dir = side === "LONG" ? 1 : -1;
  const lev = d(i.leverage ?? 1);
  const spot = i.market ? i.market === "SPOT" : lev.eq(1);
  const fee = d(i.feeRate ?? 0);
  const slip = d(i.slippageRate ?? 0);
  const warnings: string[] = [];
  if (lev.lte(0)) throw new Error("Alavancagem deve ser maior que zero.");
  if (![d(i.entryPriceUsd), d(i.capitalUsd), lev].every((x) => x.isFinite() && x.gt(0)) || !fee.isFinite() || fee.lt(0) || fee.gte(1) || !slip.isFinite() || slip.lt(0) || slip.gte(1)) throw new Error("Preço, capital, alavancagem ou taxas inválidos.");
  if (spot && (side === "SHORT" || !lev.eq(1))) throw new Error("Spot requer LONG sem alavancagem.");
  const entry = d(i.entryPriceUsd).mul(d(1).plus(slip.mul(dir)));
  const margin = d(i.capitalUsd);
  const notional = margin.mul(lev);
  const entryFee = notional.mul(fee);
  // quantidade comprada com o nocional líquido da taxa de entrada (spot) ou nocional cheio (perp, taxa paga da margem)
  const qty = spot ? notional.minus(entryFee).div(entry) : notional.div(entry);
  const days = d(i.holdingDays ?? 0);
  if (!days.isFinite() || days.lt(0) || !d(i.fundingRate8h ?? 0).isFinite()) throw new Error("Prazo ou funding inválido.");
  const estFunding = !spot ? notional.mul(d(i.fundingRate8h ?? 0)).mul(days.mul(3)).mul(dir) : ZERO;

  const exitFee = (px: Decimal) => qty.mul(px).mul(fee);
  const pnlAt = (px: Decimal) => {
    const exitPx = px.mul(d(1).minus(slip.mul(dir)));
    const gross = exitPx.minus(entry).mul(qty).mul(dir);
    if (!px.isFinite() || px.lte(0)) throw new Error("Preço de saída inválido.");
    const net = gross.minus(exitFee(exitPx)).minus(spot ? ZERO : entryFee).minus(estFunding);
    return { gross, net };
  };

  let lossAtStop: Decimal | null = null;
  if (i.stopPriceUsd != null) {
    const stop = d(i.stopPriceUsd);
    if ((side === "LONG" && stop.gte(entry)) || (side === "SHORT" && stop.lte(entry))) warnings.push("Stop do lado errado do preço de entrada.");
    lossAtStop = pnlAt(stop).net.neg();
    if (spot) lossAtStop = lossAtStop.plus(entryFee); // no spot a taxa de entrada saiu do capital
  }

  const targets = (i.targetsUsd ?? []).map((t) => {
    const px = d(t);
    const { gross, net } = pnlAt(px);
    const netAdj = spot ? net.minus(entryFee) : net;
    return {
      priceUsd: px, grossPnlUsd: gross, netPnlUsd: netAdj,
      rr: lossAtStop && lossAtStop.gt(0) ? netAdj.div(lossAtStop) : null,
      returnOnMarginPct: netAdj.div(margin),
    };
  });

  const curQty = d(i.currentQtyBtc ?? 0);
  const curAvg = i.currentAvgCostUsd != null ? d(i.currentAvgCostUsd) : null;
  let newQty = curQty, newAvg = curAvg;
  if (side === "LONG" && spot) {
    newQty = curQty.plus(qty);
    const curBasis = curAvg ? curAvg.mul(curQty) : ZERO;
    newAvg = curQty.gt(0) && curAvg == null ? null : safeDiv(curBasis.plus(margin), newQty);
  }

  const equity = i.portfolioEquityUsd != null ? d(i.portfolioEquityUsd) : null;
  if (lev.gt(3)) warnings.push(`Alavancagem ${lev}x acima da faixa de baixa alavancagem da estratégia.`);
  if (i.stopPriceUsd == null && lev.gt(1)) warnings.push("Operação alavancada sem stop definido.");

  return {
    effectiveEntryUsd: entry, qtyBtc: qty, notionalUsd: notional, marginUsd: margin, entryFeeUsd: entryFee,
    estFundingUsd: estFunding, lossAtStopUsd: lossAtStop,
    lossAtStopPctOfCapital: lossAtStop ? safeDiv(lossAtStop, equity ?? margin) : null,
    targets, newQtyBtc: newQty, newAvgCostUsd: newAvg,
    exposureShareOfEquity: equity && !equity.isZero() ? notional.div(equity) : null,
    warnings,
  };
}

export interface SellPlanInput {
  positionQtyBtc: DecimalInput;
  avgCostUsd: DecimalInput;
  exitPriceUsd: DecimalInput;
  fractions: DecimalInput[]; // ex.: [0.1, 0.25, 0.5]
  feeRate?: DecimalInput;
  slippageRate?: DecimalInput;
  otherAssetsUsd?: DecimalInput; // stables e demais ativos, para a nova composição
}

export function planSell(i: SellPlanInput) {
  const qty = d(i.positionQtyBtc), avg = d(i.avgCostUsd);
  if (!qty.isFinite() || qty.lt(0) || !avg.isFinite() || avg.lt(0) || !d(i.exitPriceUsd).isFinite() || d(i.exitPriceUsd).lte(0) || [d(i.feeRate ?? 0), d(i.slippageRate ?? 0)].some((v) => !v.isFinite() || v.lt(0) || v.gte(1))) throw new Error("Valores de venda inválidos.");
  const px = d(i.exitPriceUsd).mul(d(1).minus(d(i.slippageRate ?? 0)));
  const fee = d(i.feeRate ?? 0);
  const other = d(i.otherAssetsUsd ?? 0);
  return i.fractions.map((f) => {
    const frac = d(f);
    if (frac.lte(0) || frac.gt(1)) throw new Error("Percentual de venda deve estar entre 0 e 100%.");
    const sellQty = qty.mul(frac);
    const gross = sellQty.mul(px);
    const fees = gross.mul(fee);
    const proceeds = gross.minus(fees);
    const cost = sellQty.mul(avg);
    const remaining = qty.minus(sellQty);
    const btcValue = remaining.mul(d(i.exitPriceUsd));
    const total = btcValue.plus(other).plus(proceeds);
    return {
      fraction: frac, sellQtyBtc: sellQty, grossUsd: gross, feesUsd: fees, capitalFreedUsd: proceeds,
      realizedPnlUsd: proceeds.minus(cost), realizedPnlPct: safeDiv(proceeds.minus(cost), cost),
      remainingBtc: remaining,
      composition: { btcUsd: btcValue, cashUsd: other.plus(proceeds), btcShare: safeDiv(btcValue, total) },
    };
  });
}
