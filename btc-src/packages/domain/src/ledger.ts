/**
 * Livro de posições de BTC (todas as representações somadas: WBTC, cbBTC, BTCB, tBTC,
 * e futuramente BTC nativo). Suporta custo médio ponderado e FIFO.
 *
 * Convenções (gerenciais, não fiscais):
 * - taxa de compra é capitalizada no custo; taxa de venda reduz a receita;
 * - depósito externo entra com custo = valor de mercado na data, salvo custo informado;
 * - saque externo baixa a quantidade pelo custo do método, sem realizar resultado;
 * - conversão (WBTC→cbBTC, bridge) preserva o custo; a diferença de quantidade é taxa.
 */
import { d, Decimal, safeDiv, ZERO } from "./decimal";
import type { ClassifiedTx } from "./classifier";

export type CostMethod = "AVERAGE" | "FIFO";

export type LedgerEvent =
  | { type: "BUY"; id: string; ts: number; qty: Decimal; costUsd: Decimal; feeUsd: Decimal }
  | { type: "SELL"; id: string; ts: number; qty: Decimal; proceedsUsd: Decimal; feeUsd: Decimal }
  | { type: "DEPOSIT"; id: string; ts: number; qty: Decimal; basisUsd: Decimal; basisSource: "MARKET" | "USER" }
  | { type: "WITHDRAWAL"; id: string; ts: number; qty: Decimal }
  | { type: "CONVERT"; id: string; ts: number; qtyOut: Decimal; qtyIn: Decimal; feeUsd: Decimal };

export interface Lot {
  id: string;
  acquiredAt: number;
  qty: Decimal;
  remaining: Decimal;
  costUsd: Decimal; // custo total do lote original (com taxas)
}

export interface SellResult {
  eventId: string;
  ts: number;
  qty: Decimal;
  proceedsUsd: Decimal; // líquido de taxas
  costBasisUsd: Decimal;
  realizedPnlUsd: Decimal;
  returnPct: Decimal | null;
  consumedLots: { lotId: string; qty: Decimal; costUsd: Decimal }[];
}

export interface LedgerPoint {
  ts: number;
  qty: Decimal;
  basisUsd: Decimal;
  avgCostUsd: Decimal | null;
  realizedCumUsd: Decimal;
}

export interface LedgerResult {
  method: CostMethod;
  qty: Decimal;
  basisUsd: Decimal;
  avgCostUsd: Decimal | null;
  realizedPnlUsd: Decimal;
  boughtQty: Decimal;
  soldQty: Decimal;
  buyCostUsd: Decimal;
  sellProceedsUsd: Decimal;
  feesUsd: Decimal;
  openLots: Lot[];
  sells: SellResult[];
  timeline: LedgerPoint[];
  warnings: string[];
}

const EPS = d("1e-12");

