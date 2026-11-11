/**
 * Contas Hyperliquid ADICIONAIS (além da conta da Estratégia BTC/USDC). Somente leitura pelo endereço público.
 * Cada conta tem id, apelido, saldo ao vivo e histórico próprios. Nada aqui entra no resultado da Estratégia:
 * só em Posições Perpétuas, Risk Center e Portfólio (pelo equity, sem duplicar).
 */
import { fetchHistory, fetchLive, isAddress, hlState, type HlHistory, type HlLive } from "./hl";
import { getStore } from "./store";

const KEY = "bst.hl.extra.v1";
export const MAX_EXTRA = 3;
export interface HlExtra { id: string; name: string; address: string; live: HlLive | null; history: HlHistory | null; error: string | null; syncing: boolean }
interface St { v: 1; accounts: HlExtra[]; storageError: string | null }

const load = (): St => {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as St | null; if (s?.accounts) return { v: 1, storageError: null, accounts: s.accounts.map((a) => ({ ...a, syncing: false })) }; } catch { /* vazio */ }
  return { v: 1, accounts: [], storageError: null };
};
let st: St = load();
const subs = new Set<() => void>();
export const extraState = () => st;
export const subscribeExtra = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function commit(next: St) {
  st = next;
  try { localStorage.setItem(KEY, JSON.stringify({ ...st, storageError: null, accounts: st.accounts.map((a) => ({ ...a, syncing: false })) })); st.storageError = null; }
  catch { st.storageError = "O armazenamento do navegador está cheio: o histórico da conta adicional não pôde ser salvo (os saldos de agora continuam certos)."; }
  subs.forEach((f) => f());
}
const patch = (id: string, p: Partial<HlExtra>) => commit({ ...st, accounts: st.accounts.map((a) => (a.id === id ? { ...a, ...p } : a)) });

if (typeof window !== "undefined") window.addEventListener("bst:extra-reload", () => { st = load(); subs.forEach((f) => f()); });

export const extraId = (address: string) => `hl-${address.trim().toLowerCase().slice(2)}`;

/** Valida e cadastra. Recusa endereço inválido, repetido ou igual ao da conta principal. */
export function addExtra(name: string, address: string): string {
  const addr = address.trim().toLowerCase();
  if (!isAddress(addr)) throw new Error("Endereço inválido. Ele começa com 0x e tem 42 caracteres.");
  if (/^(0x)?[0-9a-f]{64}$/i.test(address.trim())) throw new Error("Isto parece uma chave privada. Use só o endereço público.");
  if (getStore().settings.hl?.address?.toLowerCase() === addr) throw new Error("Este endereço já é a conta principal (da Estratégia). Cadastre aqui a OUTRA conta.");
  if (st.accounts.some((a) => a.address === addr)) throw new Error("Este endereço já está cadastrado.");
  if (st.accounts.length >= MAX_EXTRA) throw new Error(`Limite de ${MAX_EXTRA} contas adicionais.`);
  const id = extraId(addr);
  commit({ ...st, accounts: [...st.accounts, { id, name: name.trim() || `Hyperliquid ${st.accounts.length + 2}`, address: addr, live: null, history: null, error: null, syncing: false }] });
  return id;
}
export const removeExtra = (id: string) => commit({ ...st, accounts: st.accounts.filter((a) => a.id !== id) });
export const renameExtra = (id: string, name: string) => name.trim() && patch(id, { name: name.trim() });

const running = new Set<string>();
/** Atualiza uma conta (sem sincronizações concorrentes da mesma conta). `full` também baixa o histórico. */
export async function refreshExtra(id: string, full = false, btcUsd: number | null = null) {
  const a = st.accounts.find((x) => x.id === id);
  if (!a || running.has(id)) return;
  running.add(id);
  try {
    patch(id, { syncing: true });
    const live = await fetchLive(a.address, { btcUsd });
    patch(id, { live, error: null });
    if (full) {
      const cur = st.accounts.find((x) => x.id === id)!;
      patch(id, { history: await fetchHistory(a.address, cur.history?.v === 2 ? cur.history : null) });
    }
  } catch (e) { patch(id, { error: (e as Error).message }); }
  finally { patch(id, { syncing: false }); running.delete(id); }
}
export async function refreshAllExtras(full = false) {
  const btcUsd = (await import("./prices")).prices().spot?.btcUsd ?? null;
  for (const a of st.accounts) await refreshExtra(a.id, full, btcUsd);
}
export const primaryAddress = () => hlState().address;
