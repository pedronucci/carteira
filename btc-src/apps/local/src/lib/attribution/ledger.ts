/**
 * Registro financeiro único compartilhado pelo Portfolio Attribution Engine e pelo Trading Journal.
 * Cada linha (Rec) é UM evento financeiro real: um resultado realizado, uma taxa, um pagamento de funding ou uma
 * recompensa, com o id da operação (tradeUid) a que pertence. Como as duas telas somam as mesmas linhas, os
 * números batem e nada é contado duas vezes. Movimentações (aportes, retiradas, transferências) ficam em FlowRec,
 * separadas do resultado.
 */
import { exchangeEcon } from "@bst/domain";
import type { PerpAccountView } from "../perps/view";
import { spotEngine, spotUnrealized, type SpotResult } from "./spot";
import { defaultStrategy, STRAT_SPOT, type JTrade } from "../journal/trades";

export type Market = "perp" | "spot" | "other";
export type RecKind = "realized" | "fee" | "funding" | "reward";
export interface Rec { id: string; t: number; accountId: string; accountName: string; exchange: string; asset: string; market: Market; kind: RecKind; usd: number; tradeUid: string | null; strategy: string }
export type FlowClass = "deposit" | "withdraw" | "internal";
export interface FlowRec { id: string; t: number; accountId: string; accountName: string; exchange: string; cls: FlowClass; usd: number; label: string }
export interface UnrealRow { accountId: string; accountName: string; exchange: string; asset: string; market: Market; usd: number | null; strategy: string; reason: string | null }
export interface AttrLedger {
  recs: Rec[]; flows: FlowRec[]; unreal: UnrealRow[];
  accounts: { id: string; name: string; exchange: string; historyComplete: boolean; hasHistory: boolean }[];
  /** avisos de histórico insuficiente (mostrados na tela, nunca escondidos) */ notes: string[];
  spot: Map<string, SpotResult>;
}
export interface LedgerIn {
  accounts: PerpAccountView[]; trades: JTrade[]; strategyStart: number | null; spotNames: Record<string, string> | null;
  /** endereços de contas próprias (transferência entre eles não é aporte nem retirada) */ ownAddresses: string[];
  /** P&L não realizado de carteiras/saldos com custo informado (fora da Hyperliquid) */ walletUnreal?: { asset: string; usd: number | null; reason?: string | null; accountName?: string }[];
}

export const econOf = (sym: string) => exchangeEcon(sym).econ;

