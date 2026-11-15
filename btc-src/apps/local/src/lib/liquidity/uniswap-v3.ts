import { keccak_256 } from "@noble/hashes/sha3";
import { d } from "@bst/domain";
import { NETWORKS, type LPAdapter, type LPPosition } from "./types";
import { amounts } from "./math";
export const MANAGERS: Record<number, string> = { 1: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", 42161: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", 10: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", 137: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", 8453: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", 56: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613" };
export const word = (n: bigint | string) => typeof n === "bigint" ? BigInt.asUintN(256, n).toString(16).padStart(64, "0") : n.replace(/^0x/, "").padStart(64, "0");
export const selector = (s: string) => Array.from(keccak_256(new TextEncoder().encode(s))).map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 8);
export function words(raw: string, min: number) { if (!/^0x(?:[a-fA-F0-9]{64})+$/.test(raw) || raw.length < 2 + min * 64)
    throw Error("Resposta ABI incompleta"); return raw.slice(2).match(/.{64}/g)!; }
const address = (w: string) => "0x" + w.slice(-40).toLowerCase();
export function symbol(raw: string, fallback: string) { try {
    const w = words(raw, 1);
    const hex = w.length === 1 ? w[0]! : raw.slice(2 + 128, 2 + 128 + Number(BigInt("0x" + w[1]!)) * 2);
    if (hex.length > 512)
        return fallback;
    return new TextDecoder().decode(Uint8Array.from(hex.match(/../g)!.map(x => parseInt(x, 16)))).replace(/\0/g, "").slice(0, 32) || fallback;
}
catch {
    return fallback;
} }
export async function rpc(url: string, method: string, params: unknown[], signal: AbortSignal) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); if (!r.ok)
    throw Error(`RPC HTTP ${r.status}`); const j = await r.json(); if (j.error || typeof j.result !== "string")
    throw Error(j.error?.message ?? "RPC sem resultado"); return j.result as string; }
