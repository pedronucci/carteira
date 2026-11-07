import { describe, expect, it } from "vitest";
import { baseOf, concentration, dailyStats, evaluateCondition, exposure, journalResult, journalStats, shockScenarios, xirr, type JournalEntry, type RiskPosition } from "../src";

const PX = 75_798.08;
// a posição real do ciclo: long 0,775436 BTC, preço médio 76.021,65, liquidação 64.203,66; patrimônio 12.897,65
const pos: RiskPosition = { instrument: "BTC-PERP", dir: "LONG", size: 0.775436, mark: PX, entry: 76_021.65, liq: 64_203.66, accountId: "strategy", notional: 0.775436 * PX };

describe("exposição", () => {
  it("bruta, líquida, sintética e alavancagem efetiva", () => {
    const e = exposure([pos, { ...pos, instrument: "BTC-USDT-SWAP", dir: "SHORT", size: 0.1, notional: 0.1 * PX, liq: 90_000 }], 0.42, PX, 12_897.65 + 50_000);
    expect(e.btcSynthetic).toBeCloseTo(0.675436, 6);
    expect(e.btcNet).toBeCloseTo(0.42 + 0.675436, 6);
    expect(e.grossUsd).toBeCloseTo(0.875436 * PX, 2);
    expect(e.netUsd).toBeCloseTo(0.675436 * PX, 2);
    expect(e.minLiqDistance).toBeCloseTo((PX - 64_203.66) / PX, 6);
  });
  it("ativo-base do instrumento", () => { expect(baseOf("BTC-USDT-SWAP")).toBe("BTC"); expect(baseOf("UBTC/USDC")).toBe("BTC"); expect(baseOf("ETH-PERP")).toBe("ETH"); });
});

describe("cenários de choque do BTC", () => {
  const rows = shockScenarios({ btcPx: PX, spotBtc: 0, totalUsd: 12_897.65, positions: [pos] });
  it("−10%: o long perde 0,775436 × 7.579,81", () => {
    const r = rows.find((x) => x.shock === -0.1)!;
    expect(r.derivUsd).toBeCloseTo(-0.775436 * PX * 0.1, 2);
    expect(r.liquidated).toEqual([]);
  });
  it("−20% cruza a liquidação (64.203,66): perda limitada até o preço de liquidação e posição marcada", () => {
    const r = rows.find((x) => x.shock === -0.2)!;
    expect(r.liquidated).toEqual(["BTC-PERP (LONG)"]);
    expect(r.derivUsd).toBeCloseTo(0.775436 * (64_203.66 - PX), 2);
  });
  it("−15% fica perto da liquidação; +20% soma ganho e o BTC equivalente cai por causa do preço maior", () => {
    expect(rows.find((x) => x.shock === -0.15)!.nearLiq).toEqual(["BTC-PERP (LONG)"]);
    const up = rows.find((x) => x.shock === 0.2)!;
    expect(up.totalUsd).toBeCloseTo(12_897.65 + 0.775436 * PX * 0.2, 2);
    expect(up.btcEquivalent).toBeCloseTo(up.totalUsd / (PX * 1.2), 6);
  });
  it("spot em BTC varia com o preço; derivativos de outros ativos ficam fora do choque do BTC", () => {
    const r = shockScenarios({ btcPx: 100_000, spotBtc: 1, totalUsd: 100_000, positions: [{ ...pos, instrument: "ETH-PERP", size: 10, mark: 4_000, liq: null }] }, [-0.1])[0]!;
    expect(r.spotUsd).toBeCloseTo(-10_000);
    expect(r.derivUsd).toBe(0);
  });
});

describe("estatísticas só com amostra suficiente", () => {
  const day = 86_400e3;
  it("poucos dias: volatilidade e Sharpe ficam vazios", () => {
    const s = dailyStats([{ t: 0, index: 1 }, { t: day, index: 1.01 }, { t: 2 * day, index: 0.99 }]);
    expect(s.volAnnual).toBeNull();
    expect(s.sharpe).toBeNull();
  });
  it("com 40 dias: volatilidade anualizada = desvio diário × √365", () => {
    const pts = Array.from({ length: 41 }, (_, i) => ({ t: i * day, index: Math.pow(1.01, Math.ceil(i / 2)) * Math.pow(0.995, Math.floor(i / 2)) }));
    const s = dailyStats(pts);
    expect(s.days).toBe(40);
    expect(s.volAnnual).toBeGreaterThan(0);
    expect(s.sharpe).not.toBeNull();
  });
});

describe("TIR (retorno ponderado pelo dinheiro)", () => {
  it("1.000 investidos viram 1.100 em 1 ano = 10% a.a.", () => {
    expect(xirr([{ t: 0, amount: -1000 }, { t: 365 * 86_400e3, amount: 1100 }])!).toBeCloseTo(0.1, 6);
  });
  it("sem troca de sinal: indefinida", () => { expect(xirr([{ t: 0, amount: -1 }, { t: 1, amount: -2 }])).toBeNull(); });
});

describe("concentração", () => {
  it("maior participação e Herfindahl", () => { const c = concentration([0.5, 0.3, 0.2]); expect(c.top).toBe(0.5); expect(c.hhi!).toBeCloseTo(0.38, 10); });
});

describe("diário de operações", () => {
  const e = (p: Partial<JournalEntry>): JournalEntry => ({ id: "x", asset: "BTC", strategy: "BTC/USDC", date: "2026-11-05", dir: "LONG", entry: 100, exit: null, stop: 90, targets: [], rationale: "", notes: "", createdAt: 0, ...p });
  it("resultado em % e em R; short com sinal invertido", () => {
    const a = journalResult(e({ exit: 120 })), b = journalResult(e({ dir: "SHORT", entry: 100, exit: 90, stop: 105 }));
    expect(a.pct!).toBeCloseTo(0.2, 10); expect(a.r!).toBeCloseTo(2, 10);
    expect(b.pct!).toBeCloseTo(0.1, 10); expect(b.r!).toBeCloseTo(2, 10);
    expect(journalResult(e({}))).toMatchObject({ closed: false });
  });
  it("estatísticas: acertos, R médio, fator de lucro", () => {
    const s = journalStats([e({ exit: 120 }), e({ exit: 95 }), e({})]);
    expect(s).toMatchObject({ total: 3, closed: 2, open: 1, winRate: 0.5 });
    expect(s.avgR).toBeCloseTo((2 - 0.5) / 2);
    expect(s.profitFactor).toBeCloseTo(0.2 / 0.05);
  });
});

describe("alertas novos", () => {
  const rule = (type: Parameters<typeof evaluateCondition>[0]["type"], threshold: number) => ({ id: "r", type, threshold, cooldownSec: 0, enabled: true });
  it("funding, exposição, divergência e BTC equivalente", () => {
    expect(evaluateCondition(rule("FUNDING_CHANGE", 0.0001), { now: 0, funding: 0.00025, fundingRef: 0.0001 }).ok).toBe(true);
    expect(evaluateCondition(rule("EXPOSURE_CHANGE", 0.1), { now: 0, btcNet: 0.7, btcNetRef: 0.775 }).ok).toBe(false);
    expect(evaluateCondition(rule("DIVERGENCE_ABOVE", 5), { now: 0, divergenceUsd: 12 }).ok).toBe(true);
    expect(evaluateCondition(rule("BTC_EQUIV_CHANGE", 0.05), { now: 0, btcEquivChange: -0.06 }).ok).toBe(true);
    expect(evaluateCondition(rule("FUNDING_CHANGE", 0.0001), { now: 0 }).ok).toBeNull();
  });
});
