/**
 * Testes de regressão da Estratégia BTC/USDC (app inteiro: armazenamento → motor → números das telas).
 * Fixam o comportamento da versão 4 (commit 7339ebf) antes do Terminal 5.0. Se algum valor mudar,
 * a mudança precisa ser intencional e documentada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TZ = "America/Sao_Paulo";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const NOW = Date.UTC(2026, 10, 6, 19, 48); // 06/11/2026 16:48 em São Paulo (capturas do app)
const START = Date.UTC(2026, 10, 6, 0, 13); // 05/11/2026 21:13 em São Paulo
const PX_NOW = 75798.08;

/** Ciclo real do usuário (valores das capturas; taxas aproximadas para fechar o patrimônio). */
const userState = () => ({
  v: 3, initial: { date: "2026-11-05", usdc: "8006" },
  flows: [{ id: "f1", date: "2026-11-06T16:22", kind: "IN", amount: "5103.58", note: "lançamento manual" }],
  cycles: [{
    id: "c1", openedAt: "2026-11-05T21:13", entryPx: String(36318 / 0.47692712), leverage: "6", capital: "6053", feesOpen: "15", platform: "Hyperliquid",
    adds: [
      { id: "a1", at: "2026-11-06T16:24", px: String(10534.98 / 0.1393092), capital: String(10534.98 / 6), leverage: "6", fees: "11.29" },
      { id: "a2", at: "2026-11-06T16:25", px: String(12096.96 / 0.15919985), capital: String(12096.96 / 6), leverage: "6", fees: "12.28" },
    ],
  }],
  updatedAt: new Date(NOW).toISOString(), view: "active",
  settings: { defaultLeverage: "1.5", maintenanceRate: "0.0125", minLiqDistance: "0.2" },
  strategies: [{
    id: "s-1", name: "Estratégia BTC ↔ USDC", tz: "America/Sao_Paulo", status: "active", createdAt: START, startAt: START, accounts: [{ kind: "manual" }],
    snapshot: { at: START, source: "manual", equityUsd: "8006", btcUsd: "76150", balances: [], positions: [], note: "" },
  }],
});

const priceCache = () => {
  const day = 86400;
  const usd = [] as { t: number; o: number; h: number; l: number; c: number; v: number }[];
  for (let t = Date.UTC(2025, 8, 1) / 1000; t <= NOW / 1000; t += day) usd.push({ t, o: 76000, h: 77000, l: 75000, c: 76090, v: 1 });
  usd[usd.length - 1]!.c = PX_NOW;
  return { usd, brl: usd.map((k) => ({ t: k.t, c: k.c * 5.42 })), source: "teste", fetchedAt: NOW,
    spot: { btcUsd: PX_NOW, btcBrl: PX_NOW * 5.42, usdBrl: 5.42, at: NOW, source: "teste", fxSource: "teste", stale: false } };
};