export function buildAttrLedger(i: LedgerIn): AttrLedger {
  const recs: Rec[] = [], flows: FlowRec[] = [], unreal: UnrealRow[] = [], notes: string[] = [];
  const spot = new Map<string, SpotResult>();
  const own = new Set(i.ownAddresses.map((a) => a.toLowerCase()));
  const seen = new Set<string>();
  const push = (r: Rec) => { if (seen.has(r.id)) return; seen.add(r.id); recs.push(r); }; // nunca duas linhas com o mesmo id
  for (const a of i.accounts) {
    const ex = "Hyperliquid";
    const mine = i.trades.filter((t) => t.accountId === a.id);
    // perpétuos: resultado realizado e taxas por execução (execuções partidas numa inversão já vêm divididas)
    for (const t of mine) for (const f of t.fills) {
      const base = { t: f.time, accountId: a.id, accountName: a.name, exchange: ex, asset: t.coin, market: "perp" as const, tradeUid: t.uid, strategy: t.strategy };
      if (Math.abs(f.closedPnl) > 0) push({ ...base, id: `${f.key}|${t.uid}|r`, kind: "realized", usd: f.closedPnl });
      if (Math.abs(f.fee) > 0) push({ ...base, id: `${f.key}|${t.uid}|f`, kind: "fee", usd: -f.fee });
    }
    // funding: cada pagamento pertence a no máximo uma operação (a que estava aberta naquele instante)
    for (const u of a.funding) {
      const t = mine.find((x) => x.coin === u.coin && u.time >= x.openedAt && (x.closedAt == null || u.time <= x.closedAt));
      push({ id: `${u.key}|${a.id}|u`, t: u.time, accountId: a.id, accountName: a.name, exchange: ex, asset: u.coin, market: "perp", kind: "funding", usd: u.usd, tradeUid: t?.uid ?? null, strategy: t?.strategy ?? defaultStrategy(a.id, u.coin, u.time, i.strategyStart) });
    }
    // spot: custo médio a partir das execuções reais
    const sp = spotEngine(a.spotFills, i.spotNames);
    spot.set(a.id, sp);
    for (const r of sp.recs) {
      const base = { t: r.t, accountId: a.id, accountName: a.name, exchange: ex, asset: econOf(r.asset), market: "spot" as const, tradeUid: null, strategy: STRAT_SPOT };
      if (Math.abs(r.realized) > 0) push({ ...base, id: `${r.fillKey}|${a.id}|sr`, kind: "realized", usd: r.realized });
      if (Math.abs(r.fee) > 0) push({ ...base, id: `${r.fillKey}|${a.id}|sf`, kind: "fee", usd: -r.fee });
    }
    if (sp.unmapped.length) notes.push(`${a.name}: ${sp.unmapped.length} par(es) spot sem nome ou fora do USDC (${sp.unmapped.slice(0, 3).join(", ")}${sp.unmapped.length > 3 ? "…" : ""}) ficaram de fora do resultado spot.`);
    for (const [, s] of sp.assets) if (s.partial) notes.push(`${a.name}: ${s.asset} spot teve venda maior que o estoque do histórico (saldo anterior): a parte sem custo conhecido não gera resultado.`);
    // movimentações: aportes/retiradas × transferências internas × recompensas (resultado)
    for (const l of a.ledger) {
      if (l.kind === "INCOME") { push({ id: `${l.key}|${a.id}|w`, t: l.time, accountId: a.id, accountName: a.name, exchange: ex, asset: "Recompensas", market: "other", kind: "reward", usd: l.amount, tradeUid: null, strategy: "Recompensas" }); continue; }
      const internal = l.kind === "INTERNAL" || (l.peer != null && own.has(l.peer));
      flows.push({ id: `${l.key}|${a.id}`, t: l.time, accountId: a.id, accountName: a.name, exchange: ex, cls: internal ? "internal" : l.kind === "IN" ? "deposit" : "withdraw", usd: l.amount, label: l.label });
    }
    // não realizado: posição aberta agora (perp) e spot com custo reconstruído
    for (const p of a.positions) unreal.push({ accountId: a.id, accountName: a.name, exchange: ex, asset: p.coin, market: "perp", usd: p.upnl, strategy: defaultStrategy(a.id, p.coin, Date.now(), i.strategyStart), reason: null });
    for (const b of a.live?.balances.filter((x) => x.where === "spot") ?? []) {
      if (["USDC", "USDT", "USDT0", "USDE", "USDH", "USDHL"].includes(b.coin)) continue;
      const u = spotUnrealized(sp.assets.get(b.coin), b);
      unreal.push({ accountId: a.id, accountName: a.name, exchange: ex, asset: econOf(b.coin), market: "spot", usd: u.usd, strategy: STRAT_SPOT, reason: u.reason });
    }
    if (!a.historyAt) notes.push(`${a.name}: histórico da Hyperliquid ainda não sincronizado.`);
    else if (!a.historyComplete) notes.push(`${a.name}: histórico possivelmente truncado (limite de execuções da API): resultados antigos podem faltar.`);
    if (a.trades.some((t) => t.inherited)) notes.push(`${a.name}: há posição aberta antes do histórico carregado; parte do resultado dela é desconhecida.`);
  }
  for (const w of i.walletUnreal ?? []) unreal.push({ accountId: "carteiras", accountName: w.accountName ?? "Carteiras", exchange: "Carteiras", asset: w.asset, market: "spot", usd: w.usd, strategy: STRAT_SPOT, reason: w.reason ?? null });
  return {
    recs: recs.sort((x, y) => x.t - y.t), flows: flows.sort((x, y) => x.t - y.t), unreal,
    accounts: i.accounts.map((a) => ({ id: a.id, name: a.name, exchange: "Hyperliquid", historyComplete: a.historyComplete, hasHistory: a.historyAt != null })), notes: [...new Set(notes)], spot,
  };
}
