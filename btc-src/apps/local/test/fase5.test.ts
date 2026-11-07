/** Fase 5 com o ciclo real: Risk Center, contexto e disparo dos alertas, desempenho separado. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TZ = "America/Sao_Paulo";
class MemStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } key() { return null; } get length() { return this.m.size; } }
const NOW = Date.UTC(2026, 10, 6, 19, 48), START = Date.UTC(2026, 10, 6, 0, 13), PX = 75798.08;
const state = {
  v: 3, initial: { date: "2026-11-05", usdc: "8006" }, view: "active", updatedAt: "", settings: { defaultLeverage: "1.5", maintenanceRate: "0.0125", minLiqDistance: "0.2" },
  flows: [{ id: "f1", date: "2026-11-06T16:22", kind: "IN", amount: "5103.58" }],
  cycles: [{ id: "c1", openedAt: "2026-11-05T21:13", entryPx: String(36318 / 0.47692712), leverage: "6", capital: "6053", feesOpen: "15",
    adds: [{ id: "a1", at: "2026-11-06T16:24", px: String(10534.98 / 0.1393092), capital: String(10534.98 / 6), leverage: "6", fees: "11.29" }, { id: "a2", at: "2026-11-06T16:25", px: String(12096.96 / 0.15919985), capital: String(12096.96 / 6), leverage: "6", fees: "12.28" }] }],
  strategies: [{ id: "s1", name: "Estratégia", tz: "America/Sao_Paulo", status: "active", createdAt: START, startAt: START, accounts: [{ kind: "manual" }], snapshot: { at: START, source: "manual", equityUsd: "8006", btcUsd: "76150", balances: [], positions: [] } }],
};
async function boot() {
  const ls = new MemStorage();
  ls.setItem("bst.local.v2", JSON.stringify(state));
  const usd = [] as { t: number; o: number; h: number; l: number; c: number; v: number }[];
  for (let t = Date.UTC(2025, 8, 1) / 1000; t <= NOW / 1000; t += 86400) usd.push({ t, o: 76000, h: 77000, l: 75000, c: 76090, v: 1 });
  usd[usd.length - 1]!.c = PX;
  ls.setItem("bst.prices.v1", JSON.stringify({ usd, brl: usd.map((k) => ({ t: k.t, c: k.c * 5.42 })), source: "t", fetchedAt: NOW, spot: { btcUsd: PX, btcBrl: PX * 5.42, usdBrl: 5.42, at: NOW, source: "t", fxSource: "t", stale: false } }));
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
  vi.resetModules();
  return { views: await import("../src/lib/intel/views"), al: await import("../src/lib/alerts") };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("Risk Center com o ciclo real", () => {
  it("exposição, liquidação e −20% liquida a posição", async () => {
    const { views } = await boot();
    const r = views.riskView();
    expect(r.positions).toHaveLength(1);
    expect(r.exposure.btcSynthetic).toBeCloseTo(0.775436, 6);
    expect(r.exposure.effLeverage!).toBeCloseTo(4.56, 2);
    expect(r.exposure.minLiqDistance!).toBeGreaterThan(0.14);
    expect(r.exposure.minLiqDistance!).toBeLessThan(0.17);
    expect(r.shocks.find((x) => x.shock === -0.2)!.liquidated).toHaveLength(1);
    expect(r.shocks.find((x) => x.shock === -0.1)!.liquidated).toHaveLength(0);
  });
  it("desempenho separado: Estratégia com TWR e sem Sharpe (amostra curta)", async () => {
    const { views } = await boot();
    const p = views.performanceView();
    expect(p.strat!.twr!).toBeCloseTo(-0.0292, 3);
    expect(p.sStats.sharpe).toBeNull();
    expect(p.cycles).toHaveLength(1);
  });
});

describe("alertas", () => {
  it("dispara uma vez na transição e respeita o intervalo; contexto vem dos dados reais", async () => {
    const { views, al } = await boot();
    const ctx = views.alertContext();
    expect(ctx.leverage!).toBeCloseTo(4.56, 2);
    al.addRule("LEVERAGE_ABOVE", 3, 60);
    al.addRule("LIQ_DISTANCE_BELOW", 0.2, 60);
    al.addRule("PRICE_ABOVE", 100_000, 60);
    const fired: string[] = [];
    al.evaluateAlerts(ctx, (m) => fired.push(m));
    expect(fired).toHaveLength(2);
    vi.setSystemTime(NOW + 60e3);
    al.evaluateAlerts({ ...ctx, now: ctx.now + 60 }, (m) => fired.push(m));
    expect(fired).toHaveLength(2); // condição continua verdadeira: não repete
    expect(al.alerts().log).toHaveLength(2);
  });
});