let ls: MemStorage;
async function boot(state: unknown = userState()) {
  ls = new MemStorage();
  ls.setItem("bst.local.v2", JSON.stringify(state));
  ls.setItem("bst.prices.v1", JSON.stringify(priceCache()));
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
  vi.resetModules();
  const store = await import("../src/lib/local/store");
  const engine = await import("../src/lib/local/engine");
  return { store, engine };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("regressão: ciclo de 05/11/2026 21:13 (app inteiro)", () => {
  it("números da tela principal", async () => {
    const { engine } = await boot();
    const s = engine.compute();
    expect(s.scope.kind).toBe("strategy");
    expect(s.equity.toNumber()).toBeCloseTo(12897.65, 0);
    expect(s.contrib).toBeCloseTo(13109.58, 2);
    expect(s.result).toBeCloseTo(-211.93, 0);
    expect(s.roc!).toBeCloseTo(-0.01617, 4);
    expect(s.twr!).toBeCloseTo(-0.0182601183, 6);
    expect(s.fees).toBeCloseTo(38.57, 2);
    expect(s.funding).toBe(0);
    expect(s.state).toBe("BTC");
  });
  it("posição: tamanho, preço médio, alavancagem, liquidação, tempo", async () => {
    const { engine } = await boot();
    const c = engine.compute().current!;
    expect(c.sizeBtc.toNumber()).toBeCloseTo(0.775436, 6);
    expect(c.officialEntry).toBeCloseTo(76021.65, 0);
    expect(c.effLeverage!).toBeCloseTo(4.56, 2);
    expect(c.liq!.toNumber()).toBeGreaterThan(60000);
    expect(c.liq!.toNumber()).toBeLessThan(PX_NOW);
    expect(c.heldMs).toBe(NOW - START);
    expect(c.pnlPct!.toNumber()).toBeCloseTo(-0.01617, 3);
  });
  it("só eventos do ciclo: nada antes do início entra", async () => {
    const st = userState();
    st.flows.push({ id: "old", date: "2026-11-01T10:00", kind: "IN", amount: "99999", note: "antes do ciclo" });
    const { engine } = await boot(st);
    const s = engine.compute();
    expect(s.contrib).toBeCloseTo(13109.58, 2);
    expect(s.events.some((e) => e.key === "m|old")).toBe(false);
  });
  it("série começa no início do ciclo e o percentual de 24 h é parcial", async () => {
    const { engine } = await boot();
    const s = engine.compute();
    expect(s.points[0]!.ts * 1000).toBe(START);
    expect(s.dayPartial).toBe(true);
  });
  it("Buy & Hold usa o patrimônio inicial e o aporte", async () => {
    const { engine } = await boot();
    const s = engine.compute();
    // 8.006 / 76.150 + 5.103,58 / último fechamento disponível (sem execução futura: 75.622,6)
    const units = 8006 / 76150 + 5103.58 / 76090;
    expect(s.hodl!).toBeCloseTo(units * PX_NOW, 0);
  });
});

describe("regressão: dados e backup", () => {
  it("abrir o app não altera os dados salvos (v3 fica intacto)", async () => {
    const st = userState();
    const { store } = await boot(st);
    store.getStore();
    expect(JSON.parse(ls.getItem("bst.local.v2")!)).toEqual(st);
  });
  it("migra a versão 1 sem perder aportes e posições, guardando a original", async () => {
    ls = new MemStorage();
    const v1 = { initial: { date: "2026-01-02", btc: "0", cash: "1000", value: "1000", cur: "USD", usdBrl: "5" }, ops: [{ id: "d1", type: "DEPOSIT", date: "2026-02-01", total: "500", cur: "USD", usdBrl: "5" }], positions: [] };
    ls.setItem("bst.local.v1", JSON.stringify(v1));
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
    vi.resetModules();
    const store = await import("../src/lib/local/store");
    const s = store.getStore();
    expect(s.initial?.usdc).toBe("1000.00");
    expect(s.flows).toHaveLength(1);
    expect(ls.getItem("bst.local.v1")).toBe(JSON.stringify(v1));
  });
  it("backup exportado e restaurado devolve exatamente os mesmos dados", async () => {
    const { store } = await boot();
    const before = structuredClone(store.getStore());
    const text = store.exportBackup();
    store.resetStore();
    expect(store.getStore().cycles).toHaveLength(0);
    await store.importBackup(text);
    const after = store.getStore();
    expect(after.cycles).toEqual(before.cycles);
    expect(after.flows).toEqual(before.flows);
    expect(after.strategies).toEqual(before.strategies);
  });
  it("apagar tudo e restaurar fazem cópia automática antes", async () => {
    const { store } = await boot();
    store.resetStore();
    const list = store.listAutoBackups();
    expect(list[0]!.reason).toBe("antes de apagar tudo");
    expect(JSON.parse(list[0]!.data).cycles).toHaveLength(1);
    store.restoreAutoBackup(list[0]!.at);
    expect(store.getStore().cycles).toHaveLength(1);
  });
  it("backup inválido não altera nada", async () => {
    const { store } = await boot();
    const before = ls.getItem("bst.local.v2");
    await expect(store.importBackup("{ isto não é json")).rejects.toThrow();
    await expect(store.importBackup(JSON.stringify({ data: { v: 3, cycles: [{ id: "x" }], flows: [] } }))).rejects.toThrow();
    expect(ls.getItem("bst.local.v2")).toBe(before);
  });
});
