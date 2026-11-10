import { describe, expect, it } from "vitest";
import { bollinger, ema, macd, rsi, sma } from "./indicators";

describe("indicadores", () => {
  it("SMA: janela móvel e aquecimento", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("EMA: semente é a média simples e depois suaviza", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBeCloseTo(2, 10);
    expect(e[3]).toBeCloseTo(3, 10); // k = 0,5: 4×0,5 + 2×0,5
    expect(e[4]).toBeCloseTo(4, 10);
  });
  it("RSI: só ganhos = 100, só perdas = 0, e fica entre 0 e 100", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i), down = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(rsi(up, 14).at(-1)).toBe(100);
    expect(rsi(down, 14).at(-1)).toBe(0);
    const mixed = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    for (const x of rsi(mixed, 14)) if (x != null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); }
    expect(rsi([1, 2, 3], 14).every((x) => x == null)).toBe(true);
  });
  it("RSI de Wilder bate com o exemplo clássico (≈70,46)", () => {
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c, 14)[14]).toBeCloseTo(70.46, 1);
  });
  it("MACD: linha = EMA12 − EMA26, histograma = linha − sinal", () => {
    const v = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 4) * 3);
    const m = macd(v);
    const i = 60;
    expect(m.macd[i]).toBeCloseTo(ema(v, 12)[i]! - ema(v, 26)[i]!, 10);
    expect(m.hist[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
    expect(m.macd.slice(0, 25).every((x) => x == null)).toBe(true);
  });
  it("Bollinger: média ± 2 desvios; série constante tem bandas coladas", () => {
    const flat = bollinger(Array(25).fill(10), 20, 2);
    expect(flat.upper.at(-1)).toBeCloseTo(10, 10); expect(flat.lower.at(-1)).toBeCloseTo(10, 10);
    const b = bollinger([1, 2, 3, 4, 5], 5, 2);
    expect(b.mid[4]).toBe(3);
    expect(b.upper[4]).toBeCloseTo(3 + 2 * Math.sqrt(2), 10);
    expect(b.lower[4]).toBeCloseTo(3 - 2 * Math.sqrt(2), 10);
  });
});
