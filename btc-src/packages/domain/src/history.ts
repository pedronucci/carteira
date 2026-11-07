/**
 * Reconstrução histórica do patrimônio a partir das operações importadas e dos preços diários.
 * Permite ver performance desde a primeira transação, não só desde a instalação.
 */
import { d, Decimal, ZERO } from "./decimal";
import type { AssetClass } from "./assets";
import type { OperationKind } from "./classifier";
import type { Snapshot } from "./performance";

export interface HistoryLeg { assetClass: AssetClass; direction: "IN" | "OUT"; amount: Decimal; valueUsd?: Decimal | null }
export interface HistoryOp { ts: number; kind: OperationKind; legs: HistoryLeg[]; feeNative: Decimal; nativeClass: "ETH" | "BNB" }
type Ref = "BTC" | "ETH" | "BNB";

const FLOW_KINDS: OperationKind[] = ["TRANSFER_IN", "TRANSFER_OUT"];

export function buildEquityHistory(args: {
  ops: HistoryOp[];
  closeAt: (ref: Ref, dayStartTs: number) => Decimal | null;
  /** Patrimônio fora das carteiras EVM no dia (ex.: conta Hyperliquid) e fluxos externos dela. */
  external?: (dayStartTs: number) => { equityUsd: Decimal; netFlowUsd: Decimal } | null;
  startTs: number;
  endTs: number;
}): Snapshot[] {
  const DAY = 86400;
  const ops = [...args.ops].sort((a, b) => a.ts - b.ts);
  const qty: Record<"BTC" | "ETH" | "BNB" | "USD", Decimal> = { BTC: ZERO, ETH: ZERO, BNB: ZERO, USD: ZERO };
  const refOf = (c: AssetClass): keyof typeof qty | null => (c === "STABLE_USD" ? "USD" : c === "OTHER" ? null : c);
  const out: Snapshot[] = [];
  let i = 0;
  const firstDay = Math.floor(args.startTs / DAY) * DAY;
  for (let day = firstDay; day <= args.endTs; day += DAY) {
    const dayEnd = day + DAY;
    let flow = ZERO;
    while (i < ops.length && ops[i]!.ts < dayEnd) {
      const op = ops[i++]!;
      if (op.kind === "FAILED" || op.kind === "INTERNAL_TRANSFER") { qty[op.nativeClass] = qty[op.nativeClass].minus(op.feeNative); continue; }
      for (const l of op.legs) {
        const r = refOf(l.assetClass);
        if (!r) continue;
        qty[r] = l.direction === "IN" ? qty[r].plus(l.amount) : qty[r].minus(l.amount);
        if (FLOW_KINDS.includes(op.kind)) {
          const px = r === "USD" ? d(1) : args.closeAt(r, day);
          const v = l.valueUsd ?? (px ? l.amount.mul(px) : ZERO);
          flow = l.direction === "IN" ? flow.plus(v) : flow.minus(v);
        }
      }
      qty[op.nativeClass] = qty[op.nativeClass].minus(op.feeNative);
    }
    const btcPx = args.closeAt("BTC", day);
    if (!btcPx) continue; // sem preço: não inventa ponto
    const ethPx = args.closeAt("ETH", day) ?? ZERO;
    const bnbPx = args.closeAt("BNB", day) ?? ZERO;
    const ext = args.external?.(day) ?? null;
    const equity = qty.BTC.mul(btcPx).plus(qty.ETH.mul(ethPx)).plus(qty.BNB.mul(bnbPx)).plus(qty.USD).plus(ext?.equityUsd ?? ZERO);
    out.push({ ts: day, equityUsd: equity, netFlowUsd: flow.plus(ext?.netFlowUsd ?? ZERO), btcPriceUsd: btcPx });
  }
  return out;
}
