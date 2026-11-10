/**
 * Operações do Trading Journal: as operações detectadas pela Hyperliquid (fills agrupados) com um id estável e
 * as anotações do usuário. O MESMO id (uid) liga o Journal, o gráfico e o Portfolio Attribution Engine.
 */
import { classifyExecs, type Exec } from "../perps/exec";
import type { PerpAccountView } from "../perps/view";
import type { Trade } from "../perps/trades";
import type { HlOrderKind } from "../local/hl";
import type { TradeNote } from "./types";

/** Id estável: conta + chave da primeira execução (o tid da Hyperliquid não muda). */
export function tradeUid(accountId: string, t: Pick<Trade, "fills" | "coin" | "openedAt">): string {
  return `${accountId}|${t.fills[0]?.key ?? `${t.coin}|${t.openedAt}`}`;
}

export const STRAT_BTC = "BTC/USDC", STRAT_OTHER = "Outros perpétuos", STRAT_SPOT = "Spot";
/** Estratégia padrão: BTC da conta principal desde o início do ciclo; o resto é "Outros perpétuos". O usuário pode sobrescrever na anotação. */
export function defaultStrategy(accountId: string, coin: string, t: number, strategyStart: number | null): string {
  return accountId === "hl-principal" && coin === "BTC" && strategyStart != null && t >= strategyStart ? STRAT_BTC : STRAT_OTHER;
}

export interface JTrade extends Trade {
  uid: string; accountId: string; accountName: string; strategy: string; note: TradeNote | null; execs: Exec[];
  /** fim da operação ou, se aberta, agora */ endAt: number; durationMs: number;
}

export function buildJournalTrades(accounts: PerpAccountView[], notes: Record<string, TradeNote>, strategyStart: number | null, now = Date.now()): JTrade[] {
  const out: JTrade[] = [];
  for (const a of accounts) for (const t of a.trades) {
    const uid = tradeUid(a.id, t);
    const note = notes[uid] ?? null;
    out.push({
      ...t, uid, accountId: a.id, accountName: a.name, note, strategy: note?.strategy?.trim() || defaultStrategy(a.id, t.coin, t.openedAt, strategyStart),
      execs: classifyExecs(t, a.orderKinds as Record<string, HlOrderKind>), endAt: t.closedAt ?? now, durationMs: (t.closedAt ?? now) - t.openedAt,
    });
  }
  return out.sort((x, y) => y.openedAt - x.openedAt);
}
