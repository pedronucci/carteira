/**
 * Ordens abertas da Hyperliquid por conta (somente leitura). Estado em memória, atualizado por consulta periódica e
 * por eventos do WebSocket. Sem consultas duplicadas: chamadas simultâneas compartilham a mesma resposta.
 */
import { useSyncExternalStore } from "react";
import { fetchOpenOrders, type HlOrder } from "../local/hl";
import { portfolio, updatePortfolio } from "../portfolio/db";
import { classifyOrders } from "./orders";
import { mergeLevelHistory, sameLevels } from "./levels";
import type { PerpsView } from "./view";
import { tradeUid } from "../journal/trades";

export interface OrdersState { at: number | null; orders: HlOrder[]; error: string | null }
let st: Record<string, OrdersState> = {};
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };
export const ordersFor = (accountId: string): OrdersState => st[accountId] ?? { at: null, orders: [], error: null };
export const useOrdersVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version, () => 0);

const running = new Map<string, Promise<void>>();
const MIN_GAP = 4000;
/** Atualiza as ordens de uma conta. Ignora pedidos repetidos dentro de poucos segundos. */
export function refreshOrders(accountId: string, address: string, force = false): Promise<void> {
  const cur = running.get(accountId);
  if (cur) return cur;
  if (!force && st[accountId]?.at && Date.now() - st[accountId]!.at! < MIN_GAP) return Promise.resolve();
  const p = fetchOpenOrders(address)
    .then((orders) => { st = { ...st, [accountId]: { at: Date.now(), orders, error: null } }; })
    .catch((e: Error) => { st = { ...st, [accountId]: { at: st[accountId]?.at ?? null, orders: st[accountId]?.orders ?? [], error: e.message } }; })
    .finally(() => { running.delete(accountId); bump(); });
  running.set(accountId, p);
  return p;
}

/** Guarda os TP/SL reais vistos para cada operação aberta (para mostrar no gráfico depois de ela fechar). Só grava se mudou. */
export function recordLevels(v: PerpsView, now = Date.now()) {
  const next: Record<string, ReturnType<typeof mergeLevelHistory>> = {};
  for (const a of v.accounts) {
    const os = st[a.id];
    if (!os?.at || os.error) continue;
    for (const p of a.positions) {
      const t = a.trades.find((x) => x.open && x.coin === p.coin);
      if (!t || t.fills.length === 0) continue;
      const uid = tradeUid(a.id, t);
      const c = classifyOrders(os.orders, { coin: p.coin, dir: p.dir, size: p.size, entry: p.entry });
      const prev = portfolio().levelHistory?.[uid] ?? [];
      const merged = mergeLevelHistory(prev, [...c.tps, ...c.sls], now);
      if (!sameLevels(prev, merged) && (merged.length > 0 || prev.length > 0)) next[uid] = merged;
    }
  }
  if (Object.keys(next).length) void updatePortfolio((d) => { d.levelHistory = { ...(d.levelHistory ?? {}), ...next }; });
}

/** Atualiza as ordens de todas as contas com posição aberta e registra os níveis. */
export async function refreshAllOrders(v: PerpsView, force = false) {
  const jobs = v.accounts.filter((a) => a.positions.length > 0 && a.address).map((a) => refreshOrders(a.id, a.address, force));
  await Promise.all(jobs);
  recordLevels(v);
}
