import { describe, expect, it } from "vitest";
import { reconcilePerps, type ReconInput } from "./reconcile";
import { groupTrades, type Fill } from "./trades";

let n = 0;
const F = (time: number, coin: string, side: "B" | "A", sz: number, px: number, sp: number, pnl = 0, fee = 0): Fill => ({ key: `r${n++}`, time, coin, px, sz, side, dir: "", fee, closedPnl: pnl, startPosition: sp });
const base = (o: Partial<ReconInput> = {}): ReconInput => {
  const fills = [F(1, "HYPE", "B", 10, 40, 0, 0, 1), F(2, "BTC", "B", 1, 70000, 0, 0, 5), F(3, "BTC", "A", 0.4, 71000, 1, 400, 2)];
  return { now: 100, liveAt: 99, officialEquity: 1000 + 0 - 1 - 7 + 400 + 20, livePositions: [{ coin: "HYPE", szi: 10, upnl: 20 }, { coin: "BTC", szi: 0.6, upnl: 0 }], fills, funding: [], trades: groupTrades(fills, []), netExternalFlows: 0, startEquity: 1000, historyTruncated: false, ...o };
};

describe("reconcilePerps", () => {
  it("concilia quando tamanhos e equity batem", () => {
    const r = reconcilePerps(base());
    expect(r.status).toBe("reconciled"); expect(r.divergences).toHaveLength(0); expect(r.byCoin.find((c) => c.coin === "BTC")!.positionOk).toBe(true);
  });
  it("tamanho divergente vira relatório por ativo", () => {
    const r = reconcilePerps(base({ livePositions: [{ coin: "HYPE", szi: 12, upnl: 20 }, { coin: "BTC", szi: 0.6, upnl: 0 }] }));
    expect(r.status).toBe("divergence"); expect(r.divergences[0]).toMatchObject({ coin: "HYPE", type: "Tamanho da posição", expected: 10, found: 12 });
  });
  it("equity oficial diferente do modelo", () => {
    const r = reconcilePerps(base({ officialEquity: 1300 }));
    expect(r.status).toBe("divergence"); expect(r.equityDiff).toBeCloseTo(1300 - 1412 + 0, 0); expect(r.divergences.some((d) => d.coin === "Conta")).toBe(true);
  });
  it("histórico truncado ou desatualizado não é 'conciliado'", () => {
    expect(reconcilePerps(base({ historyTruncated: true })).status).toBe("incomplete");
    expect(reconcilePerps(base({ liveAt: 1, now: 1e9 })).status).toBe("stale");
  });
  it("sem patrimônio inicial é parcial", () => expect(reconcilePerps(base({ startEquity: null })).status).toBe("partial"));
  it("posição herdada é sinalizada", () => {
    const fills = [F(1, "SOL", "A", 1, 100, 1, 10)];
    const r = reconcilePerps(base({ fills, trades: groupTrades(fills, []), livePositions: [], officialEquity: null }));
    expect(r.status).toBe("incomplete"); expect(r.reasons.join()).toContain("herdada");
  });
});
