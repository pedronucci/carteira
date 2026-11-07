import { describe, expect, it } from "vitest";
import { dedupe, maxDrawdown, positionAt, replay, twr, windowEvents, zonedToUtc, utcToZoned, type SEv } from "../src/lib/local/strategy";

const H = 3600e3, D = 24 * H;
const T0 = Date.UTC(2026, 10, 5, 3, 0); // 05/11/2026 00:00 em São Paulo
const flat = (px: number) => () => px;
let n = 0;
const buy = (t: number, px: number, sz: number, fee = 0): SEv => ({ t, k: "trade", side: "B", px, sz, fee, key: `b${n++}`, src: "hl" });
const sell = (t: number, px: number, sz: number, fee = 0): SEv => ({ t, k: "trade", side: "A", px, sz, fee, key: `s${n++}`, src: "hl" });
const flow = (t: number, usd: number): SEv => ({ t, k: "flow", usd, key: `f${n++}`, src: "hl", label: usd > 0 ? "deposit" : "withdraw" });
const fund = (t: number, usd: number): SEv => ({ t, k: "funding", usd, key: `u${n++}`, src: "hl" });
const base = { startT: T0, endT: T0 + 10 * D, equity0: 10_000, size0: 0, px0: 100_000, closeAt: flat(100_000), pxEnd: 100_000 };

describe("fluxos externos", () => {
  it("depósito depois do início não é lucro", () => {
    const r = replay({ ...base, events: [flow(T0 + D, 5_000)] });
    expect(r.equity).toBeCloseTo(15_000);
    expect(r.contrib).toBeCloseTo(15_000);
    expect(r.result).toBeCloseTo(0);
    expect(twr(r.points)).toBeCloseTo(0);
  });
  it("retirada não é prejuízo", () => {
    const r = replay({ ...base, events: [flow(T0 + D, -3_000)] });
    expect(r.equity).toBeCloseTo(7_000);
    expect(r.result).toBeCloseTo(0);
    expect(r.flowsOut).toBeCloseTo(3_000);
    expect(twr(r.points)).toBeCloseTo(0);
  });
  it("Buy & Hold compra BTC com cada aporte no preço do dia", () => {
    const close = (day: number) => (day * 1000 < T0 + 5 * D ? 100_000 : 50_000);
    const r = replay({ ...base, closeAt: close, pxEnd: 50_000, events: [flow(T0 + 6 * D, 5_000)] });
    expect(r.hodlUnits).toBeCloseTo(0.1 + 0.1); // 10.000/100k + 5.000/50k
    expect(r.hodl).toBeCloseTo(10_000);
  });
});

describe("posições", () => {
  it("posição herdada: só o resultado posterior ao início conta", () => {
    // entrada oficial foi 90k, mas o ciclo começa com o BTC a 100k
    const r = replay({ ...base, size0: 0.2, px0: 100_000, pxEnd: 110_000, events: [] });
    expect(r.result).toBeCloseTo(0.2 * 10_000); // 2.000, não 4.000
    expect(r.trips[0]!.inherited).toBe(true);
    expect(r.trips[0]!.entry).toBe(100_000);
  });
  it("saídas parciais realizam pela base média", () => {
    const r = replay({ ...base, events: [buy(T0 + H, 100_000, 0.2), sell(T0 + 2 * H, 110_000, 0.1), sell(T0 + 3 * H, 120_000, 0.1)] });
    expect(r.realized).toBeCloseTo(1_000 + 2_000);
    expect(r.size).toBe(0);
    expect(r.trips).toHaveLength(1);
    expect(r.trips[0]!.exit).toBeCloseTo(115_000);
    expect(r.result).toBeCloseTo(3_000);
  });
  it("aumento de posição recalcula o preço médio", () => {
    const r = replay({ ...base, pxEnd: 100_000, events: [buy(T0 + H, 100_000, 0.1), buy(T0 + 2 * H, 80_000, 0.1)] });
    expect(r.basis).toBeCloseTo(90_000);
    expect(r.unrealized).toBeCloseTo(0.2 * 10_000);
  });
  it("taxas e funding entram no resultado", () => {
    const r = replay({ ...base, events: [buy(T0 + H, 100_000, 0.1, 5), fund(T0 + 2 * H, -12), sell(T0 + 3 * H, 100_000, 0.1, 5)] });
    expect(r.fees).toBeCloseTo(10);
    expect(r.funding).toBeCloseTo(-12);
    expect(r.result).toBeCloseTo(-22);
    expect(r.trips[0]!.pnl).toBeCloseTo(-22);
  });
  // Mudança intencional do Terminal 5.0 (motor v2): a venda maior que a posição fecha o long e abre um short
  // com o restante. Na versão 4 o excesso era ignorado (shortIgnored). Ver test/motor-v2.test.ts.
  it("venda maior que a posição reverte para short (motor v2)", () => {
    const r = replay({ ...base, events: [buy(T0 + H, 100_000, 0.1), sell(T0 + 2 * H, 100_000, 0.3)] });
    expect(r.size).toBeCloseTo(-0.2);
    expect(r.shortIgnored).toBe(false);
  });
  it("posição oficial em um instante", () => {
    const tr = [buy(1, 100, 1), buy(2, 200, 1), sell(3, 300, 0.5)] as Extract<SEv, { k: "trade" }>[];
    expect(positionAt(tr, 2)).toEqual({ size: 2, entry: 150 });
    expect(positionAt(tr, 3).size).toBe(1.5);
  });
});

