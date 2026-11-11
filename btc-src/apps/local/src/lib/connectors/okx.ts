/**
 * OKX pelo gateway seguro (mesmo endereço do app, protegido pelo Cloudflare Access).
 * O navegador NUNCA guarda as credenciais: elas vão uma vez, por HTTPS, para o gateway, que valida (somente
 * leitura), cifra e guarda. Daqui só saem saldos e posições já normalizados.
 */
import type { PEvent, PHolding, PPosition } from "@bst/domain";
import { portfolio, updatePortfolio } from "../portfolio/db";
import { refreshPortfolioPrices } from "../portfolio/engine";
import { closeUsdAt } from "../local/prices";

let gw: { ok: boolean; checked: boolean; solanaTokens: boolean } = { ok: false, checked: false, solanaTokens: false };
export const gatewayInfo = () => gw;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const ct = r.headers.get("Content-Type") ?? "";
  if (!ct.includes("application/json")) throw new Error(r.status === 401 || r.status === 403 ? "Sessão do Cloudflare Access expirada: recarregue a página para entrar de novo." : "Gateway indisponível.");
  const j = (await r.json()) as T & { ok?: boolean; error?: string };
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `Gateway respondeu ${r.status}.`);
  return j;
}

/** Descobre se o app está rodando pelo gateway (só lá existe /api). */
export async function detectGateway(): Promise<boolean> {
  try {
    const h = await api<{ features: { solanaTokens: boolean } }>("/api/health");
    gw = { ok: true, checked: true, solanaTokens: h.features.solanaTokens };
  } catch { gw = { ok: false, checked: true, solanaTokens: false }; }
  return gw.ok;
}

export interface OkxMeta { label: string; ipBound: boolean; perms: string[]; connectedAt: number; keyHint: string }
export const okxStatus = () => api<{ connected: boolean; meta: OkxMeta | null }>("/api/okx/status");
export async function okxConnect(apiKey: string, secret: string, passphrase: string) {
  const r = await api<{ meta: OkxMeta }>("/api/okx/credentials", { method: "POST", body: JSON.stringify({ apiKey, secret, passphrase }) });
  await syncOkx();
  return r.meta;
}
export async function okxRevoke() {
  await api("/api/okx/credentials", { method: "DELETE" });
  await updatePortfolio((d) => {
    const ids = new Set(["okx-funding", "okx-trading", "okx-earn"]);
    d.accounts = d.accounts.filter((a) => !ids.has(a.id));
    d.synced = d.synced.filter((h) => !ids.has(h.accountId));
    d.positions = d.positions.filter((p) => !ids.has(p.accountId));
    for (const id of ids) delete d.sync[id];
  });
}

type Snap = { at: number; holdings: PHolding[]; positions: PPosition[]; events: PEvent[]; accounts: { id: string; name: string }[]; warnings: string[]; sources?: Record<string, boolean>; positionsOk?: boolean; historyComplete?: boolean };
const STABLE = new Set(["USDC", "USDT", "DAI"]);

export async function syncOkx(): Promise<void> {
  if (!gw.ok) return;
  const ids = ["okx-funding", "okx-trading", "okx-earn"];
  await updatePortfolio((d) => { for (const id of ids) d.sync[id] = { state: "sync", at: d.sync[id]?.at ?? 0 }; });
  try {
    const { snapshot: s } = await api<{ snapshot: Snap; cached: boolean }>("/api/okx/snapshot");
    await updatePortfolio((d) => {
      for (const a of s.accounts) if (!d.accounts.some((x) => x.id === a.id)) d.accounts.push({ id: a.id, kind: "okx", name: a.name, institution: "OKX", network: "OKX", createdAt: Date.now() });
      const successful = new Set(ids.filter((id) => s.sources?.[id] === true));
      // Gateway anterior sem contrato de cobertura não pode apagar o último saldo conhecido.
      if (!s.sources) for (const h of s.holdings) successful.add(h.accountId);
      d.synced = [...d.synced.filter((h) => !successful.has(h.accountId)), ...s.holdings.filter((h) => successful.has(h.accountId))];
      if (s.positionsOk !== false) d.positions = [...d.positions.filter((p) => !ids.includes(p.accountId)), ...s.positions];
      const m = new Map(d.events.map((e) => [e.id, e]));
      // valor em USD do depósito/saque no dia: estáveis = 1; BTC pelo fechamento diário; outros ficam sem valor
      for (const e of s.events) { const previous = m.get(e.id); const usd = e.usd ?? (STABLE.has(e.econ) ? e.qty : e.econ === "BTC" ? (closeUsdAt(Math.floor(e.t / 1000)) ?? 0) * e.qty || null : null); m.set(e.id, { ...e, usd, ...(previous?.classification ? { classification: previous.classification, kind: previous.kind, note: previous.note } : {}) }); }
      d.events = [...m.values()];
      const info = s.warnings.length ? s.warnings.join(" · ") : "somente leitura";
      for (const id of ids) d.sync[id] = { state: successful.has(id) && s.positionsOk !== false ? "ok" : "partial", at: successful.has(id) ? s.at : d.sync[id]?.at ?? 0, info, historyComplete: s.historyComplete === true };
    });
    void refreshPortfolioPrices();
  } catch (e) {
    await updatePortfolio((d) => { for (const id of ids) d.sync[id] = { state: "error", at: Date.now(), error: (e as Error).message }; });
  }
}

/** Tokens SPL pelo RPC indexado do gateway (quando configurado). */
export async function solanaTokensViaGateway(address: string): Promise<{ mint: string; amount: string; decimals: number }[] | null> {
  if (!gw.ok || !gw.solanaTokens) return null;
  return (await api<{ tokens: { mint: string; amount: string; decimals: number }[] }>(`/api/solana/tokens?address=${encodeURIComponent(address)}`)).tokens;
}
export const okxConnectedLocally = () => portfolio().accounts.some((a) => a.kind === "okx");
