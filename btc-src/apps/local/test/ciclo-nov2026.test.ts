/**
 * Reproduz o ciclo real iniciado em 05/11/2026 às 21:13 (São Paulo), com os valores das capturas do app
 * de 06/11/2026 às 16:48. Os valores de taxas são aproximados para fechar o patrimônio mostrado.
 */
import { describe, expect, it } from "vitest";
import { fmtDuration, maxDrawdown, replay, twr, windowEvents, zonedToUtc, type SEv } from "../src/lib/local/strategy";
import { periodReturn } from "../src/lib/local/engine";

const SP = "America/Sao_Paulo";
const at = (d: string, h: string) => zonedToUtc(d, h, SP);
const START = at("2026-11-05", "21:13");
const NOW = at("2026-11-06", "16:48");
const trade = (t: number, px: number, sz: number, fee: number, key: string): SEv => ({ t, k: "trade", side: "B", px, sz, fee, key, src: "manual" });

// abertura 6x: US$ 36.318,00 → 0,47692712 BTC; dois aumentos depois do depósito
const open = trade(at("2026-11-05", "21:13"), 36318 / 0.47692712, 0.47692712, 15.0, "open");
const deposit: SEv = { t: at("2026-11-06", "16:22"), k: "flow", usd: 5103.58, key: "dep", src: "manual", label: "Aporte" };
const add1 = trade(at("2026-11-06", "16:24"), 10534.98 / 0.1393092, 0.1393092, 11.29, "add1");
const add2 = trade(at("2026-11-06", "16:25"), 12096.96 / 0.15919985, 0.15919985, 12.28, "add2");
const PX_NOW = 75798.08;
const closeAt = () => 76150; // fechamento diário (irrelevante aqui: tudo acontece no mesmo dia UTC)

const run = () => replay({
  startT: START, endT: NOW, equity0: 8006, size0: 0, px0: 76150,
  events: windowEvents([open, deposit, add1, add2], START, NOW, true), closeAt, pxEnd: PX_NOW,
});

describe("ciclo de 05/11/2026 21:13", () => {
  it("início em 05/11 21:13 de São Paulo = 06/11 00:13 UTC", () => {
    expect(new Date(START).toISOString()).toBe("2026-11-06T00:13:00.000Z");
  });
  it("a primeira transação, no instante exato do início, pertence ao ciclo", () => {
    expect(windowEvents([open], START, NOW, true)).toHaveLength(1);
  });
  it("posição e preço médio batem com o app", () => {
    const r = run();
    expect(r.size).toBeCloseTo(0.775436, 6);
    expect(r.basis).toBeCloseTo(76021.65, 0);
  });
  it("patrimônio, capital e resultado batem com o app", () => {
    const r = run();
    expect(r.equity).toBeCloseTo(12897.65, 0);
    expect(r.contrib).toBeCloseTo(13109.58, 2);
    expect(r.result).toBeCloseTo(-211.93, 0);
    // retorno sobre o capital: −211,93 ÷ 13.109,58
    expect(r.result / r.contrib).toBeCloseTo(-0.01617, 4);
  });
  it("a série começa no início do ciclo, não no dia UTC anterior", () => {
    const r = run();
    expect(r.points[0]!.ts * 1000).toBe(START);
    expect(r.points[0]!.equity).toBe(8006);
    expect(r.points.at(-1)!.ts * 1000).toBe(NOW);
    expect(r.points.every((p) => p.ts * 1000 >= START)).toBe(true);
  });
  it("o depósito abre um subperíodo: o TWR mede a perda de antes do depósito sobre os 8.006", () => {
    const r = run();
    const dep = r.points.find((p) => p.ts * 1000 === deposit.t)!;
    // antes do depósito: 8.006 − 15 + 0,4769 × (75.622,6 − 76.150) ≈ 7.739,5 (preço da execução 2 min depois)
    expect(dep.equity).toBeCloseTo(7739.5, 0);
    const before = dep.equity / 8006 - 1; // ≈ −3,33%
    const after = (r.equity - dep.equity - 5103.58) / (dep.equity + 5103.58); // ≈ +0,42%
    expect(twr(r.points)!).toBeCloseTo((1 + before) * (1 + after) - 1, 6);
    expect(twr(r.points)!).toBeCloseTo(-0.0292, 3);
  });
  it("o resultado em dinheiro do período não muda com a forma de medir o percentual", () => {
    const r = run();
    const pts = r.points.map((p) => ({ ...p, btc: p.equity / p.price }));
    const all = periodReturn(pts, null)!;
    expect(all.money).toBeCloseTo(-211.93, 0);
    expect(all.pct).toBeCloseTo(twr(r.points)!, 8);
  });
  it("24 h num ciclo com menos de um dia mede desde o início (parcial)", () => {
    const pts = run().points.map((p) => ({ ...p, btc: 0 }));
    expect(periodReturn(pts, 1)).toBeNull();
    const d = periodReturn(pts, 1, true)!;
    expect(d.partial).toBe(true);
    expect(d.money).toBeCloseTo(-211.93, 0);
  });
  it("queda máxima vem do subperíodo antes do depósito", () => {
    expect(maxDrawdown(run().points)).toBeCloseTo(1 - 7739.5 / 8006, 3);
  });
  it("percentual da posição considera o aporte feito com ela aberta (−1,62%, não −2,65%)", () => {
    const t = run().trips.find((x) => x.closeT == null)!;
    expect(t.pnlPct!).toBeCloseTo(-211.93 / 13109.58, 3);
  });
  it("tempo na posição: 19 h, não \"0 dias\"", () => {
    expect(fmtDuration(NOW - open.t)).toBe("19 h");
    expect(fmtDuration(2 * 86400e3 + 5 * 3600e3)).toBe("2 d 5 h");
    expect(fmtDuration(40 * 60e3)).toBe("40 min");
  });
});

describe("série de pontos", () => {
  const T0 = Date.UTC(2026, 10, 6, 0, 13);
  it("aporte sem posição aberta: TWR zero e resultado zero", () => {
    const r = replay({ startT: T0, endT: T0 + 3 * 86400e3, equity0: 1000, size0: 0, px0: 100, closeAt: () => 100, pxEnd: 100,
      events: [{ t: T0 + 5 * 3600e3, k: "flow", usd: 500, key: "f", src: "hl", label: "dep" }] });
    expect(r.result).toBeCloseTo(0);
    expect(twr(r.points)).toBeCloseTo(0);
  });
  it("pontos diários ficam no fechamento do dia (23:59:59 UTC), com rótulo no dia certo", () => {
    const r = replay({ startT: T0, endT: T0 + 2 * 86400e3, equity0: 1000, size0: 0, px0: 100, closeAt: () => 100, pxEnd: 100, events: [] });
    expect(new Date(r.points[1]!.ts * 1000).toISOString()).toBe("2026-11-06T23:59:59.999Z");
  });
});
