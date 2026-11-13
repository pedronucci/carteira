/**
 * Resultado de operações spot por custo médio, a partir das execuções reais da Hyperliquid (puro).
 * Só pares cotados em USDC. A taxa nunca entra no custo (é lançada à parte, uma vez). Venda maior que o estoque
 * conhecido = saldo anterior ao histórico: a parte sem custo conhecido NÃO gera resultado e o ativo fica "parcial".
 */
import type { Fill } from "../perps/trades";
import { orderFills } from "../perps/fill-order";

export interface SpotRec { fillKey: string; t: number; asset: string; realized: number; fee: number }
export interface SpotAsset { asset: string; qty: number; avgCost: number | null; buys: number; sells: number; partial: boolean; unknownQty: number }
export interface SpotResult { assets: Map<string, SpotAsset>; recs: SpotRec[]; unmapped: string[] }
const EPS = 1e-9;

export function spotEngine(fills: Fill[], names: Record<string, string> | null): SpotResult {
  const sorted = orderFills(fills);
  const st = new Map<string, { qty: number; cost: number; buys: number; sells: number; unknown: number }>();
  const recs: SpotRec[] = [];
  const unmapped = new Set<string>();
  for (const f of sorted) {
    const asset = names?.[f.coin];
    if (!asset) { unmapped.add(f.coin); continue; }
    const s = st.get(asset) ?? { qty: 0, cost: 0, buys: 0, sells: 0, unknown: 0 };
    st.set(asset, s);
    const feeBase = f.feeToken != null && f.feeToken === asset;
    const feeUsd = feeBase ? f.fee * f.px : f.fee;
    if (f.side === "B") {
      const got = feeBase ? Math.max(0, f.sz - f.fee) : f.sz;
      s.qty += got; s.cost += got * f.px; s.buys++;
      if (Math.abs(feeUsd) > 0) recs.push({ fillKey: f.key, t: f.time, asset, realized: 0, fee: feeUsd });
    } else {
      const known = Math.min(f.sz, Math.max(0, s.qty));
      const avg = s.qty > EPS ? s.cost / s.qty : 0;
      const realized = known > EPS ? known * (f.px - avg) : 0;
      if (f.sz - known > EPS) s.unknown += f.sz - known;
      s.qty = Math.max(0, s.qty - known); s.cost = Math.max(0, s.cost - avg * known); s.sells++;
      recs.push({ fillKey: f.key, t: f.time, asset, realized, fee: feeUsd });
    }
  }
  const assets = new Map<string, SpotAsset>();
  for (const [asset, s] of st) assets.set(asset, { asset, qty: s.qty, avgCost: s.qty > EPS ? s.cost / s.qty : null, buys: s.buys, sells: s.sells, partial: s.unknown > EPS, unknownQty: s.unknown });
  return { assets, recs, unmapped: [...unmapped] };
}

/** P&L não realizado do spot: só quando o estoque reconstruído bate com o saldo ao vivo (±2%). Senão, indisponível. */
export function spotUnrealized(a: SpotAsset | undefined, balance: { total: number; usd: number | null } | undefined): { usd: number | null; reason: string | null } {
  if (!balance || balance.total <= EPS) return { usd: null, reason: null };
  if (balance.usd == null) return { usd: null, reason: "sem cotação" };
  if (!a || a.avgCost == null) return { usd: null, reason: "custo desconhecido (saldo anterior ao histórico)" };
  if (Math.abs(a.qty - balance.total) > Math.max(1e-6, balance.total * 0.02)) return { usd: null, reason: "histórico não explica o saldo atual" };
  return { usd: balance.usd - a.avgCost * balance.total, reason: null };
}
