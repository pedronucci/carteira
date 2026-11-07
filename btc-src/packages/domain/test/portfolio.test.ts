/** Motor de consolidação: sem contagem dupla, identidade de ativos, transferências internas e rentabilidade. */
import { describe, expect, it } from "vitest";
import { classifyFlows, consolidate, evmEcon, exchangeEcon, portfolioReturns, returnSince, type PAccount, type PEvent, type PHolding } from "../src";

const T = Date.UTC(2026, 10, 7, 12);
const acct = (id: string, kind: PAccount["kind"], institution: string, addresses?: string[]): PAccount => ({ id, kind, name: institution, institution, addresses, createdAt: T });
const hold = (p: Partial<PHolding> & Pick<PHolding, "accountId" | "assetKey" | "econ" | "qty">): PHolding => ({ symbol: p.econ, network: "x", kind: "spot", source: "sync", at: T, ...p });
const prices = { BTC: { usd: 100_000 }, USDC: { usd: 1 }, SOL: { usd: 200 }, ETH: { usd: 4_000 } };

describe("consolidação sem contagem dupla", () => {
  const accounts = [acct("okx-f", "okx", "OKX"), acct("okx-t", "okx", "OKX"), acct("hl", "hyperliquid", "Hyperliquid"), acct("rabby", "evm", "Rabby"), acct("btc", "bitcoin", "Carteira Bitcoin")];
  it("BTC em várias instituições soma a quantidade real e mostra a distribuição", () => {
    const c = consolidate(accounts, [
      hold({ accountId: "okx-f", assetKey: "okx:BTC", econ: "BTC", qty: "0.5" }),
      hold({ accountId: "btc", assetKey: "bitcoin:native", econ: "BTC", qty: "1.2" }),
      hold({ accountId: "rabby", assetKey: "evm:42161:0xcbb7", econ: "BTC", symbol: "cbBTC", qty: "0.3", wrapped: true }),
    ], prices);
    expect(c.btcHeld.total).toBeCloseTo(2.0);
    expect(c.assets.find((a) => a.econ === "BTC")!.valueUsd).toBeCloseTo(200_000);
    expect(c.btcHeld.byInstitution.map((x) => x.key)).toEqual(["Carteira Bitcoin", "OKX", "Rabby"]);
  });
  it("conta com derivativos entra pelo patrimônio líquido; nocional e posições não somam", () => {
    const c = consolidate(accounts, [
      // equity da Hyperliquid já inclui margem e P&L aberto de um long de 0,6 BTC (nocional 60 mil)
      hold({ accountId: "hl", assetKey: "hl:perp-equity", econ: "USDC", qty: "12897.65", valueUsd: 12_897.65, kind: "equity" }),
    ], prices);
    expect(c.totalUsd).toBeCloseTo(12_897.65);
    expect(c.btcHeld.total).toBe(0); // perpétuo não é posse de BTC
  });
  it("a mesma leitura repetida não duplica o saldo", () => {
    const h = hold({ accountId: "okx-f", assetKey: "okx:USDC", econ: "USDC", qty: "1000" });
    const c = consolidate(accounts, [h, { ...h, at: T + 1 }, { ...h, qty: "900", at: T + 2 }], prices);
    expect(c.totalUsd).toBeCloseTo(900);
  });
  it("funding e trading da OKX são contas distintas: transferir entre elas não muda o total", () => {
    const before = consolidate(accounts, [hold({ accountId: "okx-f", assetKey: "okx:USDC", econ: "USDC", qty: "1000" })], prices);
    const after = consolidate(accounts, [
      hold({ accountId: "okx-f", assetKey: "okx:USDC", econ: "USDC", qty: "400" }),
      hold({ accountId: "okx-t", assetKey: "okx:USDC", econ: "USDC", qty: "600" }),
    ], prices);
    expect(after.totalUsd).toBeCloseTo(before.totalUsd);
  });
  it("saldo sem preço não vale zero em silêncio: fica fora do total e aparece como sem preço", () => {
    const c = consolidate(accounts, [hold({ accountId: "rabby", assetKey: "evm:1:0xdead", econ: "evm:1:0xdead", symbol: "XYZ", qty: "5" })], prices);
    expect(c.totalUsd).toBe(0);
    expect(c.unpriced).toHaveLength(1);
  });
  it("custo desconhecido não é tratado como zero", () => {
    const c = consolidate(accounts, [
      hold({ accountId: "btc", assetKey: "bitcoin:native", econ: "BTC", qty: "1", costUsd: 60_000 }),
      hold({ accountId: "okx-f", assetKey: "okx:BTC", econ: "BTC", qty: "1" }),
    ], prices);
    const b = c.assets.find((a) => a.econ === "BTC")!;
    expect(b.costUsd).toBeNull();
    expect(b.pnlUsd).toBeNull();
  });
});

