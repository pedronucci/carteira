/**
 * Carteiras EVM (Rabby e outras), somente leitura pelo endereço público.
 * Sem chave de API: saldo nativo e tokens do registro verificado (packages/domain/assets.ts), por RPC público.
 * A descoberta de QUALQUER token e o histórico de transações exigem um explorador com chave, que só pode ficar
 * no gateway seguro (Fase 4b), nunca no navegador.
 */
import { ASSETS, CHAINS, evmEcon, type PHolding } from "@bst/domain";

export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

type RpcRes = { id: number; result?: string; error?: { message: string } };

async function batch(url: string, calls: { method: string; params: unknown[] }[], f: typeof fetch): Promise<RpcRes[]> {
  const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))) });
  if (r.status === 429) throw new Error("O RPC público limitou as consultas. Tente de novo em alguns minutos.");
  if (!r.ok) throw new Error(`RPC respondeu ${r.status}.`);
  const j = (await r.json()) as RpcRes[] | RpcRes;
  const arr = Array.isArray(j) ? j : [j];
  return arr.sort((a, b) => a.id - b.id);
}

/** Converte um inteiro hexadecimal em quantidade decimal (string exata, sem perder precisão). */
export function fromHexUnits(hex: string | undefined, decimals: number): string {
  if (!hex || hex === "0x") return "0";
  const v = BigInt(hex);
  if (v === 0n) return "0";
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export interface EvmSync { holdings: PHolding[]; errors: string[]; chains: { id: number; name: string; ok: boolean }[] }

export async function syncEvm(accountId: string, address: string, opts: { chains?: number[]; fetch?: typeof fetch } = {}): Promise<EvmSync> {
  const f = opts.fetch ?? fetch;
  const addr = address.trim().toLowerCase();
  if (!isEvmAddress(addr)) throw new Error("Endereço EVM inválido.");
  const pad = addr.slice(2).padStart(64, "0");
  const holdings: PHolding[] = [], errors: string[] = [], chains: EvmSync["chains"] = [];
  const now = Date.now();
  for (const c of CHAINS.filter((x) => !opts.chains || opts.chains.includes(x.id))) {
    const tokens = ASSETS.filter((a) => a.chainId === c.id && a.address !== "native");
    try {
      const res = await batch(c.defaultRpc, [
        { method: "eth_getBalance", params: [addr, "latest"] },
        ...tokens.map((t) => ({ method: "eth_call", params: [{ to: t.address, data: "0x70a08231" + pad }, "latest"] })),
      ], f);
      const err = res.find((r) => r.error);
      if (err) throw new Error(err.error!.message);
      const native = ASSETS.find((a) => a.chainId === c.id && a.address === "native")!;
      const all = [{ def: native, raw: res[0]?.result }, ...tokens.map((t, i) => ({ def: t, raw: res[i + 1]?.result }))];
      for (const { def, raw } of all) {
        const qty = fromHexUnits(raw, def.decimals);
        if (qty === "0") continue;
        const id = evmEcon(c.id, def.address);
        holdings.push({ accountId, assetKey: `evm:${c.id}:${def.address}`, econ: id.econ, symbol: def.symbol, name: def.name, network: c.name, qty, kind: "spot", source: "sync", wrapped: id.wrapped, at: now });
      }
      chains.push({ id: c.id, name: c.name, ok: true });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
      chains.push({ id: c.id, name: c.name, ok: false });
    }
  }
  return { holdings, errors, chains };
}
