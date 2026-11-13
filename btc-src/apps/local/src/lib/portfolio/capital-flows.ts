import type { PEvent } from "@bst/domain";
import type { HlHistory } from "../local/hl";
/** Cada conta neutraliza seus próprios aportes/retiradas. Entre contas acompanhadas as duas pontas se compensam. */
export function hlCapitalEvents(accounts: { id: string; history: HlHistory | null }[]): PEvent[] {
  return accounts.flatMap(a => [...new Map((a.history?.ledger ?? []).map(e => [e.key, e])).values()]
    .filter(e => e.kind === "IN" || e.kind === "OUT")
    .map(e => ({ id: `hl:${a.id}:${e.key}`, accountId: a.id, t: e.time, kind: e.kind === "IN" ? "deposit" as const : "withdraw" as const, econ: "USDC", qty: Math.abs(e.amount), usd: Math.abs(e.amount), counterparty: e.peer ?? null, note: e.label })));
}
/** Transferência interna também é fluxo por conta; no agregado acompanhado as pontas somam zero. */
export function capitalFlows(events: PEvent[]) {
 return events.filter(e => e.status !== "void" && e.usd != null && (["deposit","withdraw","transfer_in","transfer_out"].includes(e.kind) || e.kind === "adjust" && e.classification !== "internal"))
 .map(e => ({t:e.t,accountId:e.accountId,usd:e.kind === "adjust" ? e.usd! : (e.kind === "withdraw" || e.kind === "transfer_out" ? -1 : 1)*Math.abs(e.usd!)}));
}
