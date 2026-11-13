import { describe, expect, it } from "vitest";
import { orderFills } from "./fill-order";
import { groupTrades, type Fill } from "./trades";
import { reconcilePerps } from "./reconcile";

const T = Date.UTC(2026, 10, 1);
const f = (tid: number, time: number, side: "B" | "A", sz: number, start: number, extra: Partial<Fill> = {}): Fill => ({
  key: `f|${tid}`, time, coin: "BTC", px: 100, sz, side, dir: side === "B" ? "Open Long" : "Close Long", fee: 0.1, closedPnl: 0, startPosition: start, ...extra,
});

// Uma ordem de venda que zera 0,6 preenchida em 3 partes no MESMO milissegundo. Os tids não seguem a ordem real
// (é assim que a Hyperliquid devolve): pela ordem do tid, a "última" execução não é a que zera a posição.
const open = [f(10, T, "B", 0.6, 0)];
// sequência real: 200 (0,6 → 0,3), 300 (0,3 → 0,2), 100 (0,2 → 0)
const close = [f(300, T + 1000, "A", 0.1, 0.3), f(100, T + 1000, "A", 0.2, 0.2), f(200, T + 1000, "A", 0.3, 0.6)];

describe("ordem das execuções no mesmo milissegundo (D3)", () => {
  it("encadeia pelo startPosition, não pelo tid", () => {
    const o = orderFills([...close, ...open]);
    expect(o.map((x) => x.key)).toEqual(["f|10", "f|200", "f|300", "f|100"]);
  });

  it("groupTrades fecha a operação e não deixa sobra aberta", () => {
    const t = groupTrades([...open, ...close], []);
    expect(t).toHaveLength(1);
    expect(t[0]!.open).toBe(false);
    expect(t[0]!.inherited).toBe(false);
    expect(t[0]!.fees).toBeCloseTo(0.4, 9);
  });

  it("reconcilePerps calcula a posição final pela execução que termina a sequência", () => {
    const r = reconcilePerps({ now: T + 2000, liveAt: T + 2000, officialEquity: null, livePositions: [], fills: [...open, ...close], funding: [], trades: groupTrades([...open, ...close], []), netExternalFlows: null, startEquity: null, historyTruncated: false });
    expect(r.byCoin[0]!.positionFromFills).toBeCloseTo(0, 9);
    expect(r.divergences.filter((d) => d.status === "aberta")).toHaveLength(0);
  });

  it("mantém a ordem por tempo entre milissegundos diferentes e não perde execuções", () => {
    const all = [...close, ...open, f(5, T + 2000, "B", 1, 0)];
    const o = orderFills(all);
    expect(o).toHaveLength(5);
    expect(o.map((x) => x.time)).toEqual([...o.map((x) => x.time)].sort((a, b) => a - b));
  });

  it("sem encadeamento possível, cai na ordem numérica do tid (sem perder nada)", () => {
    const odd = [f(2, T, "B", 1, 7), f(1, T, "B", 1, 9)];
    expect(orderFills(odd).map((x) => x.key)).toEqual(["f|1", "f|2"]);
  });
});
