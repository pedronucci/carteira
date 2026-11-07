/** Tokens SPL pelo RPC indexado configurado no gateway (a URL, que pode conter a chave do provedor, fica só aqui). */
const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
type Acc = { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmountString: string } } } } } };

export async function solanaTokens(rpc: string, owner: string, f: typeof fetch = fetch) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) throw new Error("Endereço Solana inválido.");
  const out: { mint: string; amount: string; decimals: number }[] = [];
  for (const programId of PROGRAMS) {
    const r = await f(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { programId }, { encoding: "jsonParsed" }] }) });
    const j = (await r.json()) as { result?: { value: Acc[] }; error?: { message: string } };
    if (j.error) throw new Error(`RPC Solana: ${j.error.message}`);
    for (const a of j.result?.value ?? []) {
      const i = a.account.data.parsed.info;
      if (i.tokenAmount.amount !== "0") out.push({ mint: i.mint, amount: i.tokenAmount.uiAmountString, decimals: i.tokenAmount.decimals });
    }
  }
  return out;
}