export function buildLedger(events: LedgerEvent[], method: CostMethod): LedgerResult {
  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  let qty = ZERO, basis = ZERO, realized = ZERO;
  let boughtQty = ZERO, soldQty = ZERO, buyCost = ZERO, sellProceeds = ZERO, fees = ZERO;
  const lots: Lot[] = [];
  const sells: SellResult[] = [];
  const timeline: LedgerPoint[] = [];
  const warnings: string[] = [];

  const addLot = (id: string, ts: number, q: Decimal, cost: Decimal) => {
    lots.push({ id, acquiredAt: ts, qty: q, remaining: q, costUsd: cost });
  };

  /** Remove `q` BTC conforme o método. Retorna custo removido e lotes consumidos. */
  const consume = (q: Decimal, evId: string): { cost: Decimal; consumed: SellResult["consumedLots"]; missing: Decimal } => {
    let missing = ZERO;
    if (q.gt(qty.plus(EPS))) {
      missing = q.minus(qty);
      warnings.push(`Evento ${evId}: saída de ${q} BTC maior que o saldo conhecido (${qty}). Histórico incompleto? Diferença de ${missing} BTC ignorada no custo.`);
      q = qty;
    }
    if (method === "AVERAGE") {
      const avg = safeDiv(basis, qty) ?? ZERO;
      const cost = avg.mul(q);
      // mantém lotes coerentes para exibição: reduz proporcionalmente
      const ratio = qty.isZero() ? ZERO : q.div(qty);
      const consumed = lots.filter((l) => l.remaining.gt(0)).map((l) => {
        const take = l.remaining.mul(ratio);
        const lotCost = l.costUsd.mul(take.div(l.qty));
        l.remaining = l.remaining.minus(take);
        return { lotId: l.id, qty: take, costUsd: lotCost };
      });
      return { cost, consumed, missing };
    }
    let left = q, cost = ZERO;
    const consumed: SellResult["consumedLots"] = [];
    for (const l of [...lots].sort((a, b) => a.acquiredAt - b.acquiredAt)) {
      if (left.lte(EPS)) break;
      if (l.remaining.lte(EPS)) continue;
      const take = Decimal.min(l.remaining, left);
      const lotCost = l.costUsd.mul(take.div(l.qty));
      l.remaining = l.remaining.minus(take);
      left = left.minus(take);
      cost = cost.plus(lotCost);
      consumed.push({ lotId: l.id, qty: take, costUsd: lotCost });
    }
    return { cost, consumed, missing };
  };

  for (const ev of sorted) {
    const eventQty = ev.type === "CONVERT" ? ev.qtyOut : ev.qty;
    if (!eventQty.isFinite() || eventQty.lte(0)) throw new Error(`Evento ${ev.id}: quantidade deve ser positiva e finita.`);
    if (ev.type === "CONVERT" && (!ev.qtyIn.isFinite() || ev.qtyIn.lte(0))) throw new Error(`Evento ${ev.id}: quantidade recebida inválida.`);
    switch (ev.type) {
      case "BUY": {
        const total = ev.costUsd.plus(ev.feeUsd);
        qty = qty.plus(ev.qty); basis = basis.plus(total);
        boughtQty = boughtQty.plus(ev.qty); buyCost = buyCost.plus(total); fees = fees.plus(ev.feeUsd);
        addLot(ev.id, ev.ts, ev.qty, total);
        break;
      }
      case "DEPOSIT": {
        qty = qty.plus(ev.qty); basis = basis.plus(ev.basisUsd);
        addLot(ev.id, ev.ts, ev.qty, ev.basisUsd);
        if (ev.basisSource === "MARKET") warnings.push(`Depósito ${ev.id}: custo assumido pelo valor de mercado na data. Informe o custo real se souber.`);
        break;
      }
      case "SELL": {
        const net = ev.proceedsUsd.minus(ev.feeUsd);
        const { cost, consumed } = consume(ev.qty, ev.id);
        const effQty = consumed.reduce((a, c) => a.plus(c.qty), ZERO);
        qty = qty.minus(effQty); basis = basis.minus(cost);
        // Receita sem estoque/custo conhecido não pode virar lucro fictício.
        const pnl = net.mul(effQty.div(ev.qty)).minus(cost);
        realized = realized.plus(pnl);
        soldQty = soldQty.plus(ev.qty); sellProceeds = sellProceeds.plus(net); fees = fees.plus(ev.feeUsd);
        sells.push({ eventId: ev.id, ts: ev.ts, qty: ev.qty, proceedsUsd: net, costBasisUsd: cost, realizedPnlUsd: pnl, returnPct: safeDiv(pnl, cost), consumedLots: consumed });
        break;
      }
      case "WITHDRAWAL": {
        const { cost, consumed } = consume(ev.qty, ev.id);
        const effQty = consumed.reduce((a, c) => a.plus(c.qty), ZERO);
        qty = qty.minus(effQty); basis = basis.minus(cost);
        break;
      }
      case "CONVERT": {
        // custo preservado: lotes consumidos renascem com a nova quantidade e mesma data de aquisição
        const { cost, consumed } = consume(ev.qtyOut, ev.id);
        const effOut = consumed.reduce((a, c) => a.plus(c.qty), ZERO);
        const factor = effOut.isZero() ? ZERO : ev.qtyIn.div(ev.qtyOut);
        for (const c of consumed) {
          const orig = lots.find((l) => l.id === c.lotId)!;
          const share = cost.isZero() ? ZERO : c.costUsd.div(cost);
          addLot(`${c.lotId}~${ev.id}`, orig.acquiredAt, c.qty.mul(factor), c.costUsd.plus(ev.feeUsd.mul(share)));
        }
        qty = qty.minus(effOut).plus(effOut.mul(factor));
        basis = basis.plus(ev.feeUsd);
        fees = fees.plus(ev.feeUsd);
        break;
      }
    }
    if (qty.abs().lt(EPS)) { qty = ZERO; basis = ZERO; }
    timeline.push({ ts: ev.ts, qty, basisUsd: basis, avgCostUsd: safeDiv(basis, qty), realizedCumUsd: realized });
  }

  if (method === "FIFO") {
    // no FIFO o custo restante é a soma dos lotes abertos
    basis = lots.reduce((a, l) => a.plus(l.costUsd.mul(l.remaining.div(l.qty))), ZERO);
  }

  return {
    method, qty, basisUsd: basis, avgCostUsd: safeDiv(basis, qty), realizedPnlUsd: realized,
    boughtQty, soldQty, buyCostUsd: buyCost, sellProceedsUsd: sellProceeds, feesUsd: fees,
    openLots: lots.filter((l) => l.remaining.gt(EPS)), sells, timeline, warnings,
  };
}