describe("identidade dos ativos", () => {
  it("só contratos verificados são agrupados; mesmo símbolo em outro contrato fica separado", () => {
    expect(evmEcon(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831").econ).toBe("USDC");
    expect(evmEcon(42161, "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8").econ).toBe("USDC");
    expect(evmEcon(42161, "0x0000000000000000000000000000000000000bad").known).toBe(false);
    expect(evmEcon(1, "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599")).toMatchObject({ econ: "BTC", wrapped: true });
  });
  it("símbolo de exchange desconhecido não é mapeado por palpite", () => {
    expect(exchangeEcon("UBTC")).toMatchObject({ econ: "BTC", wrapped: true });
    expect(exchangeEcon("PEPE").known).toBe(false);
  });
});

describe("transferências internas × aportes", () => {
  const accounts = [acct("okx", "okx", "OKX"), acct("rabby", "evm", "Rabby", ["0xabc"]), acct("hl", "hyperliquid", "Hyperliquid")];
  const ev = (p: Partial<PEvent> & Pick<PEvent, "id" | "accountId" | "kind" | "qty">): PEvent => ({ t: T, econ: "USDC", ...p });
  it("USDC OKX → Rabby → Hyperliquid: nenhum aporte, nenhum lucro", () => {
    const c = classifyFlows([
      ev({ id: "1", accountId: "okx", kind: "withdraw", qty: 1000, t: T }),
      ev({ id: "2", accountId: "rabby", kind: "transfer_in", qty: 999, t: T + 5 * 60e3 }),
      ev({ id: "3", accountId: "rabby", kind: "transfer_out", qty: 999, t: T + 3600e3 }),
      ev({ id: "4", accountId: "hl", kind: "deposit", qty: 999, t: T + 3600e3 + 120e3 }),
    ], accounts);
    expect(c.every((x) => x.cls === "internal")).toBe(true);
    expect(c.find((x) => x.id === "1")!.matchedWith).toBe("2");
  });
  it("depósito sem par é aporte externo; transferência sem par fica pendente", () => {
    const c = classifyFlows([ev({ id: "a", accountId: "okx", kind: "deposit", qty: 500 }), ev({ id: "b", accountId: "rabby", kind: "transfer_in", qty: 7, econ: "ETH" })], accounts);
    expect(c.find((x) => x.id === "a")!.cls).toBe("external");
    expect(c.find((x) => x.id === "b")!.cls).toBe("pending");
  });
  it("contraparte que é endereço próprio é interna; movimentação repetida não duplica", () => {
    const e = ev({ id: "x", accountId: "okx", kind: "withdraw", qty: 10, counterparty: "0xABC" });
    const c = classifyFlows([e, e], accounts);
    expect(c).toHaveLength(1);
    expect(c[0]!.cls).toBe("internal");
  });
  it("quantidade incompatível não vira par (não esconde um aporte)", () => {
    const c = classifyFlows([ev({ id: "o", accountId: "okx", kind: "withdraw", qty: 100 }), ev({ id: "i", accountId: "hl", kind: "deposit", qty: 5_000, t: T + 60e3 })], accounts);
    expect(c.find((x) => x.id === "i")!.cls).toBe("external");
  });
});

describe("rentabilidade do portfólio", () => {
  it("conta nova não vira lucro e aporte não é rendimento", () => {
    const pts = portfolioReturns([
      { t: T, byAccount: { a: 1000 } },
      { t: T + 3600e3, byAccount: { a: 1100, b: 5000 } }, // b acabou de ser conectada
      { t: T + 7200e3, byAccount: { a: 1600, b: 5000 } }, // aporte de 500 em a
    ], [{ t: T + 5400e3, accountId: "a", usd: 500 }]);
    expect(pts[1]!.resultUsd).toBeCloseTo(100);
    expect(pts[2]!.resultUsd).toBeCloseTo(100);
    const r = returnSince(pts, null)!;
    expect(r.pct).toBeCloseTo(0.1, 3);
  });
});
