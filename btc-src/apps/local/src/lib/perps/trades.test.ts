import { describe, expect, it } from "vitest";
import { filterTrades, groupTrades, tradeStats, type Fill } from "./trades";

let n = 0;
const F = (time: number, coin: string, side: "B" | "A", sz: number, px: number, startPosition: number, closedPnl = 0, fee = 0): Fill => ({ key: `k${n++}`, time, coin, px, sz, side, dir: "", fee, closedPnl, startPosition });

describe("groupTrades", () => {
  it("long simples fechado", () => {
    const [t] = groupTrades([F(1, "BTC", "B", 1, 50000, 0, 0, 5), F(2, "BTC", "A", 1, 52000, 1, 2000, 5)], []);
    expect(t!.open).toBe(false); expect(t!.avgEntry).toBe(50000); expect(t!.avgExit).toBe(52000); expect(t!.netPnl).toBeCloseTo(1990);
  });
  it("aumento + redução parcial mantém aberta", () => {
    const [t] = groupTrades([F(1, "SOL", "B", 1, 40, 0), F(2, "SOL", "B", 1, 42, 1), F(3, "SOL", "A", 1, 43, 2, 2)], []);
    expect(t!.open).toBe(true); expect(t!.avgEntry).toBeCloseTo(41); expect(t!.maxSize).toBe(2); expect(t!.realizedPnl).toBe(2);
  });
  it("inversão divide o fill", () => {
    const r = groupTrades([F(1, "ETH", "B", 2, 100, 0, 0, 10), F(2, "ETH", "A", 5, 90, 2, -20, 25)], []);
    expect(r).toHaveLength(2);
    expect(r[0]!.realizedPnl).toBeCloseTo(-20); expect(r[0]!.fees).toBeCloseTo(20);
    expect(r[1]!.realizedPnl).toBe(0); // abrir o short não realiza o PnL do long encerrado
    expect(r[1]!.dir).toBe("SHORT"); expect(r[1]!.open).toBe(true); expect(r[1]!.maxSize).toBe(3); expect(r[1]!.fees).toBeCloseTo(15);
  });
  it("funding só dentro da janela e por moeda", () => {
    const fills = [F(10, "HYPE", "B", 10, 20, 0), F(30, "HYPE", "A", 10, 21, 10, 10)];
    const funding = [{ key: "a", time: 5, coin: "HYPE", usd: 9 }, { key: "b", time: 15, coin: "HYPE", usd: -2 }, { key: "c", time: 20, coin: "BTC", usd: 99 }, { key: "d", time: 40, coin: "HYPE", usd: 7 }];
    expect(groupTrades(fills, funding)[0]!.funding).toBe(-2);
  });
  it("BTC e HYPE não se misturam", () => {
    const r = groupTrades([F(1, "BTC", "B", 1, 1, 0), F(2, "HYPE", "A", 5, 1, 0), F(3, "BTC", "A", 1, 2, 1, 1)], []);
    expect(r.find((t) => t.coin === "BTC")!.open).toBe(false); expect(r.find((t) => t.coin === "HYPE")!.dir).toBe("SHORT");
  });
  it("posição herdada (histórico começa no meio)", () => {
    const [t] = groupTrades([F(5, "BTC", "A", 1, 70000, 1, 300)], []);
    expect(t!.inherited).toBe(true); expect(t!.avgEntry).toBeNull(); expect(t!.open).toBe(false);
  });
});

describe("tradeStats e filtros", () => {
  const trades = groupTrades([
    F(1, "SOL", "B", 1, 1, 0), F(2, "SOL", "A", 1, 1, 1, 100),
    F(3, "SOL", "B", 1, 1, 0), F(4, "SOL", "A", 1, 1, 1, -40),
    F(5, "SOL", "B", 1, 1, 0), F(6, "SOL", "A", 1, 1, 1, -30),
    F(7, "HYPE", "B", 1, 1, 0),
  ], []);
  it("taxa de acerto, fator de lucro e drawdown", () => {
    const s = tradeStats(trades);
    expect(s.closedCount).toBe(3); expect(s.openCount).toBe(1); expect(s.winRate).toBeCloseTo(1 / 3);
    expect(s.profitFactor).toBeCloseTo(100 / 70); expect(s.maxDrawdown).toBeCloseTo(70); expect(s.byCoin.SOL!.trades).toBe(3);
  });
  it("filtros", () => {
    expect(filterTrades(trades, { status: "open" })).toHaveLength(1);
    expect(filterTrades(trades, { coin: "SOL", from: 3, to: 4 })).toHaveLength(1);
    expect(filterTrades(trades, { dir: "SHORT" })).toHaveLength(0);
  });
});


it("funding na reversão e fills repetidos são contabilizados uma única vez", () => {
  const first = F(1, "BTC", "B", 1, 100, 0), reversal = F(2, "BTC", "A", 2, 110, 1, 10, 2);
  const funding = { key: "fund", time: 2, coin: "BTC", usd: -3 };
  const trades = groupTrades([first, reversal, reversal], [funding, funding]);
  expect(trades).toHaveLength(2);
  expect(trades.map(t => t.realizedPnl)).toEqual([10, 0]);
  expect(trades.reduce((s, t) => s + t.funding, 0)).toBe(-3);
  expect(trades.reduce((s, t) => s + t.fees, 0)).toBe(2);
});
