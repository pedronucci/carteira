/** Minhas Carteiras: metadados (apelido, categoria, ativa/inativa, própria) e regras de duplicidade. Somente endereços públicos. */
import type { PAccount, PHolding } from "@bst/domain";
import { portfolio, updatePortfolio } from "./portfolio/db";

export const CATEGORIES = ["Principal", "Secundária", "Cold storage", "DeFi", "Trading", "Outra"] as const;
export interface WalletMeta { category: string; enabled: boolean; own: boolean }
export const walletMeta = (a: PAccount): WalletMeta => {
  const c = (a.config ?? {}) as Partial<WalletMeta>;
  return { category: c.category ?? "Principal", enabled: c.enabled !== false, own: c.own !== false };
};
export const isWallet = (a: PAccount) => a.kind === "evm" || a.kind === "solana" || a.kind === "bitcoin";
export const walletAddr = (a: PAccount) => ((a.config as { address?: string } | undefined)?.address ?? a.addresses?.[0] ?? "").toLowerCase();

/** Conta que já usa o mesmo endereço (EVM compara em minúsculas; a mesma carteira vale para todas as redes EVM). */
export function findDuplicate(accounts: PAccount[], kind: string, address: string): PAccount | null {
  const a = address.trim().toLowerCase();
  return accounts.find((x) => x.kind === kind && walletAddr(x) === (kind === "evm" ? a : address.trim())) ?? null;
}

/**
 * Antes de consolidar: carteiras desativadas ficam fora e o mesmo endereço cadastrado duas vezes conta uma vez só.
 * A identidade patrimonial é rede + endereço + ativo (assetKey já traz a rede).
 */
export function effectiveHoldings(accounts: PAccount[], holdings: PHolding[]): PHolding[] {
  const off = new Set(accounts.filter((a) => isWallet(a) && !walletMeta(a).enabled).map((a) => a.id));
  const owner = new Map<string, string>();
  const dropAcc = new Set<string>(off);
  for (const a of accounts) {
    if (!isWallet(a) || off.has(a.id)) continue;
    const addr = walletAddr(a);
    if (!addr) continue;
    const k = `${a.kind}|${addr}`;
    if (owner.has(k)) dropAcc.add(a.id); else owner.set(k, a.id);
  }
  return holdings.filter((h) => !dropAcc.has(h.accountId));
}

export function updateWallet(id: string, patch: { name?: string; category?: string; enabled?: boolean; own?: boolean }) {
  return updatePortfolio((d) => {
    const a = d.accounts.find((x) => x.id === id);
    if (!a) return;
    if (patch.name != null && patch.name.trim()) { a.name = patch.name.trim(); a.institution = patch.name.trim(); }
    a.config = { ...(a.config ?? {}), ...(patch.category != null ? { category: patch.category } : {}), ...(patch.enabled != null ? { enabled: patch.enabled } : {}), ...(patch.own != null ? { own: patch.own } : {}) };
  });
}
export const wallets = () => portfolio().accounts.filter(isWallet);

const MIG_FLAG = "bst.migr.wallets.v2", MIG_BACKUP = "bst.backup.pre-wallets.v1";
/** Migração v1 → v2: cada carteira ganha apelido/categoria/ativa. Faz cópia de segurança antes e nunca apaga nada. Roda uma vez. */
export function migrateWallets(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): { migrated: number; backedUp: boolean } {
  if (storage.getItem(MIG_FLAG)) return { migrated: 0, backedUp: false };
  const accs = portfolio().accounts.filter((a) => isWallet(a) && (a.config as Partial<WalletMeta> | undefined)?.enabled === undefined);
  let backedUp = false;
  try { storage.setItem(MIG_BACKUP, JSON.stringify({ at: Date.now(), accounts: portfolio().accounts })); backedUp = true; } catch { /* sem espaço: a migração só acrescenta campos */ }
  if (accs.length) void updatePortfolio((d) => { for (const a of d.accounts) if (accs.some((x) => x.id === a.id)) a.config = { category: "Principal", enabled: true, own: true, ...(a.config ?? {}) }; });
  storage.setItem(MIG_FLAG, String(Date.now()));
  return { migrated: accs.length, backedUp };
}
