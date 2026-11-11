/**
 * Contas conectadas do Portfólio (somente leitura): Bitcoin, EVM/Rabby e Solana.
 * Cada sincronização substitui os saldos daquela conta (nunca soma de novo) e junta as movimentações pelo id.
 */
import type { PAccount, PEvent } from "@bst/domain";
import { portfolio, updatePortfolio, uidP } from "../portfolio/db";
import { findDuplicate } from "../wallets";
import { refreshPortfolioPrices } from "../portfolio/engine";
import { closeUsdAt, prices } from "../local/prices";
import { parseXKey, syncBitcoin, isBtcAddress, type XKey } from "./bitcoin";
import { isEvmAddress, syncEvm } from "./evm";
import { isSolAddress, SPL_KNOWN, syncSolana } from "./solana";
import { solanaTokensViaGateway } from "./okx";

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
    const dup = findDuplicate(portfolio().accounts, "evm", lines[0]!);
    if (dup) throw new Error(`Este endereço já está cadastrado como "${dup.name}". Edite o apelido em Minhas Carteiras; os ativos não são contados duas vezes.`);
    config = { address: lines[0]!.toLowerCase(), category: "Principal", enabled: true, own: true };
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

const usdAt = (t: number, btc: number) => { const px = closeUsdAt(Math.floor(t / 1000)); return px ? btc * px : null; };

export async function syncAccount(id: string): Promise<void> {
  const a = portfolio().accounts.find((x) => x.id === id);
  if (!a || !["bitcoin", "evm", "solana"].includes(a.kind)) return;
  await updatePortfolio((d) => { d.sync[id] = { state: "sync", at: d.sync[id]?.at ?? 0 }; });
  try {
    const cfg = (a.config ?? {}) as { addresses?: string[]; xkeys?: XKey[]; address?: string };
    let holdings: ReturnType<typeof portfolio>["synced"] = [], events: PEvent[] = [], info = "", own: string[] | null = null;
    const preserveNetworks = new Set<string>();
    let partial = false;
    if (a.kind === "bitcoin") {
      const r = await syncBitcoin({ addresses: cfg.addresses ?? [], xkeys: cfg.xkeys ?? [] });
      holdings = r.sats ? [{ accountId: id, assetKey: "bitcoin:native", econ: "BTC", symbol: "BTC", name: "Bitcoin", network: "bitcoin", qty: String(r.sats / 1e8), available: String(r.confirmedSats / 1e8), kind: "spot", source: "sync", at: Date.now() }] : [];
      events = r.txs.map((t) => {
        // O principal exclui a taxa: o custo de rede permanece no resultado patrimonial.
        const principal = t.netSats + t.feeSats;
        return { id: `btc:${id}:${t.txid}`, accountId: id, t: t.t, kind: principal >= 0 ? "transfer_in" : "transfer_out", econ: "BTC", network: "bitcoin", qty: Math.abs(principal) / 1e8, usd: usdAt(t.t, Math.abs(principal) / 1e8), feeUsd: usdAt(t.t, t.feeSats / 1e8), confirmed: t.confirmed, status: t.confirmed ? "confirmed" : "pending", txid: t.txid, counterparty: t.counterparty, note: t.confirmed ? principal >= 0 ? "BTC recebido" : "BTC enviado" : "BTC não confirmado: sujeito a substituição" };
      });
      partial = r.txs.some(t => !t.confirmed);
      own = r.addresses.map((x) => x.address);
      info = `Histórico recente (cobertura parcial) · ${r.addresses.length} endereço(s) com uso · ${r.utxos} UTXO(s)${r.sats !== r.confirmedSats ? " · inclui não confirmado; rentabilidade suspensa" : ""}`;
    } else if (a.kind === "evm") {
      const r = await syncEvm(id, cfg.address!);
      holdings = r.holdings;
      info = `${r.chains.filter((c) => c.ok).length}/${r.chains.length} redes lidas · tokens do registro verificado${r.errors.length ? ` · falhou: ${r.errors.join("; ")}` : ""}`;
      if (r.chains.every((c) => !c.ok)) throw new Error(r.errors.join("; "));
      for (const c of r.chains.filter((c) => !c.ok)) preserveNetworks.add(c.name);
      partial = r.errors.length > 0;
    } else {
      const r = await syncSolana(id, cfg.address!);
      holdings = r.holdings; info = r.note;
      const spl = await solanaTokensViaGateway(cfg.address!).catch((e: Error) => { info = `SOL lido · tokens SPL: ${e.message}`; return null; });
      if (!spl && portfolio().synced.some((h) => h.accountId === id && h.assetKey !== "solana:native")) { preserveNetworks.add("Solana SPL"); partial = true; }
      if (spl) {
        for (const t of spl) {
          const k = SPL_KNOWN[t.mint];
          holdings.push({ accountId: id, assetKey: `solana:${t.mint}`, econ: k?.econ ?? `solana:${t.mint}`, symbol: k?.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`, network: "Solana", qty: t.amount, kind: "spot", source: "sync", wrapped: k?.wrapped, at: Date.now(), name: k?.staking ? "token de staking (separado do SOL)" : k ? undefined : "token não reconhecido" });
        }
        info = `SOL e ${spl.length} token(s) SPL (pelo gateway)`;
      }
    }
    await updatePortfolio((d) => {
      d.synced = [...d.synced.filter((h) => h.accountId !== id || preserveNetworks.has(h.network) || preserveNetworks.has("Solana SPL") && h.assetKey !== "solana:native"), ...holdings];
      const m = new Map(d.events.map((e) => [e.id, e]));
      if (a.kind === "bitcoin") {
        const received = new Set(events.map(e => e.id));
        // Ausência na janela recente não prova remoção/reorg: conservar e sinalizar reconciliação.
        for (const old of d.events) if (old.accountId === id && old.status === "pending" && !received.has(old.id)) {
          m.set(old.id, { ...old, note: "Transação pendente ausente da consulta recente; verificar substituição/reorg." }); partial = true;
        }
      }
      for (const e of events) { const previous = m.get(e.id); m.set(e.id, { ...e, ...(!e.confirmed && previous ? { t: previous.t } : {}), ...(previous?.classification || previous?.note?.includes("classificado pelo usuário") ? { kind: previous.kind, classification: previous.classification, note: previous.note } : {}) }); }
      d.events = [...m.values()];
      if (own) { const acc = d.accounts.find((x) => x.id === id); if (acc) acc.addresses = [...new Set([...(acc.addresses ?? []), ...own])]; }
      d.sync[id] = { state: partial ? "partial" : "ok", at: Date.now(), info, historyComplete: false };
    });
    void refreshPortfolioPrices();
  } catch (e) {
    await updatePortfolio((d) => { d.sync[id] = { state: "error", at: Date.now(), error: (e as Error).message }; });
  }
}

/** Sincroniza todas as contas conectadas, uma de cada vez (respeita limites das APIs públicas). */
export async function syncAllAccounts(): Promise<void> {
  for (const a of portfolio().accounts.filter((x: PAccount) => ["bitcoin", "evm", "solana"].includes(x.kind) && (x.config as { enabled?: boolean } | undefined)?.enabled !== false)) await syncAccount(a.id);
}