/** Converte operações classificadas em eventos do livro de BTC. */
export function ledgerEventsFromClassified(
  txs: ClassifiedTx[],
  opts: { btcPriceAt: (ts: number) => Decimal | null; overrides?: Map<string, { basisUsd?: Decimal }> },
): { events: LedgerEvent[]; warnings: string[] } {
  const events: LedgerEvent[] = [];
  const warnings: string[] = [];
  const bridges = new Map<string, { out?: ClassifiedTx; in?: ClassifiedTx }>();

  for (const t of txs) {
    const id = `${t.chainId}:${t.hash}`;
    const fee = t.feeUsd ?? ZERO;
    const btcLegsIn = t.legs.filter((l) => l.assetClass === "BTC" && l.direction === "IN");
    const btcLegsOut = t.legs.filter((l) => l.assetClass === "BTC" && l.direction === "OUT");
    const qIn = btcLegsIn.reduce((a, l) => a.plus(l.amount), ZERO);
    const qOut = btcLegsOut.reduce((a, l) => a.plus(l.amount), ZERO);
    switch (t.kind) {
      case "BUY_BTC":
        if (!t.counterValueUsd) { warnings.push(`${id}: compra sem valor histórico; excluída do custo até revisão.`); break; }
        events.push({ type: "BUY", id, ts: t.timestamp, qty: qIn, costUsd: t.counterValueUsd, feeUsd: fee });
        break;
      case "SELL_BTC":
        if (!t.counterValueUsd) { warnings.push(`${id}: venda sem valor histórico; excluída do resultado até revisão.`); break; }
        events.push({ type: "SELL", id, ts: t.timestamp, qty: qOut, proceedsUsd: t.counterValueUsd, feeUsd: fee });
        break;
      case "BTC_CONVERSION":
        events.push({ type: "CONVERT", id, ts: t.timestamp, qtyOut: qOut, qtyIn: qIn, feeUsd: fee });
        break;
      case "TRANSFER_IN":
        if (qIn.gt(0)) {
          const ov = opts.overrides?.get(id)?.basisUsd;
          const px = opts.btcPriceAt(t.timestamp);
          if (!ov && !px) { warnings.push(`${id}: depósito de BTC sem preço histórico; excluído até revisão.`); break; }
          events.push({ type: "DEPOSIT", id, ts: t.timestamp, qty: qIn, basisUsd: ov ?? qIn.mul(px!), basisSource: ov ? "USER" : "MARKET" });
        }
        break;
      case "TRANSFER_OUT":
        if (qOut.gt(0)) events.push({ type: "WITHDRAWAL", id, ts: t.timestamp, qty: qOut });
        break;
      case "BRIDGE_OUT":
      case "BRIDGE_IN": {
        if (!t.bridgeGroup) break;
        const g = bridges.get(t.bridgeGroup) ?? {};
        if (t.kind === "BRIDGE_OUT") g.out = t; else g.in = t;
        bridges.set(t.bridgeGroup, g);
        break;
      }
      default:
        break;
    }
  }
  for (const [group, { out, in: inn }] of bridges) {
    if (!out || !inn) continue;
    const qOut = out.legs.filter((l) => l.assetClass === "BTC").reduce((a, l) => a.plus(l.amount), ZERO);
    const qIn = inn.legs.filter((l) => l.assetClass === "BTC").reduce((a, l) => a.plus(l.amount), ZERO);
    if (qOut.isZero()) continue;
    events.push({ type: "CONVERT", id: group, ts: out.timestamp, qtyOut: qOut, qtyIn: qIn, feeUsd: (out.feeUsd ?? ZERO).plus(inn.feeUsd ?? ZERO) });
  }
  return { events, warnings };
}

/** Estatísticas operacionais a partir das vendas realizadas. */
export function tradeStats(sells: SellResult[]) {
  const wins = sells.filter((s) => s.realizedPnlUsd.gt(0));
  const losses = sells.filter((s) => s.realizedPnlUsd.lt(0));
  const grossWin = wins.reduce((a, s) => a.plus(s.realizedPnlUsd), ZERO);
  const grossLoss = losses.reduce((a, s) => a.plus(s.realizedPnlUsd.abs()), ZERO);
  return {
    count: sells.length,
    wins: wins.length,
    losses: losses.length,
    winRate: sells.length ? d(wins.length).div(sells.length) : null,
    avgWinUsd: wins.length ? grossWin.div(wins.length) : null,
    avgLossUsd: losses.length ? grossLoss.div(losses.length) : null,
    profitFactor: grossLoss.isZero() ? null : grossWin.div(grossLoss),
    netRealizedUsd: grossWin.minus(grossLoss),
  };
}
