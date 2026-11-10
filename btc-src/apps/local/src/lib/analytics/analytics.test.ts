import { describe, expect, it } from "vitest";
import type { PSnapshot } from "@bst/domain";
import { groupTrades, type Fill } from "../perps/trades";
import { byOrigin, drawdown, hodlResult, perpStats, perfByCoin, rangeEvolution, resolveRange, sortPerf, splitStrategy, waterfall } from "./analytics";

const D = 86400e3;
let k = 0;
const fill = (coin: string, t: number, side: "B" | "A", sz: number, px: number, o: { fee?: number; pnl?: number; start?: number } = {}): Fill => ({ key: `f${k++}`, time: t, coin, px, sz, side, dir: "", fee: o.fee ?? 0, closedPnl: o.pnl ?? 0, startPosition: o.start ?? 0 });
const all = { from: null, to: 1e15 };

// BTC long fechado em duas saídas (parcial + final) + HYPE long fechado + SOL short aberto
const fills: Fill[] = [
  fill("BTC", 1 * D, "B", 2, 100, { fee: 1 }), fill("BTC", 2 * D, "A", 1, 110, { fee: 0.5, pnl: 10 }), fill("BTC", 3 * D, "A", 1, 120, { fee: 0.5, pnl: 20 }),
  fill("HYPE", 2 * D, "B", 10, 10, { fee: 0.2 }), fill("HYPE", 4 * D, "A", 10, 9, { fee: 0.2, pnl: -10 }),
  fill("SOL", 5 * D, "A", 5, 100, { fee: 0.3 }),
];
const funding = [{ time: 2 * D, coin: "BTC", usd: -2 }, { time: 3 * D, coin: "HYPE", usd: 1 }, { time: 6 * D, coin: "SOL", usd: 0.5 }];
const trades = groupTrades(fills, funding.map((f, i) => ({ key: `u${i}`, ...f })));

describe("perfByCoin", () => {
  const rows = perfByCoin(trades, funding, [{ coin: "SOL", upnl: 4, notional: 500 }], all);
  const by = (c: string) => rows.find((r) => r.coin === c)!;
  it("descobre instrumentos dinamicamente e soma realizado, taxas e funding uma vez", () => {
    expect(rows.map((r) => r.coin).sort()).toEqual(["BTC", "HYPE", "SOL"]);
    expect(by("BTC")).toMatchObject({ realized: 30, fees: 2, funding: -2, net: 26, trades: 1 });
    expect(by("HYPE").net).toBeCloseTo(-10 - 0.4 + 1);
    expect(by("SOL")).toMatchObject({ realized: 0, fees: 0.3, funding: 0.5, unrealized: 4, exposureShare: 1 });
  });
  it("fechamento parcial não cria operação separada", () => { expect(by("BTC").trades).toBe(1); expect(trades.filter((t) => t.coin === "BTC")).toHaveLength(1); });
  it("contribuição soma 100% e respeita sinal", () => {
    expect(rows.reduce((a, r) => a + (r.contribution ?? 0), 0)).toBeCloseTo(1);
    expect(by("HYPE").contribution!).toBeLessThan(0);
  });
  it("período: só fills e funding dentro do intervalo", () => {
    const r = perfByCoin(trades, funding, [], { from: 2.5 * D, to: 3.5 * D });
    expect(r.find((x) => x.coin === "BTC")).toMatchObject({ realized: 20, fees: 0.5, funding: 0 });
    expect(r.find((x) => x.coin === "HYPE")!.funding).toBe(1);
  });
  it("ordenação por lucro, prejuízo, taxas e funding", () => {
    expect(sortPerf(rows, "net")[0]!.coin).toBe("BTC");
    expect(sortPerf(rows, "loss")[0]!.coin).toBe("HYPE");
    expect(sortPerf(rows, "fees")[0]!.coin).toBe("BTC");
    expect(sortPerf(rows, "funding")[0]!.coin).toBe("BTC");
  });
});

describe("waterfall", () => {
  it("bruto + funding − taxas = líquido (sem dupla dedução)", () => {
    const w = waterfall(perfByCoin(trades, funding, [], all));
    expect(w.gross).toBe(20); expect(w.funding).toBeCloseTo(-0.5); expect(w.fees).toBeCloseTo(-2.7);
    expect(w.net).toBeCloseTo(w.gross + w.funding + w.fees);
    expect(w.net).toBeCloseTo(perfByCoin(trades, funding, [], all).reduce((a, r) => a + r.net, 0));
  });
});

describe("perpStats", () => {
  it("taxa de acerto, profit factor, expectância, extremos e LONG/SHORT", () => {
    const s = perpStats(trades, all);
    expect(s.closed).toBe(2); expect(s.wins).toBe(1); expect(s.losses).toBe(1); expect(s.open).toBe(1);
    expect(s.winRate).toBe(0.5); expect(s.largestWin).toBeCloseTo(26); expect(s.largestLoss).toBeCloseTo(-9.4);
    expect(s.profitFactor).toBeCloseTo(26 / 9.4); expect(s.expectancy).toBeCloseTo((26 - 9.4) / 2);
    expect(s.byDir.LONG.n).toBe(2); expect(s.byDir.SHORT.n).toBe(0);
    expect(s.curve.at(-1)!.cum).toBeCloseTo(16.6);
  });
  it("sem operações → métricas nulas, não zero", () => { const s = perpStats([], all); expect(s.winRate).toBeNull(); expect(s.profitFactor).toBeNull(); expect(s.expectancy).toBeNull(); });
});

