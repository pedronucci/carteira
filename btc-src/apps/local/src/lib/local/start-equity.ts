/**
 * Patrimônio EXATO de uma conta Hyperliquid num instante passado, quando a conta estava sem posição (puro).
 * Sem posição aberta, o valor da conta só muda por eventos: execuções (resultado − taxa), funding e movimentações.
 * Então: valor no instante = último ponto oficial antes dele + eventos entre os dois. Nada é interpolado — interpolar
 * entre dois pontos oficiais espalha para antes do instante variações de operações abertas DEPOIS dele (caso real:
 * retrato 30,10 abaixo do valor oficial).
 * Devolve null quando não dá para afirmar exatidão: posição aberta no ponto ou no instante, ponto oficial longe demais,
 * ou spot no histórico (saldo spot muda de preço sem evento).
 */
import type { HlHistory } from "./hl";
import { orderFills } from "../perps/fill-order";
import { isSpotCoin } from "../perps/market-kind";

type Hist = Pick<HlHistory, "accountValue" | "fills" | "funding" | "ledger">;
const EPS = 1e-9;

export function flatEquityAt(h: Hist, t: number, maxGap = 6 * 3600e3): number | null {
  let lo: [number, number] | null = null;
  for (const p of h.accountValue) { if (p[0] <= t) lo = p; else break; }
  if (!lo || t - lo[0] > maxGap || !Number.isFinite(lo[1])) return null;
  if (h.fills.some((f) => isSpotCoin(f.coin) && f.time <= t)) return null;

  // posição de cada perpétuo logo após o último fill até T (ordem real das execuções no mesmo milissegundo)
  const ordered = orderFills(h.fills);
  const positionsAt = (T: number) => {
    const m = new Map<string, number>();
    for (const f of ordered) { if (f.time > T) break; m.set(f.coin, f.startPosition + (f.side === "B" ? f.sz : -f.sz)); }
    return m;
  };
  const flat = (m: Map<string, number>) => [...m.values()].every((s) => Math.abs(s) <= EPS);
  if (!flat(positionsAt(lo[0])) || !flat(positionsAt(t))) return null;
  // execução no mesmo instante do ponto oficial: não dá para saber se o ponto já a inclui
  if (h.fills.some((f) => f.time === lo![0])) return null;

  const inWin = (x: { time: number }) => x.time > lo![0] && x.time <= t;
  let v = lo[1];
  for (const f of h.fills) if (inWin(f)) v += f.closedPnl - f.fee;
  for (const u of h.funding) if (inWin(u)) v += u.usd;
  for (const l of h.ledger) {
    if (!inWin(l)) continue;
    if (l.kind === "IN" || l.kind === "INCOME") v += l.amount;
    else if (l.kind === "OUT") v -= l.amount;
    v -= l.fee ?? 0;
  }
  return v;
}
