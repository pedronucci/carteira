/**
 * Ordens reais da Hyperliquid que protegem uma posição: take profit e stop loss. Separadas de qualquer nível
 * planejado pelo usuário. Este módulo só interpreta o que a exchange informa; não envia, altera nem cancela ordens.
 */
import type { HlOrder } from "../local/hl";

export interface PosRef { coin: string; dir: "LONG" | "SHORT"; size: number; entry: number | null }
export interface LevelOrder {
  oid: number; coin: string; kind: "TP" | "SL"; price: number;
  /** contratos vinculados; para TP/SL "da posição" é o tamanho atual da posição */ qty: number | null; wholePosition: boolean;
  /** "Take Profit Market", "Stop Limit"… como informado pela exchange */ orderType: string;
  /** ordem limite reduce-only que funciona como alvo (não é gatilho) */ limit: boolean; label: string;
}
export interface PendingOrder { oid: number; coin: string; side: "B" | "A"; price: number | null; qty: number; orderType: string; trigger: boolean; reduceOnly: boolean }
export interface ClassifiedOrders { tps: LevelOrder[]; sls: LevelOrder[]; pending: PendingOrder[] }

export function classifyOrders(orders: HlOrder[], pos: PosRef | null): ClassifiedOrders {
  const tps: LevelOrder[] = [], sls: LevelOrder[] = [], pending: PendingOrder[] = [];
  const mine = orders.filter((o) => !pos || o.coin === pos.coin);
  for (const o of mine) {
    const closing = pos ? (pos.dir === "LONG" ? o.side === "A" : o.side === "B") : false;
    const px = o.isTrigger ? o.triggerPx ?? o.limitPx : o.limitPx;
    const t = o.orderType.toLowerCase();
    const protective = closing && (o.reduceOnly || o.isPositionTpsl);
    if (o.isTrigger && protective && px != null && (t.includes("take profit") || t.includes("stop"))) {
      const kind: "TP" | "SL" = t.includes("take profit") ? "TP" : "SL";
      const qty = o.isPositionTpsl || o.sz <= 0 ? pos?.size ?? null : o.sz;
      (kind === "TP" ? tps : sls).push({ oid: o.oid, coin: o.coin, kind, price: px, qty, wholePosition: o.isPositionTpsl || o.sz <= 0, orderType: o.orderType, limit: false, label: kind });
      continue;
    }
    // limite reduce-only no lado do lucro funciona como alvo; no lado do prejuízo fica como ordem pendente
    if (!o.isTrigger && protective && px != null && pos?.entry != null) {
      const profitSide = pos.dir === "LONG" ? px > pos.entry : px < pos.entry;
      if (profitSide) { tps.push({ oid: o.oid, coin: o.coin, kind: "TP", price: px, qty: o.sz, wholePosition: false, orderType: o.orderType || "Limit", limit: true, label: "TP" }); continue; }
    }
    pending.push({ oid: o.oid, coin: o.coin, side: o.side, price: px, qty: o.sz, orderType: o.orderType, trigger: o.isTrigger, reduceOnly: o.reduceOnly });
  }
  // alvo mais próximo da entrada = TP1; stop mais próximo do preço de entrada = SL (ou SL1…)
  const ref = pos?.entry ?? 0;
  const byDist = (a: LevelOrder, b: LevelOrder) => Math.abs(a.price - ref) - Math.abs(b.price - ref) || a.oid - b.oid;
  tps.sort(byDist); sls.sort(byDist);
  tps.forEach((x, i) => { x.label = `TP${i + 1}`; });
  sls.forEach((x, i) => { x.label = sls.length > 1 ? `SL${i + 1}` : "SL"; });
  return { tps, sls, pending };
}
