import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }, configurable: true });
const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222";

describe("contas Hyperliquid adicionais", () => {
  beforeEach(() => { store.clear(); });
  it("cadastra a segunda conta, recusa repetida, principal e chave privada", async () => {
    const m = await import("./hl-extra");
    const id = m.addExtra("Minha segunda", A);
    expect(m.extraState().accounts).toHaveLength(1);
    expect(() => m.addExtra("de novo", A.toUpperCase().replace("0X", "0x"))).toThrow(/já está cadastrado/);
    expect(() => m.addExtra("x", "0x" + "ab".repeat(32))).toThrow();
    expect(() => m.addExtra("x", "abc")).toThrow(/inválido/);
    m.renameExtra(id, "Conta 2"); expect(m.extraState().accounts[0]!.name).toBe("Conta 2");
    m.removeExtra(id); expect(m.extraState().accounts).toHaveLength(0);
  });
  it("limite de contas adicionais", async () => {
    const m = await import("./hl-extra");
    m.addExtra("a", A); m.addExtra("b", B); m.addExtra("c", "0x3333333333333333333333333333333333333333");
    expect(() => m.addExtra("d", "0x4444444444444444444444444444444444444444")).toThrow(/Limite/);
  });
});
