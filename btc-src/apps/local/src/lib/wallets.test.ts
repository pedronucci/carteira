import { describe, expect, it } from "vitest";
import type { PAccount, PHolding } from "@bst/domain";
import { effectiveHoldings, findDuplicate, walletMeta } from "./wallets";

const acc = (id: string, address: string, config: Record<string, unknown> = {}): PAccount => ({ id, kind: "evm", name: id, institution: id, createdAt: 0, addresses: [address], config: { address, ...config } });
const h = (accountId: string, assetKey: string, qty = "1"): PHolding => ({ accountId, assetKey, econ: "ETH", symbol: "ETH", network: "Ethereum", qty, kind: "spot", source: "sync", at: 0 });

describe("carteiras", () => {
  it("detecta endereço repetido sem diferenciar maiúsculas", () => {
    const a = [acc("a", "0xabc0000000000000000000000000000000000001")];
    expect(findDuplicate(a, "evm", "0xABC0000000000000000000000000000000000001")?.id).toBe("a");
    expect(findDuplicate(a, "evm", "0xabc0000000000000000000000000000000000002")).toBeNull();
  });
  it("mesmo endereço duas vezes conta uma vez; apelidos diferentes são permitidos", () => {
    const a = [acc("a", "0x1"), acc("b", "0x1"), acc("c", "0x2")];
    const out = effectiveHoldings(a, [h("a", "evm:1:native"), h("b", "evm:1:native"), h("c", "evm:1:native")]);
    expect(out.map((x) => x.accountId)).toEqual(["a", "c"]);
  });
  it("carteira desativada sai do patrimônio; o mesmo endereço em outra rede é outro ativo", () => {
    const a = [acc("a", "0x1", { enabled: false }), acc("c", "0x2")];
    const out = effectiveHoldings(a, [h("a", "evm:1:native"), h("c", "evm:1:native"), h("c", "evm:42161:native")]);
    expect(out).toHaveLength(2); expect(out.every((x) => x.accountId === "c")).toBe(true);
    expect(walletMeta(a[0]!).enabled).toBe(false); expect(walletMeta(a[1]!).own).toBe(true);
  });
});