export const uniswapV3: LPAdapter = { id: "uniswap-v3", async discover(accountId, owner, chainId, offset, signal) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(owner) || !Number.isSafeInteger(offset) || offset < 0)
            throw Error("Endereço/página inválidos");
        const net = NETWORKS.find(c => c.id === chainId), manager = MANAGERS[chainId];
        if (!net || !manager)
            throw Error("Rede não suportada");
        const block = await rpc(net.rpc, "eth_blockNumber", [], signal);
        const calls = new Map<string, Promise<string>>();
        const call = (to: string, fn: string, args = "") => { const key = to + fn + args; let found = calls.get(key); if (!found) {
            found = rpc(net.rpc, "eth_call", [{ to, data: "0x" + selector(fn) + args }, block], signal);
            calls.set(key, found);
        } return found; };
        const count = BigInt(await call(manager, "balanceOf(address)", word(owner)));
        const end = Number(count > BigInt(offset + 20) ? BigInt(offset + 20) : count);
        const positions: LPPosition[] = [], notes: string[] = [];
        const factory = address(words(await call(manager, "factory()"), 1)[0]!);
        for (let index = offset; index < end; index++) {
            if (signal.aborted)
                throw Error("Consulta cancelada");
            try {
                const tokenId = BigInt(await call(manager, "tokenOfOwnerByIndex(address,uint256)", word(owner) + word(BigInt(index))));
                const w = words(await call(manager, "positions(uint256)", word(tokenId)), 12);
                // Ownership is enumerated from the manager at the same block as all contract reads.
                const t0 = address(w[2]!), t1 = address(w[3]!), fee = Number(BigInt("0x" + w[4]!)), lower = Number(BigInt.asIntN(24, BigInt("0x" + w[5]!))), upper = Number(BigInt.asIntN(24, BigInt("0x" + w[6]!))), liq = BigInt("0x" + w[7]!).toString();
                const pool = address(words(await call(factory, "getPool(address,address,uint24)", word(t0) + word(t1) + word(BigInt(fee))), 1)[0]!);
                if (/^0x0{40}$/.test(pool))
                    throw Error("Pool inexistente");
                const slot = words(await call(pool, "slot0()"), 2), sqrt = BigInt("0x" + slot[0]!).toString(), tick = Number(BigInt.asIntN(24, BigInt("0x" + slot[1]!)));
                const tokens = [];
                for (const t of [t0, t1]) {
                    const decimals = Number(BigInt(await call(t, "decimals()")));
                    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
                        throw Error("Decimais inválidos");
                    let sym = t.slice(0, 8);
                    try {
                        sym = symbol(await call(t, "symbol()"), sym);
                    }
                    catch { }
                    tokens.push({ address: t, symbol: sym, decimals, qty: "0", priceUsd: null as number | null });
                }
                const qty = amounts(liq, sqrt, lower, upper, tokens[0]!.decimals, tokens[1]!.decimals);
                tokens.forEach((t, n) => t.qty = qty[n]!);
                const factor = d(10).pow(tokens[0]!.decimals - tokens[1]!.decimals);
                positions.push({ id: `eip155:${chainId}:uniswap-v3:${manager.toLowerCase()}:${tokenId}`, accountId, owner: owner.toLowerCase(), network: net.name, chainId, protocol: "Uniswap V3", pool, positionId: tokenId.toString(), block, at: Date.now(), tokens, valueUsd: null, owedRaw: [d(BigInt("0x" + w[10]!).toString()).div(d(10).pow(tokens[0]!.decimals)).toString(), d(BigInt("0x" + w[11]!).toString()).div(d(10).pow(tokens[1]!.decimals)).toString()], tick, lowerTick: lower, upperTick: upper, price: d(sqrt).div(d(2).pow(96)).pow(2).mul(factor).toNumber(), lower: d("1.0001").pow(lower).mul(factor).toNumber(), upper: d("1.0001").pow(upper).mul(factor).toNumber(), liquidity: liq, feeTier: fee / 10000, status: liq === "0" ? "CLOSED" : tick >= lower && tick < upper ? "IN RANGE" : "OUT OF RANGE", historyComplete: false });
            }
            catch (e) {
                notes.push(`NFT na página ${index + 1}: ${(e as Error).message}`);
            }
        }
        return { positions, notes, complete: notes.length === 0 && BigInt(end) >= count, next: BigInt(end) < count ? end : null };
    } };
export async function pricePositions(positions: LPPosition[], signal: AbortSignal) {
    const chains: Record<number, string> = { 1: "ethereum", 42161: "arbitrum", 8453: "base", 10: "optimism", 137: "polygon", 56: "bsc" };
    const ids = [...new Set(positions.flatMap(p => p.tokens.map(t => `${chains[p.chainId]}:${t.address}`)))];
    if (!ids.length)
        return positions;
    const book: Record<string, {
        price?: number;
        timestamp?: number;
        confidence?: number;
    }> = {};
    for (let start = 0; start < ids.length; start += 30) {
        const r = await fetch("https://coins.llama.fi/prices/current/" + ids.slice(start, start + 30).join(","), { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
        if (!r.ok)
            throw Error(`Preços HTTP ${r.status}`);
        Object.assign(book, (await r.json()).coins);
    }
    return positions.map(p => { const tokens = p.tokens.map(t => { const q = book[`${chains[p.chainId]}:${t.address}`]; return { ...t, priceUsd: q && typeof q.price === "number" && Number.isFinite(q.price) && q.price > 0 && typeof q.timestamp === "number" && Math.abs(Date.now() / 1000 - q.timestamp) < 3600 && (q.confidence == null || q.confidence >= .9) ? q.price : null }; }); return { ...p, tokens, valueUsd: tokens.every(t => t.priceUsd != null) ? tokens.reduce((s, t, index) => s.plus(d(t.qty).plus(p.owedRaw[index] ?? "0").mul(t.priceUsd!)), d(0)).toNumber() : null }; });
}
