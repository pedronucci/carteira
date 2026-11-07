/** Motor v2: posições compradas e vendidas, reversões, fechamentos parciais e receitas. */
import { describe, expect, it } from "vitest";
import { replay, twr, type SEv } from "../src/lib/local/strategy";

const H = 3600e3;
const T0 = Date.UTC(2026, 10, 6, 0, 13);
let n = 0;
const buy = (t: number, px: number, sz: number, fee = 0): SEv => ({ t, k: "trade", side: "B", px, sz, fee, key: `b${n++}`, src: "hl" });
const sell = (t: number, px: number, sz: number, fee = 0): SEv => ({ t, k: "trade", side: "A", px, sz, fee, key: `s${n++}`, src: "hl" });
const base = { startT: T0, endT: T0 + 10 * H, equity0: 10_000, size0: 0, px0: 100_000, closeAt: () => 100_000, pxEnd: 100_000 };

describe("posição vendida (short)", () => {
  it("lucra quando o preço cai", () => {
    const r = replay({ ...base, pxEnd: 90_000, events: [sell(T0 + H, 100_000, 0.1)] });
    expect(r.size).toBeCloseTo(-0.1);
    expect(r.unrealized).toBeCloseTo(1_000);
    expect(r.equity).toBeCloseTo(11_000);
    expect(r.trips[0]!.dir).toBe("SHORT");
    expect(r.shortIgnored).toBe(false);
  });
  it("recompra realiza o resultado do short", () => {
    const r = replay({ ...base, events: [sell(T0 + H, 100_000, 0.1, 5), buy(T0 + 2 * H, 95_000, 0.1, 5)] });
    expect(r.size).toBe(0);
    expect(r.realized).toBeCloseTo(500);
    expect(r.equity).toBeCloseTo(10_490);
    const t = r.trips.find((x) => x.closeT != null)!;
    expect(t.pnl).toBeCloseTo(490);
    expect(t.dir).toBe("SHORT");
  });
  it("aumentar o short recalcula o preço médio", () => {
    const r = replay({ ...base, events: [sell(T0 + H, 100_000, 0.1), sell(T0 + 2 * H, 110_000, 0.1)] });
    expect(r.size).toBeCloseTo(-0.2);
    expect(r.basis).toBeCloseTo(105_000);
  });
});

describe("reversões e parciais", () => {
  it("venda maior que o long fecha o long e abre um short com o restante", () => {
    const r = replay({ ...base, pxEnd: 100_000, events: [buy(T0 + H, 90_000, 0.1), sell(T0 + 2 * H, 100_000, 0.3, 30)] });
    expect(r.size).toBeCloseTo(-0.2);
    expect(r.basis).toBeCloseTo(100_000);
    expect(r.realized).toBeCloseTo(1_000);
    const closed = r.trips.find((x) => x.closeT != null)!;
    const open = r.trips.find((x) => x.closeT == null)!;
    expect(closed.dir).toBe("LONG");
    expect(open.dir).toBe("SHORT");
    // a taxa da execução é dividida: 1/3 fecha o long, 2/3 abrem o short
    expect(closed.fees).toBeCloseTo(10);
    expect(open.fees).toBeCloseTo(20);
    expect(r.fees).toBeCloseTo(30);
    expect(r.equity).toBeCloseTo(10_000 + 1_000 - 30);
  });
  it("fechamento parcial realiza só a parte vendida", () => {
    const r = replay({ ...base, pxEnd: 110_000, events: [buy(T0 + H, 100_000, 0.2), sell(T0 + 2 * H, 110_000, 0.05)] });
    expect(r.realized).toBeCloseTo(500);
    expect(r.size).toBeCloseTo(0.15);
    expect(r.basis).toBeCloseTo(100_000);
    expect(r.unrealized).toBeCloseTo(1_500);
    expect(r.trips).toHaveLength(1);
    expect(r.trips[0]!.closeT).toBeNull();
  });
  it("o patrimônio não depende do caminho: long → short → zerado", () => {
    const r = replay({ ...base, events: [buy(T0 + H, 100_000, 0.1), sell(T0 + 2 * H, 102_000, 0.2), buy(T0 + 3 * H, 101_000, 0.1)] });
    expect(r.size).toBeCloseTo(0);
    // +200 no long, +100 no short
    expect(r.realized).toBeCloseTo(300);
    expect(r.equity).toBeCloseTo(10_300);
    expect(r.trips.filter((t) => t.closeT != null).map((t) => t.dir)).toEqual(["LONG", "SHORT"]);
  });
});

describe("posição herdada vendida", () => {
  it("só a variação depois do início entra", () => {
    const r = replay({ ...base, size0: -0.1, px0: 100_000, pxEnd: 95_000, events: [] });
    expect(r.trips[0]!.inherited).toBe(true);
    expect(r.trips[0]!.dir).toBe("SHORT");
    expect(r.unrealized).toBeCloseTo(500);
    expect(r.equity).toBeCloseTo(10_500);
  });
});

describe("receitas que não são aporte", () => {
  it("recompensa entra no resultado e no TWR, não no capital", () => {
    const r = replay({ ...base, events: [{ t: T0 + H, k: "income", usd: 50, key: "rw", src: "hl", label: "recompensa" }] });
    expect(r.income).toBe(50);
    expect(r.contrib).toBe(10_000);
    expect(r.result).toBeCloseTo(50);
    expect(twr(r.points)!).toBeCloseTo(0.005);
  });
});
