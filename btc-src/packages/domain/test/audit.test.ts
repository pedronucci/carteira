import { describe, expect, it } from "vitest";
import { atr, buildLedger, classifyFlows, consolidate, d, dailyStats, planBuy, portfolioReturns, positionMetrics, returnSince, rsi, selectSnapshotRange, type PAccount, type PEvent, type PHolding } from "../src";

const account: PAccount = { id: "a", name: "A", institution: "Teste", kind: "manual", createdAt: 0 };
const holding = (extra: Partial<PHolding>): PHolding => ({ accountId: "a", assetKey: "BTC", econ: "BTC", symbol: "BTC", network: "bitcoin", qty: "1", kind: "spot", source: "manual", at: 1, ...extra });
describe("regressões da auditoria de novembro", () => {
  it("A06: equity em dólares não substitui quantidade nem representa custódia", () => {
    const c = consolidate([account], [holding({ qty: "0.2", kind: "equity", valueUsd: 20000, custodyQty: "0.15" })], {});
    expect(c.assets[0]!.qty).toBe(0.2); expect(c.totalUsd).toBe(20000); expect(c.btcHeld.total).toBe(0.15);
  });
  it("A12: valor parcial não gera PnL sobre custo completo", () => {
    const c = consolidate([account], [holding({ assetKey: "a", valueUsd: 100, costUsd: 50 }), holding({ assetKey: "b", costUsd: 50 })], {});
    expect(c.assets[0]!.complete).toBe(false); expect(c.assets[0]!.pnlUsd).toBeNull();
  });
  it("A14: base zero com resultado não tem retorno válido", () => {
    const points = portfolioReturns([{ t: 1, byAccount: { a: 0 } }, { t: 2, byAccount: { a: 100 } }], []);
    expect(points[1]!.valid).toBe(false); expect(returnSince(points, null)).toBeNull();
  });
  it("retratos parciais não produzem retorno aparente", () => {
    const points = portfolioReturns([{ t: 1, byAccount: { a: 100 } }, { t: 2, byAccount: { a: 80 }, quality: "partial" }], []);
    expect(returnSince(points, null)).toBeNull();
  });
  it("janela temporal conserva a âncora anterior e exclui o futuro", () => {
    const s = [1, 2, 3, 4].map(t => ({ t, byAccount: { a: 100 } }));
    expect(selectSnapshotRange(s, { from: 2.5, to: 3 }).map(x => x.t)).toEqual([2, 3]);
  });
  it("RSI constante é neutro e ATR exige OHLC real", () => {
    expect(rsi(Array(30).fill(100)).at(-1)).toBe(50);
    expect(atr(Array.from({ length: 30 }, (_, t) => ({ t, o: 100, h: 100, l: 100, c: 100, v: 0, synthetic: true }))).every(x => x === null)).toBe(true);
  });
  it("lacuna de dias não vira volatilidade diária anualizada", () => {
    expect(dailyStats([{ t: 0, index: 1 }, { t: 86400e3 * 20, index: 1.2 }], { minVolDays: 1 }).volAnnual).toBeNull();
  });
  it("A30: venda sem estoque conhecido não fabrica lucro", () => {
    const r = buildLedger([{ type: "SELL", id: "x", ts: 1, qty: d(2), proceedsUsd: d(100), feeUsd: d(0) }], "FIFO");
    expect(r.realizedPnlUsd.toNumber()).toBe(0); expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("A30: conversão conserva prioridade FIFO do lote antigo", () => {
    const r = buildLedger([
      { type: "BUY", id: "a", ts: 1, qty: d(1), costUsd: d(10), feeUsd: d(0) },
      { type: "BUY", id: "b", ts: 2, qty: d(1), costUsd: d(100), feeUsd: d(0) },
      { type: "CONVERT", id: "c", ts: 3, qtyOut: d(1), qtyIn: d(1), feeUsd: d(0) },
      { type: "SELL", id: "d", ts: 4, qty: d(1), proceedsUsd: d(50), feeUsd: d(0) },
    ], "FIFO");
    expect(r.realizedPnlUsd.toNumber()).toBe(40);
  });
  it("perpétuo 1x mantém funding e quantidade contratada", () => {
    const p = planBuy({ market: "PERP", entryPriceUsd: 100, capitalUsd: 1000, leverage: 1, feeRate: 0.01, fundingRate8h: 0.001, holdingDays: 1 });
    expect(p.qtyBtc.toNumber()).toBe(10); expect(p.estFundingUsd.toNumber()).toBe(3);
    expect(() => planBuy({ entryPriceUsd: 0, capitalUsd: 100 })).toThrow();
  });
  it("distância de liquidação ultrapassada conserva sinal", () => {
    expect(positionMetrics({ id: "p", coin: "BTC", side: "LONG", sizeBtc: 1, entryPriceUsd: 100, markPriceUsd: 80, marginMode: "CROSS", maintenanceMarginRate: 0.01, liquidationPxOfficial: 90 }).liquidationDistance!.toNumber()).toBeLessThan(0);
  });
  it("classificação explícita é independente do tipo do evento", () => {
    const e: PEvent = { id: "x", accountId: "a", t: 1, kind: "withdraw", econ: "BTC", qty: 1, usd: 100, classification: "internal" };
    expect(classifyFlows([e], [account])[0]!.cls).toBe("internal");
  });
});
