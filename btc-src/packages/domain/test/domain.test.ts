import { describe, expect, it } from "vitest";
import {
  buildLedger, classifyTransaction, d, ledgerEventsFromClassified, pairBridges, planBuy, planSell,
  estimateLiquidationPx, stressTest, summarizePerformance, drawdownSeries, rsi, sma, bollinger,
  step, classifyScenario, tradeStats, fmtBtc, fmtMoney, exposureSummary,
  type LedgerEvent, type RawTx, type TokenTransfer, type PriceAt, type Candle,
} from "../src";

const ME = "0x1111111111111111111111111111111111111111";
const ME2 = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x9999999999999999999999999999999999999999";
const POOL = "0x8888888888888888888888888888888888888888";
const WBTC_ARB = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FAKE_USDC = "0x000000000000000000000000000000000000dEaD";
const owned = new Set([ME, ME2]);
const prices: PriceAt = (ref) => (ref === "BTC" ? d(100000) : ref === "ETH" ? d(4000) : d(600));

const tx = (over: Partial<RawTx> = {}): RawTx => ({
  chainId: 42161, hash: "0xabc", blockNumber: 1, timestamp: 1_700_000_000, from: ME, to: ROUTER,
  valueWei: "0", gasUsed: "100000", gasPrice: "10000000", isError: false, ...over,
});
const tt = (token: string, from: string, to: string, value: string, logIndex = 0): TokenTransfer => ({
  chainId: 42161, hash: "0xabc", logIndex, tokenAddress: token, from, to, value,
});

describe("ledger — custo médio", () => {
  const events: LedgerEvent[] = [
    { type: "BUY", id: "a", ts: 1, qty: d(1), costUsd: d(50000), feeUsd: d(50) },
    { type: "BUY", id: "b", ts: 2, qty: d(1), costUsd: d(30000), feeUsd: d(30) },
    { type: "SELL", id: "c", ts: 3, qty: d("0.5"), proceedsUsd: d(30000), feeUsd: d(30) },
  ];
  it("capitaliza taxas e realiza pelo custo médio", () => {
    const r = buildLedger(events, "AVERAGE");
    expect(r.qty.toString()).toBe("1.5");
    expect(r.avgCostUsd!.toFixed(2)).toBe("40040.00");
    expect(r.basisUsd.toFixed(2)).toBe("60060.00");
    expect(r.realizedPnlUsd.toFixed(2)).toBe("9950.00");
    expect(r.feesUsd.toFixed(2)).toBe("110.00");
  });
  it("FIFO consome o lote mais antigo", () => {
    const r = buildLedger(events, "FIFO");
    expect(r.realizedPnlUsd.toFixed(2)).toBe("4945.00");
    expect(r.basisUsd.toFixed(2)).toBe("55055.00");
    expect(r.avgCostUsd!.toFixed(2)).toBe("36703.33");
    expect(r.openLots).toHaveLength(2);
  });
  it("avisa quando a venda excede o saldo conhecido", () => {
    const r = buildLedger([{ type: "SELL", id: "x", ts: 1, qty: d(1), proceedsUsd: d(1000), feeUsd: d(0) }], "AVERAGE");
    expect(r.warnings[0]).toMatch(/Histórico incompleto/);
    expect(r.qty.toString()).toBe("0");
  });
  it("conversão preserva custo e soma a taxa", () => {
    const r = buildLedger([
      { type: "BUY", id: "a", ts: 1, qty: d(1), costUsd: d(60000), feeUsd: d(0) },
      { type: "CONVERT", id: "b", ts: 2, qtyOut: d(1), qtyIn: d("0.999"), feeUsd: d(5) },
    ], "FIFO");
    expect(r.qty.toString()).toBe("0.999");
    expect(r.basisUsd.toFixed(2)).toBe("60005.00");
    expect(r.realizedPnlUsd.toString()).toBe("0");
  });
  it("saque não realiza resultado", () => {
    const r = buildLedger([
      { type: "BUY", id: "a", ts: 1, qty: d(2), costUsd: d(100000), feeUsd: d(0) },
      { type: "WITHDRAWAL", id: "b", ts: 2, qty: d(1) },
    ], "AVERAGE");
    expect(r.realizedPnlUsd.toString()).toBe("0");
    expect(r.basisUsd.toFixed(0)).toBe("50000");
  });
  it("estatísticas operacionais", () => {
    const r = buildLedger([
      { type: "BUY", id: "a", ts: 1, qty: d(2), costUsd: d(100000), feeUsd: d(0) },
      { type: "SELL", id: "b", ts: 2, qty: d(1), proceedsUsd: d(60000), feeUsd: d(0) },
      { type: "SELL", id: "c", ts: 3, qty: d("0.5"), proceedsUsd: d(20000), feeUsd: d(0) },
    ], "AVERAGE");
    const s = tradeStats(r.sells);
    expect(s.wins).toBe(1); expect(s.losses).toBe(1);
    expect(s.profitFactor!.toFixed(2)).toBe("2.00"); // 10000 / 5000
  });
});

