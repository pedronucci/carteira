/**
 * Contas conectadas do Portfólio (somente leitura): Bitcoin, EVM/Rabby e Solana.
 * Cada sincronização substitui os saldos daquela conta (nunca soma de novo) e junta as movimentações pelo id.
 */
import type { PAccount, PEvent } from "@bst/domain";
import { portfolio, updatePortfolio, uidP } from "../portfolio/db";
import { refreshPortfolioPrices } from "../portfolio/engine";
import { closeUsdAt, prices } from "../local/prices";
import { parseXKey, syncBitcoin, isBtcAddress, type XKey } from "./bitcoin";
import { isEvmAddress, syncEvm } from "./evm";
import { isSolAddress, syncSolana } from "./solana";

export type ConnKind = "bitcoin" | "evm" | "solana";
const INSTITUTION: Record<ConnKind, string> = { bitcoin: "Carteira Bitcoin", evm: "Carteira EVM", solana: "Carteira Solana" };

/** Valida a entrada e cria a conta (não sincroniza ainda). Recusa qualquer coisa que pareça segredo. */
export function addConnectedAccount(kind: ConnKind, name: string, raw: string): string {
  const lines = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Informe ao menos um endereço público.");
  if (lines.length >= 12 && lines.every((w) => /^[a-z]+$/.test(w))) throw new Error("Isto parece uma frase de recuperação. Nunca informe a frase de recuperação: use só endereços públicos.");
  let config: Record<string, unknown>;
  if (kind === "bitcoin") {
    const addresses: string[] = [], xkeys: XKey[] = [];
    for (const l of lines) { if (isBtcAddress(l)) addresses.push(l); else xkeys.push(parseXKey(l)); }
    config = { addresses, xkeys };
  } else if (kind === "evm") {
    const bad = lines.find((l) => !isEvmAddress(l));
    if (bad) throw new Error(`Endereço EVM inválido: ${bad.slice(0, 12)}…`);
    if (lines.some((l) => /^(0x)?[0-9a-f]{64}$/i.test(l))) throw new Error("Isto parece uma chave privada. Use só o endereço público (0x… com 40 caracteres).");
    config = { address: lines[0]!.toLowerCase() };
  } else {
    const bad = lines.find((l) => !isSolAddress(l));
    if (bad) throw new Error(`Endereço Solana inválido: ${bad.slice(0, 12)}…`);
    config = { address: lines[0] };
  }
  const id = `${kind}-${uidP()}`;
  const addr = kind === "bitcoin" ? (config.addresses as string[]) : [config.address as string];
  void updatePortfolio((d) => { d.accounts.push({ id, kind, name: name.trim() || INSTITUTION[kind], institution: name.trim() || INSTITUTION[kind], network: kind === "evm" ? "EVM" : kind === "bitcoin" ? "bitcoin" : "Solana", addresses: addr, config, createdAt: Date.now() }); });
  return id;
}

export function removeConnectedAccount(id: string) {
  return updatePortfolio((d) => {
    d.accounts = d.accounts.filter((a) => a.id !== id);
    d.synced = d.synced.filter((h) => h.accountId !== id);
    d.events = d.events.filter((e) => e.accountId !== id);
    delete d.sync[id];
  });
}

const usdAt = (t: number, btc: number) => { const px = closeUsdAt(Math.floor(t / 1000)) ?? prices().spot?.btcUsd ?? null; return px ? btc * px : null; };

export async function syncAccount(id: string): Promise<void> {
  const a = portfolio().accounts.find((x) => x.id === id);
  if (!a || !["bitcoin", "evm", "solana"].includes(a.kind)) return;
  await updatePortfolio((d) => { d.sync[id] = { state: "sync", at: d.sync[id]?.at ?? 0 }; });
  try {
    const cfg = (a.config ?? {}) as { addresses?: string[]; xkeys?: XKey[]; address?: string };
    let holdings: ReturnType<typeof portfolio>["synced"] = [], events: PEvent[] = [], info = "", own: string[] | null = null;
    if (a.kind === "bitcoin") {
      const r = await syncBitcoin({ addresses: cfg.addresses ?? [], xkeys: cfg.xkeys ?? [] });
      holdings = r.sats ? [{ accountId: id, assetKey: "bitcoin:native", econ: "BTC", symbol: "BTC", name: "Bitcoin", network: "bitcoin", qty: String(r.sats / 1e8), available: String(r.confirmedSats / 1e8), kind: "spot", source: "sync", at: Date.now() }] : [];
      events = r.txs.map((t) => ({ id: `btc:${id}:${t.txid}`, accountId: id, t: t.t, kind: t.netSats >= 0 ? "transfer_in" : "transfer_out", econ: "BTC", qty: Math.abs(t.netSats) / 1e8, usd: usdAt(t.t, Math.abs(t.netSats) / 1e8), txid: t.txid, counterparty: t.counterparty, note: t.netSats >= 0 ? "BTC recebido" : "BTC enviado" }));
      own = r.addresses.map((x) => x.address);
      info = `${r.addresses.length} endereço(s) com uso · ${r.utxos} UTXO(s)${r.sats !== r.confirmedSats ? " · inclui não confirmado" : ""}`;
    } else if (a.kind === "evm") {
      const r = await syncEvm(id, cfg.address!);
      holdings = r.holdings;
      info = `${r.chains.filter((c) => c.ok).length}/${r.chains.length} redes lidas · tokens do registro verificado${r.errors.length ? ` · falhou: ${r.errors.join("; ")}` : ""}`;
      if (r.chains.every((c) => !c.ok)) throw new Error(r.errors.join("; "));
    } else {
      const r = await syncSolana(id, cfg.address!);
      holdings = r.holdings; info = r.note;
    }
    await updatePortfolio((d) => {
      d.synced = [...d.synced.filter((h) => h.accountId !== id), ...holdings];
      const m = new Map(d.events.map((e) => [e.id, e]));
      for (const e of events) m.set(e.id, { ...e, ...(m.get(e.id)?.note?.includes("classificado pelo usuário") ? { kind: m.get(e.id)!.kind, note: m.get(e.id)!.note } : {}) });
      d.events = [...m.values()];
      if (own) { const acc = d.accounts.find((x) => x.id === id); if (acc) acc.addresses = [...new Set([...(acc.addresses ?? []), ...own])]; }
      d.sync[id] = { state: "ok", at: Date.now(), info };
    });
    void refreshPortfolioPrices();
  } catch (e) {
    await updatePortfolio((d) => { d.sync[id] = { state: "error", at: Date.now(), error: (e as Error).message }; });
  }
}

/** Sincroniza todas as contas conectadas, uma de cada vez (respeita limites das APIs públicas). */
export async function syncAllAccounts(): Promise<void> {
  for (const a of portfolio().accounts.filter((x: PAccount) => ["bitcoin", "evm", "solana"].includes(x.kind))) await syncAccount(a.id);
}