describe("troca de ciclos", () => {
  const ev = [flow(T0 - 5 * D, 10_000), buy(T0 - 4 * D, 90_000, 0.1), sell(T0 - 3 * D, 95_000, 0.1), // antes do início
    buy(T0 + D, 100_000, 0.1), flow(T0 + 2 * D, 1_000), sell(T0 + 3 * D, 105_000, 0.1)];
  it("operações encerradas antes do início não entram", () => {
    const w = windowEvents(ev, T0, T0 + 10 * D);
    const r = replay({ ...base, equity0: 10_500, events: w });
    expect(r.trips).toHaveLength(1);
    expect(r.result).toBeCloseTo(500);
    expect(r.contrib).toBeCloseTo(11_500);
  });
  it("ciclos consecutivos somam o resultado da conta", () => {
    const close = flat(100_000);
    const acc = replay({ startT: T0 - 6 * D, endT: T0 + 10 * D, equity0: 0, size0: 0, px0: 100_000, closeAt: close, pxEnd: 100_000, events: ev });
    const mid = T0 + 2 * D + H; // depois do aporte, com a posição aberta
    const a = replay({ startT: T0 - 6 * D, endT: mid, equity0: 0, size0: 0, px0: 100_000, closeAt: close, pxEnd: 100_000, events: windowEvents(ev, T0 - 6 * D, mid) });
    const b = replay({ startT: mid, endT: T0 + 10 * D, equity0: a.equity, size0: a.size, px0: 100_000, closeAt: close, pxEnd: 100_000, events: windowEvents(ev, mid, T0 + 10 * D) });
    expect(a.result + b.result).toBeCloseTo(acc.result);
    expect(b.trips[0]!.inherited).toBe(true);
  });
  it("sincronização repetida não duplica", () => {
    expect(dedupe([...ev, ...ev])).toHaveLength(ev.length);
  });
});

describe("performance e fuso", () => {
  it("queda máxima ignora fluxos", () => {
    const close = (day: number) => (day * 1000 < T0 + 3 * D ? 100_000 : 80_000);
    const r = replay({ ...base, closeAt: close, pxEnd: 80_000, size0: 0.1, events: [flow(T0 + 5 * D, 50_000)] });
    expect(maxDrawdown(r.points)).toBeCloseTo(2_000 / 10_000);
  });
  it("05/11/2026 00:00 em São Paulo = 03:00 UTC", () => {
    expect(zonedToUtc("2026-11-05", "00:00", "America/Sao_Paulo")).toBe(T0);
    expect(utcToZoned(T0, "America/Sao_Paulo")).toEqual({ date: "2026-11-05", time: "00:00" });
    expect(zonedToUtc("2026-11-05", "00:00", "UTC")).toBe(Date.UTC(2026, 10, 5));
  });
});