describe("classificador", () => {
  it("USDC → WBTC é compra de BTC com custo e preço implícito", () => {
    const r = classifyTransaction({
      tx: tx(), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(USDC_ARB, ME, POOL, "5000000000", 0), tt(WBTC_ARB, POOL, ME, "5000000", 1)],
    });
    expect(r.kind).toBe("BUY_BTC");
    expect(r.btcDelta.toString()).toBe("0.05");
    expect(r.counterValueUsd!.toString()).toBe("5000");
    expect(r.impliedBtcPriceUsd!.toString()).toBe("100000");
    expect(r.feeNative.toString()).toBe("0.000001"); // 1e5 gas × 1e7 wei
    expect(r.feeUsd!.toString()).toBe("0.004");
    expect(r.needsReview).toBe(false);
  });
  it("WBTC → USDC é venda", () => {
    const r = classifyTransaction({
      tx: tx(), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(WBTC_ARB, ME, POOL, "1000000"), tt(USDC_ARB, POOL, ME, "1000000000", 1)],
    });
    expect(r.kind).toBe("SELL_BTC");
    expect(r.counterValueUsd!.toString()).toBe("1000");
  });
  it("transferência entre carteiras próprias não é compra nem venda", () => {
    const r = classifyTransaction({
      tx: tx({ to: WBTC_ARB }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(WBTC_ARB, ME, ME2, "10000000")],
    });
    expect(r.kind).toBe("INTERNAL_TRANSFER");
    expect(r.legs).toHaveLength(0);
  });
  it("depósito externo é TRANSFER_IN, sem taxa para o usuário", () => {
    const r = classifyTransaction({
      tx: tx({ from: POOL, to: WBTC_ARB }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(WBTC_ARB, POOL, ME, "10000000")],
    });
    expect(r.kind).toBe("TRANSFER_IN");
    expect(r.feeNative.toString()).toBe("0");
  });
  it("tx revertida consome só a taxa", () => {
    const r = classifyTransaction({
      tx: tx({ isError: true }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(USDC_ARB, ME, POOL, "5000000000")],
    });
    expect(r.kind).toBe("FAILED");
    expect(r.legs).toHaveLength(0);
    expect(r.feeNative.gt(0)).toBe(true);
  });
  it("token falso com símbolo USDC é ignorado", () => {
    const r = classifyTransaction({
      tx: tx({ from: POOL }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [{ ...tt(FAKE_USDC, POOL, ME, "999999999999"), tokenSymbol: "USDC" }],
    });
    expect(r.kind).toBe("CONTRACT_INTERACTION");
    expect(r.unrecognizedTokens[0]!.symbol).toBe("USDC");
    expect(r.needsReview).toBe(true);
  });
  it("ETH nativo → WBTC com reembolso interno usa o valor líquido", () => {
    const r = classifyTransaction({
      tx: tx({ valueWei: "1000000000000000000" }), ownedAddresses: owned, priceAt: prices,
      internalTransfers: [{ chainId: 42161, hash: "0xabc", traceId: "0", from: ROUTER, to: ME, valueWei: "500000000000000000", isError: false }],
      tokenTransfers: [tt(WBTC_ARB, POOL, ME, "2000000")],
    });
    expect(r.kind).toBe("BUY_BTC");
    expect(r.counterValueUsd!.toString()).toBe("2000"); // 0,5 ETH × 4000
    expect(r.impliedBtcPriceUsd!.toString()).toBe("100000");
  });
  it("pede revisão quando o preço implícito diverge do mercado", () => {
    const r = classifyTransaction({
      tx: tx(), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [tt(USDC_ARB, ME, POOL, "5000000000"), tt(WBTC_ARB, POOL, ME, "4000000", 1)],
    });
    expect(r.needsReview).toBe(true); // 125.000 vs 100.000
  });
  it("pareia bridge entre redes e preserva o custo no livro", () => {
    const out = classifyTransaction({
      tx: tx({ hash: "0x01", to: "0x7777777777777777777777777777777777777777" }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [{ ...tt(WBTC_ARB, ME, "0x7777777777777777777777777777777777777777", "10000000"), hash: "0x01" }],
    });
    const inn = classifyTransaction({
      tx: tx({ chainId: 10, hash: "0x02", from: POOL, to: ME, timestamp: 1_700_000_600 }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [{ chainId: 10, hash: "0x02", logIndex: 0, tokenAddress: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", from: POOL, to: ME, value: "9990000" }],
    });
    const paired = pairBridges([out, inn]);
    expect(paired.map((p) => p.kind)).toEqual(["BRIDGE_OUT", "BRIDGE_IN"]);
    const buy = classifyTransaction({
      tx: tx({ hash: "0x00", timestamp: 1_699_000_000 }), internalTransfers: [], ownedAddresses: owned, priceAt: prices,
      tokenTransfers: [{ ...tt(USDC_ARB, ME, POOL, "10000000000"), hash: "0x00" }, { ...tt(WBTC_ARB, POOL, ME, "10000000", 1), hash: "0x00" }],
    });
    const { events } = ledgerEventsFromClassified([buy, ...paired], { btcPriceAt: () => d(100000) });
    const l = buildLedger(events, "AVERAGE");
    expect(l.qty.toString()).toBe("0.0999");
    expect(l.realizedPnlUsd.toString()).toBe("0");
  });
});

describe("planner", () => {
  it("compra spot recalcula o preço médio", () => {
    const r = planBuy({ entryPriceUsd: 50000, capitalUsd: 1000, currentQtyBtc: "0.1", currentAvgCostUsd: 40000 });
    expect(r.qtyBtc.toString()).toBe("0.02");
    expect(r.newQtyBtc.toString()).toBe("0.12");
    expect(r.newAvgCostUsd!.toFixed(2)).toBe("41666.67");
  });
  it("long 2x: perda no stop e relação risco-retorno", () => {
    const r = planBuy({ entryPriceUsd: 50000, capitalUsd: 1000, leverage: 2, stopPriceUsd: 45000, targetsUsd: [60000] });
    expect(r.notionalUsd.toString()).toBe("2000");
    expect(r.qtyBtc.toString()).toBe("0.04");
    expect(r.lossAtStopUsd!.toString()).toBe("200");
    expect(r.targets[0]!.rr!.toString()).toBe("2");
  });
  it("venda parcial", () => {
    const [r] = planSell({ positionQtyBtc: 1, avgCostUsd: 40000, exitPriceUsd: 100000, fractions: [0.25], feeRate: 0.001 });
    expect(r!.sellQtyBtc.toString()).toBe("0.25");
    expect(r!.capitalFreedUsd.toString()).toBe("24975");
    expect(r!.realizedPnlUsd.toString()).toBe("14975");
    expect(r!.remainingBtc.toString()).toBe("0.75");
  });
});

describe("risco", () => {
  it("liquidação estimada pela fórmula da Hyperliquid", () => {
    const px = estimateLiquidationPx({ side: "LONG", sizeBtc: 1, markPriceUsd: 100000, marginAvailableUsd: 10000, maintenanceMarginRate: 0.0125 });
    expect(px!.toFixed(2)).toBe("89873.42");
  });
  it("estresse só com spot cai proporcionalmente", () => {
    const rows = stressTest({ btcPriceUsd: 100000, spotBtc: 1, stableUsd: 0 });
    expect(rows[1]!.equityChangeUsd.toString()).toBe("-10000");
  });
  it("estresse detecta liquidação de long isolado", () => {
    const rows = stressTest({
      btcPriceUsd: 100000, spotBtc: 0, stableUsd: 0,
      account: { crossAccountValueUsd: 0, positions: [{ id: "p1", coin: "BTC", side: "LONG", sizeBtc: 1, entryPriceUsd: 100000, markPriceUsd: 100000, marginMode: "ISOLATED", isolatedMarginUsd: 20000, maintenanceMarginRate: 0.0125 }] },
    });
    expect(rows.find((r) => r.shock === -0.1)!.liquidatedPositions).toEqual([]);
    expect(rows.find((r) => r.shock === -0.2)!.liquidatedPositions).toEqual(["p1"]);
  });
  it("alavancagem efetiva soma spot e derivativos", () => {
    const e = exposureSummary({ btcPriceUsd: 100000, spotBtc: 1, equityUsd: 100000, positions: [{ id: "p", coin: "BTC", side: "LONG", sizeBtc: "0.5", entryPriceUsd: 100000, markPriceUsd: 100000, marginMode: "CROSS", maintenanceMarginRate: 0.0125 }] });
    expect(e.effectiveLeverage!.toString()).toBe("1.5");
  });
});

describe("performance", () => {
  it("TWR ignora aportes", () => {
    const s = summarizePerformance([
      { ts: 1, equityUsd: d(100), netFlowUsd: d(0) },
      { ts: 2, equityUsd: d(110), netFlowUsd: d(0) },
      { ts: 3, equityUsd: d(210), netFlowUsd: d(100) },
    ])!;
    expect(s.twr!.toFixed(4)).toBe("0.1000");
    expect(s.marketPnlUsd.toString()).toBe("10");
  });
  it("saque não vira drawdown", () => {
    const dd = drawdownSeries([
      { ts: 1, equityUsd: d(100), netFlowUsd: d(0) },
      { ts: 2, equityUsd: d(50), netFlowUsd: d(-50) },
    ]);
    expect(dd[1]!.drawdown.toString()).toBe("0");
  });
});

describe("indicadores e cenário", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  it("SMA e RSI", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(rsi(closes, 14).at(-1)).toBe(100);
  });
  it("Bollinger em série constante tem largura zero", () => {
    expect(bollinger(Array(25).fill(10), 20).width.at(-1)).toBe(0);
  });
  it("cenário marca risco elevado quando a liquidação está próxima", () => {
    const c: Candle[] = closes.map((x, i) => ({ t: i * 86400, o: x, h: x + 1, l: x - 1, c: x, v: 1 }));
    const r = classifyScenario({ dailyCandles: c, minLiquidationDistance: 0.05 });
    expect(r.scenario).toBe("RISCO_ELEVADO");
    expect(r.uncertainty).toBe("ALTA");
  });
});

describe("alertas", () => {
  it("dispara na transição e respeita cooldown", () => {
    const rule = { id: "r", type: "PRICE_ABOVE" as const, threshold: 100, cooldownSec: 3600, enabled: true };
    let st = { lastConditionTrue: false, lastFiredAt: null as number | null };
    let r = step(rule, st, { now: 0, price: 101 }); expect(r.fire).toBe(true); st = r.state;
    r = step(rule, st, { now: 60, price: 102 }); expect(r.fire).toBe(false); st = r.state; // continua acima
    r = step(rule, st, { now: 120, price: 99 }); st = r.state;
    r = step(rule, st, { now: 180, price: 101 }); expect(r.fire).toBe(false); // cooldown
    r = step(rule, r.state, { now: 4000, price: 99 });
    r = step(rule, r.state, { now: 4100, price: 101 }); expect(r.fire).toBe(true);
  });
});

describe("formatação pt-BR", () => {
  it("BTC com 8 casas e vírgula", () => {
    expect(fmtBtc("0.27681572")).toBe("0,27681572");
    expect(fmtMoney("115221.98", "BRL").replace(/\s/g, " ")).toBe("R$ 115.221,98");
  });
});

describe("histórico patrimonial", async () => {
  const { buildEquityHistory } = await import("../src");
  it("reconstrói patrimônio e fluxos por dia", () => {
    const DAY = 86400;
    const snaps = buildEquityHistory({
      startTs: 0, endTs: 2 * DAY,
      closeAt: (ref, day) => (ref === "BTC" ? d(day === 0 ? 100000 : 110000) : d(4000)),
      ops: [
        { ts: 10, kind: "TRANSFER_IN", legs: [{ assetClass: "STABLE_USD", direction: "IN", amount: d(1000) }], feeNative: d(0), nativeClass: "ETH" },
        { ts: 20, kind: "BUY_BTC", legs: [{ assetClass: "STABLE_USD", direction: "OUT", amount: d(1000) }, { assetClass: "BTC", direction: "IN", amount: d("0.01") }], feeNative: d(0), nativeClass: "ETH" },
        { ts: DAY + 5, kind: "DERIV_DEPOSIT", legs: [{ assetClass: "STABLE_USD", direction: "OUT", amount: d(0) }], feeNative: d(0), nativeClass: "ETH" },
      ],
    });
    expect(snaps[0]!.equityUsd.toString()).toBe("1000");
    expect(snaps[0]!.netFlowUsd.toString()).toBe("1000");
    expect(snaps[1]!.equityUsd.toString()).toBe("1100");
    expect(snaps[1]!.netFlowUsd.toString()).toBe("0");
  });
  it("envio para a bridge da Hyperliquid é DERIV_DEPOSIT, não saque", () => {
    const HL = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
    const r = classifyTransaction({
      tx: tx({ to: USDC_ARB }), internalTransfers: [], ownedAddresses: owned, priceAt: prices, custodyAddresses: new Set([HL]),
      tokenTransfers: [tt(USDC_ARB, ME, HL, "1000000000")],
    });
    expect(r.kind).toBe("DERIV_DEPOSIT");
    expect(r.legs[0]!.amount.toString()).toBe("1000");
  });
});
