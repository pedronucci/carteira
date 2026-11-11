import { describe, expect, it } from "vitest";
import { breakEvenShock, scenarioGrid, simulate, type SimInput } from "./scenario";

const btc = { coin: "BTC", szi: 0.1, mark: 50000, upnl: 0, marginUsed: 1000, maintRate: 0.02, liqPx: null };
const hype = { coin: "HYPE", szi: -100, mark: 20, upnl: 0, marginUsed: 200, maintRate: 0.05, liqPx: null };

describe("simulate", () => {
  it("long BTC cai 10%", () => {
    const r = simulate({ accountValue: 1000, positions: [btc] }, { BTC: -0.1 });
    expect(r.pnlDelta).toBeCloseTo(-500); expect(r.newAccountValue).toBeCloseTo(500); expect(r.maintMarginTotal).toBeCloseTo(0.1 * 45000 * 0.02); expect(r.liquidated).toBe(false);
  });
  it("BTC long + HYPE short, choques conjuntos", () => {
    const r = simulate({ accountValue: 1200, positions: [btc, hype], otherEquity: 300 }, { BTC: -0.1, HYPE: -0.15 });
    expect(r.pnlDelta).toBeCloseTo(-500 + 300); expect(r.newConsolidated).toBeCloseTo(300 + 1000);
  });
  it("moeda ausente não muda e liquidação é detectada", () => {
    const i: SimInput = { accountValue: 300, positions: [btc] };
    expect(simulate(i, {}).pnlDelta).toBe(0);
    expect(simulate(i, { BTC: -0.5 }).liquidated).toBe(true);
  });
  it("breakEven fecha em maint = equity", () => {
    const i: SimInput = { accountValue: 1000, positions: [{ ...btc, szi: 0.1, mark: 50000, maintRate: 0.02 }] };
    const s = breakEvenShock(i, ["BTC"])!;
    expect(simulate(i, { BTC: s }).bufferUsd).toBeCloseTo(0, 6);
    expect(s).toBeLessThan(0);
    expect(breakEvenShock(i, ["SOL"])).toBeNull();
  });
  it("grid", () => expect(scenarioGrid({ accountValue: 1000, positions: [btc] }, "BTC", [-0.1, 0, 0.1])).toHaveLength(3));
});


it("garantia incompleta e margem isolada não produzem fronteira de liquidação", () => {
  for (const input of [{ accountValue: 1000, positions: [btc], liquidationAvailable: false }, { accountValue: 1000, positions: [{ ...btc, marginMode: "isolated" }] }]) {
    expect(simulate(input, { BTC: -0.5 }).liquidationAvailable).toBe(false);
    expect(breakEvenShock(input, ["BTC"])).toBeNull();
  }
  expect(() => simulate({ accountValue: 1000, positions: [btc] }, { BTC: -1.1 })).toThrow();
});
