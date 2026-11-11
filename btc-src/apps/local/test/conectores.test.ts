/** Conectores EVM e Solana (respostas no formato real dos RPCs) e proteções contra segredos. */
import { describe, expect, it, vi } from "vitest";
import { fromHexUnits, syncEvm } from "../src/lib/connectors/evm";
import { isSolAddress, syncSolana } from "../src/lib/connectors/solana";

const ADDR = "0x489ee077994b6658eafa855c308275ead8097c4a";

describe("EVM", () => {
  it("converte unidades sem perder precisão", () => {
    expect(fromHexUnits("0x51021bc5a", 6)).toBe("21745.482842");
    expect(fromHexUnits("0x0de0b6b3a7640000", 18)).toBe("1");
    expect(fromHexUnits("0x0", 18)).toBe("0");
    expect(fromHexUnits("0x", 6)).toBe("0");
  });
  it("lê nativo e tokens verificados; ignora saldo zero; agrupa USDC e USDC.e como USDC", async () => {
    const f: typeof fetch = async (_u, init) => {
      const calls = JSON.parse(String(init!.body)) as { id: number; method: string; params: [{ to?: string }] }[];
      return new Response(JSON.stringify(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result:
        c.method === "eth_getBalance" ? "0x0de0b6b3a7640000"
        : c.params[0].to === "0xaf88d065e77c8cc2239327c5edb3a432268e5831" ? "0x51021bc5a"
        : c.params[0].to === "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8" ? "0xf4240" : "0x0" }))), { status: 200 });
    };
    const r = await syncEvm("acc", ADDR, { chains: [42161], fetch: f });
    expect(r.errors).toEqual([]);
    expect(r.holdings.map((h) => [h.symbol, h.econ, h.qty])).toEqual([["ETH", "ETH", "1"], ["USDC", "USDC", "21745.482842"], ["USDC.e", "USDC", "1"]]);
    expect(r.holdings.find((h) => h.symbol === "USDC.e")!.wrapped).toBe(true);
  });
  it("uma rede fora do ar não derruba as outras", async () => {
    const f: typeof fetch = async (u, init) => (String(u).includes("arbitrum") ? new Response("", { status: 503 }) : new Response(JSON.stringify(JSON.parse(String(init!.body)).map((c: { id: number }) => ({ id: c.id, result: "0x0" }))), { status: 200 }));
    const r = await syncEvm("acc", ADDR, { chains: [42161, 8453], fetch: f });
    expect(r.chains.find((c) => c.id === 42161)!.ok).toBe(false);
    expect(r.chains.find((c) => c.id === 8453)!.ok).toBe(true);
  });
  it("recusa endereço inválido", async () => { await expect(syncEvm("acc", "0x123")).rejects.toThrow(/inválido/); });
});

describe("Solana", () => {
  it("lê o saldo de SOL (lamports → SOL) e explica o limite dos tokens SPL", async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 2_500_000_000 } }), { status: 200 });
    const r = await syncSolana("s", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", { fetch: f });
    expect(r.holdings[0]).toMatchObject({ econ: "SOL", qty: "2.5", network: "Solana" });
    expect(r.note).toMatch(/SPL/);
  });
  it("não usa validação EVM para endereço Solana", () => {
    expect(isSolAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true);
    expect(isSolAddress(ADDR)).toBe(false);
  });
  it("erro do RPC vira mensagem", async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 403, message: "Access forbidden" } }), { status: 403 });
    await expect(syncSolana("s", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", { fetch: f })).rejects.toThrow(/forbidden/);
  });
});

describe("proteção contra segredos", () => {
  it("recusa frase de recuperação e chave privada", async () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 } as Storage;
    vi.resetModules();
    const { addConnectedAccount } = await import("../src/lib/connectors");
    const seed = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    expect(() => addConnectedAccount("bitcoin", "x", seed)).toThrow(/frase de recuperação/);
    expect(() => addConnectedAccount("evm", "x", seed)).toThrow(/frase de recuperação/);
    expect(() => addConnectedAccount("evm", "x", "0x" + "ab".repeat(32))).toThrow();
    expect(() => addConnectedAccount("bitcoin", "x", "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi")).toThrow(/PRIVADA/);
  });
});
