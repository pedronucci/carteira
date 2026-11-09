import { describe, expect, it } from "vitest";
import { assetChanges, btcReturn, evolution, migrateSnapshots, nextSnapshots, snapValue, type PSnapshot } from "../src";

const H = 3600e3, D = 86400e3;
const snap = (t: number, total: number, extra: Partial<PSnapshot> = {}): PSnapshot => ({ t, byAccount: { a: total }, ...extra });

describe("migrateSnapshots", () => {
  it("migra v1 → v2 sem perder valores e remove duplicatas da mesma hora", () => {
    const m = migrateSnapshots([snap(10 * H + 5, 100), snap(10 * H + 900, 101), snap(11 * H, 102)]);
    expect(m.map((s) => s.total)).toEqual([101, 102]);
    expect(m.every((s) => s.v === 2)).toBe(true);
  });
  it("descarta retratos inválidos (NaN, sem contas) mas preserva os bons", () => {
    const m = migrateSnapshots([snap(H, NaN), { t: 2 * H, byAccount: {} }, snap(3 * H, 50)]);
    expect(m).toHaveLength(1);
    expect(m[0]!.total).toBe(50);
  });
  it("é idempotente", () => {
    const a = migrateSnapshots([snap(H, 1), snap(2 * H, 2)]);
    expect(migrateSnapshots(a)).toEqual(a);
  });
});

describe("nextSnapshots", () => {
  it("não duplica na mesma hora; force substitui", () => {
    const l = [snap(10 * H, 100)];
    expect(nextSnapshots(l, snap(10 * H + 60e3, 105))).toBe(l);
    expect(nextSnapshots(l, snap(10 * H + 60e3, 105), true).map((s) => s.byAccount.a)).toEqual([105]);
    expect(nextSnapshots(l, snap(11 * H, 110))).toHaveLength(2);
  });
  it("limita o tamanho", () => {
    const l = Array.from({ length: 5 }, (_, i) => snap((i + 1) * H, i));
    expect(nextSnapshots(l, snap(9 * H, 9), false, H, 5)).toHaveLength(5);
  });
});

describe("evolution", () => {
  const now = 100 * D;
  it("histórico incompleto: poucos retratos → incomplete e sem rentabilidade", () => {
    const r = evolution([snap(now - H, 100)], [], "30", "USD", now);
    expect(r.incomplete).toBe(true); expect(r.twr).toBeNull(); expect(r.resultUsd).toBeNull();
  });
  it("janela maior que o histórico: mostra o que existe e sinaliza", () => {
    const r = evolution([snap(now - 2 * D, 100), snap(now, 110)], [], "30", "USD", now);
    expect(r.incomplete).toBe(true); expect(r.availableFrom).toBe(now - 2 * D); expect(r.rawChangeUsd).toBe(10);
  });
  it("aporte não vira lucro: variação bruta ≠ resultado", () => {
    const s = [snap(now - 10 * D, 1000), snap(now, 1600)];
    const r = evolution(s, [{ t: now - 5 * D, accountId: "a", usd: 500 }], "7", "USD", now);
    expect(r.rawChangeUsd).toBe(600); expect(r.flowsUsd).toBe(500); expect(r.resultUsd).toBeCloseTo(100, 6);
  });
  it("usa o retrato anterior à janela como âncora", () => {
    const s = [snap(now - 40 * D, 100), snap(now - 20 * D, 120), snap(now, 150)];
    const r = evolution(s, [], "30", "USD", now);
    expect(r.fromT).toBe(now - 40 * D); expect(r.incomplete).toBe(false);
  });
  it("BTC e BRL: usa o preço do retrato; sem ele, referência marcada como aproximada", () => {
    const s = [snap(now - 10 * D, 1000, { btcUsd: 50000, usdBrl: 5 }), snap(now, 2000)];
    const r = evolution(s, [], "30", "BTC", now, { btcUsd: 100000 });
    expect(r.points[0]!.value).toBeCloseTo(0.02); expect(r.points[1]!.value).toBeCloseTo(0.02); expect(r.approx).toBe(true);
    expect(snapValue(s[1]!, "BRL", {}).v).toBeNull();
  });
  it("série de P&L de perpétuos só onde existe", () => {
    const s = [snap(now - 2 * D, 100), snap(now, 110, { perps: { upnl: 7, notional: 500, margin: 50, count: 1, positions: [] } })];
    const r = evolution(s, [], "all", "USD", now);
    expect(r.points.map((p) => p.perpsUpnl)).toEqual([null, 7]);
  });
});

describe("assetChanges / btcReturn", () => {
  it("compara só retratos com ativos; v1 não entra", () => {
    const s = [snap(1 * D, 100), snap(2 * D, 120, { byAsset: { BTC: 80, USDC: 40 } }), snap(3 * D, 150, { byAsset: { BTC: 100, HYPE: 50 } })];
    const r = assetChanges(s, "all", 4 * D);
    expect(r.available).toBe(true);
    expect(r.rows.find((x) => x.key === "BTC")).toMatchObject({ changeUsd: 20, changePct: 0.25 });
    expect(r.rows.find((x) => x.key === "HYPE")!.changePct).toBeNull();
    expect(assetChanges([snap(D, 1)], "all", 2 * D).available).toBe(false);
  });
  it("retorno do BTC vem dos preços gravados", () => {
    const s = [snap(1, 1, { btcUsd: 100 }), snap(2, 1, { btcUsd: 125 })];
    expect(btcReturn(s, 1, 2)).toBeCloseTo(0.25); expect(btcReturn(s, 1, null)).toBeNull();
  });
});
