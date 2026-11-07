/**
 * Solana, somente leitura pelo endereço público (lógica própria, não EVM).
 * Do navegador: só o saldo de SOL (o RPC público oficial recusa chamadas de páginas web; o da PublicNode aceita
 * getBalance). Tokens SPL exigem um RPC indexado com chave pessoal, que fica no gateway seguro (Fase 4b).
 */
import type { PHolding } from "@bst/domain";

const RPC = "https://solana-rpc.publicnode.com";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isSolAddress = (a: string) => B58.test(a.trim()) && !/^0x/.test(a.trim());

/** Mints conhecidos (identidade verificada). Outros mints aparecem como "não reconhecido". */
export const SPL_KNOWN: Record<string, { symbol: string; econ: string; decimals: number; wrapped?: boolean; staking?: boolean }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", econ: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", econ: "USDT", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "wSOL", econ: "SOL", decimals: 9, wrapped: true },
  // tokens de staking ficam separados do SOL (não são o mesmo ativo econômico)
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "JitoSOL", econ: "JitoSOL", decimals: 9, staking: true },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", econ: "mSOL", decimals: 9, staking: true },
};

export async function syncSolana(accountId: string, address: string, opts: { fetch?: typeof fetch } = {}): Promise<{ holdings: PHolding[]; note: string }> {
  const f = opts.fetch ?? fetch;
  const a = address.trim();
  if (!isSolAddress(a)) throw new Error("Endereço Solana inválido.");
  const r = await f(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [a] }) });
  if (r.status === 429) throw new Error("O RPC da Solana limitou as consultas. Tente de novo em alguns minutos.");
  const j = (await r.json()) as { result?: { value: number }; error?: { message: string } };
  if (j.error || !j.result) throw new Error(j.error?.message ?? `RPC respondeu ${r.status}.`);
  const lamports = j.result.value;
  const holdings: PHolding[] = lamports > 0 ? [{ accountId, assetKey: "solana:native", econ: "SOL", symbol: "SOL", name: "Solana", network: "Solana", qty: String(lamports / 1e9), kind: "spot", source: "sync", at: Date.now() }] : [];
  return { holdings, note: "Saldo de SOL lido. Tokens SPL (USDC, USDT, JitoSOL…) precisam do gateway seguro, com um RPC indexado." };
}
