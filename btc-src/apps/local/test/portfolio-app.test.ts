/** Portfólio no app: CSV, cadastro manual (ajuste, não lucro), conta da Estratégia e backup v4. */
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const PX = 100_000;
async function boot() {
  const ls = new MemStorage();
  ls.setItem("bst.prices.v1", JSON.stringify({ usd: [], brl: [], source: "t", fetchedAt: 0, spot: { btcUsd: PX, btcBrl: PX * 5, usdBrl: 5, at: Date.now(), source: "t", fxSource: "t", stale: false } }));
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
  vi.resetModules();
  // sem IndexedDB no Node: o portfólio fica em memória e o erro de gravação é registrado (não quebra)
  const db = await import("../src/lib/portfolio/db");
  const pe = await import("../src/lib/portfolio/engine");
  const store = await import("../src/lib/local/store");
  return { db, pe, store };
}
beforeEach(() => { vi.restoreAllMocks(); });

describe("CSV de saldos", () => {
  it("lê ; e vírgula decimal brasileira, com colunas em qualquer ordem", async () => {
    const { pe } = await boot();
    const r = pe.parseHoldingsCsv("ativo;quantidade;instituicao;custo_usd\nBTC;0,25;Ledger;15.000\nETH;1.234,5;Binance;");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      expect.objectContaining({ symbol: "BTC", qty: "0.25", institution: "Ledger", costUsd: "15000" }),
      expect.objectContaining({ symbol: "ETH", qty: "1234.5", institution: "Binance", costUsd: undefined }),
    ]);
  });
  it("aponta linhas inválidas e exige as colunas obrigatórias", async () => {
    const { pe } = await boot();
    expect(pe.parseHoldingsCsv("nome;valor\nx;1").errors[0]).toMatch(/obrigatórias/);
    const r = pe.parseHoldingsCsv("ativo,quantidade\nBTC,abc\nSOL,3");
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Linha 2/);
  });
});

describe("cadastro manual", () => {
  it("cadastrar um saldo gera ajuste (não lucro) e entra no total", async () => {
    const { pe, db } = await boot();
    await pe.saveManualHolding({ institution: "Ledger", name: "Bitcoin", symbol: "btc", qty: "0.5" });
    const v = pe.portfolioView();
    expect(v.c.totalUsd).toBeCloseTo(50_000);
    expect(v.c.btcHeld.total).toBeCloseTo(0.5);
    const adj = db.portfolio().events.filter((e) => e.kind === "adjust");
    expect(adj).toHaveLength(1);
    expect(adj[0]!.usd).toBeCloseTo(50_000);
    expect(v.classified.find((e) => e.kind === "adjust")!.cls).toBe("internal");
  });
  it("mesma instituição reaproveita a conta; alterar a quantidade substitui o saldo", async () => {
    const { pe, db } = await boot();
    await pe.saveManualHolding({ institution: "Ledger", name: "", symbol: "BTC", qty: "0.5" });
    await pe.saveManualHolding({ institution: "ledger", name: "", symbol: "BTC", qty: "0.7" });
    expect(db.portfolio().accounts).toHaveLength(1);
    expect(db.portfolio().manual).toHaveLength(1);
    expect(pe.portfolioView().c.btcHeld.total).toBeCloseTo(0.7);
  });
  it("ativo sem cotação fica sem preço (fora do total), não vale zero em silêncio", async () => {
    const { pe } = await boot();
    await pe.saveManualHolding({ institution: "X", name: "", symbol: "FOO", qty: "10" });
    const v = pe.portfolioView();
    expect(v.c.totalUsd).toBe(0);
    expect(v.c.unpriced).toHaveLength(1);
  });
});

describe("backup v4", () => {
  it("leva a Estratégia e o Portfólio juntos e restaura os dois", async () => {
    const { pe, db, store } = await boot();
    await pe.saveManualHolding({ institution: "Ledger", name: "", symbol: "BTC", qty: "1" });
    const text = store.exportBackup();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(4);
    expect(parsed.portfolio.manual).toHaveLength(1);
    await db.updatePortfolio((d) => { d.manual = []; d.accounts = []; });
    store.importBackup(text);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.portfolio().manual).toHaveLength(1);
  });
});
