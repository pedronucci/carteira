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
  // IndexedDB simulado pelo setup; testes aguardam confirmação de gravação.
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
    await store.importBackup(text);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.portfolio().manual).toHaveLength(1);
  });
});


describe("regressões contábeis e persistência da auditoria", () => {
  it("reduzir saldo conserva o sinal negativo do ajuste", async () => {
    const { pe, db } = await boot();
    await pe.saveManualHolding({ institution: "X", name: "", symbol: "BTC", qty: "1" });
    await pe.saveManualHolding({ institution: "X", name: "", symbol: "BTC", qty: "0.5" });
    expect(db.portfolio().events.at(-1)!.usd).toBe(-50000);
    expect(pe.portfolioView().flows.at(-1)!.usd).toBe(-50000);
  });
  it("transferência interna conserva a saída por conta para neutralizar a variação do saldo", async () => {
    const { pe, db } = await boot();
    await db.updatePortfolio(d => { d.events.push({ id: "out", accountId: "a", t: 1, kind: "withdraw", econ: "USDC", qty: 100, usd: 100 }); });
    await pe.resolvePending("out", "internal");
    expect(pe.portfolioView().flows).toEqual([{t:1,accountId:"a",usd:-100}]);
  });
  it("backup inválido em outra seção não altera a estratégia", async () => {
    const { store } = await boot();
    const before = structuredClone(store.getStore());
    const backup = JSON.parse(store.exportBackup());
    backup.portfolio.manual = [{ qty: "Infinity", accountId: "inexistente" }];
    await expect(store.importBackup(JSON.stringify(backup))).rejects.toThrow();
    expect(store.getStore()).toEqual(before);
  });
  it("falha do IndexedDB rejeita gravação, informa erro e permite nova tentativa", async () => {
    const { db } = await boot();
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
    try { await expect(db.updatePortfolio(d => { d.manualPrices.BTC = 123; })).rejects.toThrow(); }
    finally { globalThis.indexedDB = original; }
    expect(db.portfolioError()).toMatch(/salvar/);
    expect(db.portfolio().manualPrices.BTC).toBeUndefined();
    await db.updatePortfolio(d => { d.manualPrices.BTC = 456; });
    expect(db.portfolioError()).toBeNull(); expect(db.portfolio().manualPrices.BTC).toBe(456);
  });
  it("CSV com aspas preserva separadores e rejeita infinito/custo inválido", async () => {
    const { pe } = await boot();
    expect(pe.parseHoldingsCsv('ativo,quantidade,instituicao\nBTC,0.25,"Conta, principal"').rows[0]!.institution).toBe("Conta, principal");
    expect(pe.parseHoldingsCsv("ativo;quantidade\nBTC;Infinity").errors).toHaveLength(1);
    expect(pe.parseHoldingsCsv("ativo;quantidade;custo\nBTC;1;abc").errors).toHaveLength(1);
  });
});


it("recupera restauração interrompida usando diário persistente", async () => {
  const { pe, db, store } = await boot();
  await pe.saveManualHolding({ institution: "Original", name: "", symbol: "BTC", qty: "1" });
  const original = { data: structuredClone(store.getStore()), portfolio: db.exportPortfolio(), extra: null };
  localStorage.setItem("bst.restore.pending.v1", JSON.stringify(original));
  await db.updatePortfolio(d => { d.manual = []; });
  expect(await store.recoverInterruptedRestore()).toBe(true);
  expect(db.portfolio().manual[0]!.qty).toBe("1");
  expect(localStorage.getItem("bst.restore.pending.v1")).toBeNull();
});

describe("backup LP compatível e recuperável",()=>{
 it("inclui o cache LP no backup e restaura sem apagar dados antigos silenciosamente",async()=>{
  const {store}=await boot();const lp=await import("../src/lib/liquidity/state"),cache=await import("../src/lib/liquidity/store");await lp.initializeLP();const data={...cache.emptyLPData(),marketFacts:{publicPool:{at:123,tvl:100,volume:20,apy:4}}};await lp.importLPData(data);const backup=store.exportBackup();expect(JSON.parse(backup).liquidity.marketFacts.publicPool.tvl).toBe(100);await lp.importLPData(cache.emptyLPData());await store.importBackup(backup);expect(lp.lpData()).toEqual(data);const old=JSON.parse(backup);delete old.liquidity;await store.importBackup(JSON.stringify(old));expect(lp.lpData()).toEqual(data);
 });
 it("recusa LP incompatível antes de alterar o portfólio ou o cache existente",async()=>{
  const {store,db}=await boot();const lp=await import("../src/lib/liquidity/state");await lp.initializeLP();const before=structuredClone(lp.lpData()),pf=db.exportPortfolio(),bad=JSON.parse(store.exportBackup());bad.liquidity={schema:99};await expect(store.importBackup(JSON.stringify(bad))).rejects.toThrow(/incompatível/);expect(lp.lpData()).toEqual(before);expect(db.exportPortfolio()).toEqual(pf);
 });
});

describe("LP no patrimônio sem lucro artificial",()=>{
 it("substitui recibo, preserva saldo livre e não usa a descoberta como ganho histórico",async()=>{
  const {db,pe}=await boot();const lp=await import("../src/lib/liquidity/state");await lp.initializeLP();const now=Date.now();await db.updatePortfolio(d=>{d.accounts.push({id:"wallet",kind:"evm",name:"Carteira",institution:"EVM",config:{address:"0x"+"1".repeat(40)},createdAt:0});d.synced.push({accountId:"wallet",assetKey:"receipt",econ:"receipt",symbol:"LP",network:"Ethereum",qty:"1",valueUsd:200,kind:"spot",source:"sync",at:now},{accountId:"wallet",assetKey:"free",econ:"USDC",symbol:"USDC",network:"Ethereum",qty:"50",valueUsd:50,kind:"spot",source:"sync",at:now});d.snapshots.push({t:now-10000,src:"accounts-v1",total:50,byAccount:{wallet:50},quality:"complete"});});
  lp.setLPPositions([{id:"eip155:1:pool:1",accountId:"wallet",owner:"0x"+"1".repeat(40),chainId:1,network:"Ethereum",protocol:"Uniswap V2",pool:"pool",positionId:"pool",block:"0x64",at:now,tokens:[{address:"a",symbol:"A",decimals:6,qty:"100",priceUsd:1},{address:"b",symbol:"B",decimals:6,qty:"100",priceUsd:1}],owedRaw:["0","0"],valueUsd:200,liquidity:"100",tick:0,lowerTick:0,upperTick:0,lower:0,upper:0,price:1,feeTier:.3,status:"IN RANGE",historyComplete:false,receiptAssetKey:"receipt"}]);
  const v=pe.portfolioView();expect(v.c.totalUsd).toBe(250);expect(v.holdings.some(h=>h.assetKey==="receipt")).toBe(false);expect(v.holdings.some(h=>h.assetKey==="free")).toBe(true);expect(v.snapshotSource).toBe("accounts-lp-v2");expect(v.snapshots).toHaveLength(0);expect(db.portfolio().snapshots[0]!.total).toBe(50);expect(v.quality).toBe("partial");expect(pe.buildSnapshot(v).src).toBe("accounts-lp-v2");
 });
});