describe("splitStrategy (isolamento BTC/USDC)", () => {
  it("só BTC após o início do ciclo vai para a estratégia; o resto fica fora", () => {
    const r = splitStrategy(trades, funding, 2.5 * D, all);
    expect(r.strategy).toMatchObject({ realized: 20, fees: 0.5, funding: 0, net: 19.5 });
    expect(r.others.realized).toBeCloseTo(10 + -10); // BTC antes do início (10) + HYPE (-10)
    expect(r.strategy.net + r.others.net).toBeCloseTo(perfByCoin(trades, funding, [], all).reduce((a, x) => a + x.net, 0));
  });
  it("sem ciclo → nada é atribuído à estratégia", () => expect(splitStrategy(trades, funding, null, all).strategy.net).toBe(0));
});

const snap = (t: number, a: Record<string, number>, extra: Partial<PSnapshot> = {}): PSnapshot => ({ t, byAccount: a, ...extra });
describe("rangeEvolution / drawdown / flows", () => {
  const s = [snap(1 * D, { hl: 1000 }), snap(2 * D, { hl: 1100 }), snap(3 * D, { hl: 1500 }), snap(4 * D, { hl: 1350 }), snap(5 * D, { hl: 1400 })];
  const fl = [{ t: 2.5 * D, accountId: "hl", usd: 300 }];
  it("aporte não vira resultado", () => {
    const e = rangeEvolution(s, fl, all);
    expect(e.rawChangeUsd).toBe(400); expect(e.flowsUsd).toBe(300); expect(e.resultUsd).toBeCloseTo(100, 6);
  });
  it("transferência interna (fluxo + e −) não altera o resultado", () => {
    const f2 = [...fl, { t: 2.6 * D, accountId: "hl", usd: -300 }, { t: 2.6 * D, accountId: "ex", usd: 300 }];
    expect(rangeEvolution(s, f2, all).resultUsd).toBeCloseTo(400, 6);
  });
  it("drawdown máximo ajustado por fluxos", () => {
    const d = drawdown(s, fl, all);
    expect(d.max).toBeGreaterThan(0.05); expect(d.max).toBeLessThan(0.15); expect(d.incomplete).toBe(false);
  });
  it("sem retratos suficientes → incompleto, sem números", () => {
    const e = rangeEvolution([s[0]!], [], all);
    expect(e.incomplete).toBe(true); expect(e.resultUsd).toBeNull();
    expect(drawdown([s[0]!], [], all).max).toBeNull();
  });
  it("início anterior ao histórico é sinalizado", () => {
    const e = rangeEvolution(s, [], { from: -30 * D + 5 * D, to: 5 * D });
    expect(e.incomplete).toBe(true); expect(e.availableFrom).toBe(1 * D);
  });
  it("intervalo personalizado usa o retrato anterior como âncora", () => {
    const e = rangeEvolution(s, [], { from: 2.2 * D, to: 5 * D });
    expect(e.fromT).toBe(2 * D); expect(e.incomplete).toBe(false);
  });
});

describe("byOrigin", () => {
  it("separa origens, ignora a conta da estratégia e não mistura fluxos", () => {
    const s = [snap(1 * D, { hl: 1000, ok: 500, w: 200, st: 800 }), snap(2 * D, { hl: 1100, ok: 500, w: 220, st: 900 })];
    const r = byOrigin(s, [{ t: 1.5 * D, accountId: "ok", usd: 100 }], [{ id: "hl", kind: "hyperliquid" }, { id: "ok", kind: "okx" }, { id: "w", kind: "evm" }, { id: "st", kind: "strategy" }], all);
    expect(r.map((x) => x.origin).sort()).toEqual(["Carteiras spot", "Hyperliquid", "OKX"]);
    expect(r.find((x) => x.origin === "Hyperliquid")!.resultUsd).toBeCloseTo(100);
    expect(r.find((x) => x.origin === "OKX")!.resultUsd).toBeCloseTo(-100);
  });
});

describe("hodlResult", () => {
  const s = [snap(1 * D, { a: 1000 }, { btcUsd: 100, px: { ETH: 10 } }), snap(2 * D, { a: 1200 }, { btcUsd: 150 }), snap(3 * D, { a: 1500 }, { btcUsd: 200, px: { ETH: 20 } })];
  it("mesmos fluxos: aporte entra ao preço do retrato anterior", () => {
    const h = hodlResult(s, [{ t: 2.2 * D, accountId: "a", usd: 150 }], "BTC", all)!;
    // 10 BTC + 150/150 = 1 BTC → 11 BTC × 200 = 2200; investido 1150
    expect(h.resultUsd).toBeCloseTo(2200 - 1150); expect(h.pct).toBeCloseTo(2200 / 1150 - 1);
  });
  it("sem preço gravado em todos os pontos → dados insuficientes", () => {
    expect(hodlResult(s, [{ t: 2.2 * D, accountId: "a", usd: 150 }], "ETH", all)).toBeNull(); // 2º retrato sem ETH
    expect(hodlResult(s, [], "ETH", all)!.pct).toBeCloseTo(1);
    expect(hodlResult(s, [], "SOL", all)).toBeNull();
  });
});

describe("resolveRange", () => {
  const now = new Date(2026, 10, 9, 12).getTime();
  it("presets, ano atual, histórico e personalizado", () => {
    expect(resolveRange("7", now).from).toBe(now - 7 * D);
    expect(resolveRange("ytd", now).from).toBe(new Date(2026, 0, 1).getTime());
    expect(resolveRange("all", now).from).toBeNull();
    expect(resolveRange("custom", now, { from: 5, to: 2 })).toEqual({ from: 2, to: 5 });
  });
});
