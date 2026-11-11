/**
 * Cliente OKX API v5 SOMENTE LEITURA. Endpoints e campos conferidos na documentação oficial
 * (https://www.okx.com/docs-v5/en/, consultada em 07/11/2026). Nenhum endpoint de escrita é usado.
 *
 * Contabilidade (sem contagem dupla):
 * - conta de trading: cada moeda entra pelo patrimônio da moeda (`eq`, já com P&L aberto) e valor `eqUsd`;
 *   posições são listadas à parte e nunca somadas (o nocional também não);
 * - conta de funding: `bal` por moeda (o app precifica);
 * - Simple Earn: `amt` por moeda, como conta separada.
 */
import { okxSign } from "./security";

export const OKX = "https://www.okx.com";
export interface OkxCreds { apiKey: string; secret: string; passphrase: string }
type Resp<T> = { code: string; msg: string; data: T };

/** Mensagens para os códigos de erro documentados. */
const ERR: Record<string, string> = {
  "50011": "A OKX limitou as consultas (limite de requisições). Tente de novo em alguns segundos.",
  "50102": "Relógio fora de sincronia com a OKX (timestamp expirado).",
  "50105": "Passphrase da API incorreta.",
  "50110": "O IP do gateway não está na lista de IPs da chave. Use uma chave somente leitura sem IP vinculado.",
  "50111": "API Key inválida.",
  "50113": "Assinatura inválida: confira a Secret Key.",
  "50114": "Autorização inválida.",
  "50119": "Esta API Key não existe.",
  "50120": "Esta API Key não tem permissão para esta consulta.",
};
export class OkxError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export async function okxGet<T>(c: OkxCreds | null, path: string, f: typeof fetch = fetch): Promise<T> {
  const ts = new Date().toISOString();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (c) {
    headers["OK-ACCESS-KEY"] = c.apiKey;
    headers["OK-ACCESS-SIGN"] = await okxSign(c.secret, ts, "GET", path);
    headers["OK-ACCESS-TIMESTAMP"] = ts;
    headers["OK-ACCESS-PASSPHRASE"] = c.passphrase;
  }
  const r = await f(OKX + path, { method: "GET", headers, signal: AbortSignal.timeout(12000) });
  let j: Resp<T>;
  try { j = (await r.json()) as Resp<T>; } catch { throw new OkxError(String(r.status), `A OKX respondeu ${r.status}.`); }
  if (r.status === 429 || j.code === "50011") throw new OkxError("50011", ERR["50011"]!);
  if (j.code !== "0") throw new OkxError(j.code, ERR[j.code] ?? `A OKX recusou a consulta (código ${j.code}).`);
  return j.data;
}

/** Permissões da chave (account/config.perm: "read_only", "trade", "withdraw", separadas por vírgula). */
export async function keyInfo(c: OkxCreds, f: typeof fetch = fetch) {
  const [cfg] = await okxGet<{ perm: string; label?: string; ip?: string; uid?: string }[]>(c, "/api/v5/account/config", f);
  const perms = (cfg?.perm ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return { perms, label: cfg?.label ?? "", ipBound: Boolean(cfg?.ip), readOnly: perms.length > 0 && perms.every((p) => p === "read_only") };
}

// ───────── normalização (formato do Portfólio do app) ─────────

export interface NHolding { accountId: string; assetKey: string; econ: string; symbol: string; network: string; qty: string; available?: string; locked?: string; valueUsd?: number | null; kind: "spot" | "equity" | "earn"; quantityKind?: "asset" | "account"; custodyQty?: string | null; source: "sync"; at: number; name?: string }
export interface NPosition { accountId: string; instrument: string; dir: "LONG" | "SHORT"; size: number; sizeUnit?: "base" | "contracts"; entry: number | null; mark: number | null; notional: number | null; margin: number | null; upnl: number | null; liq: number | null; leverage: number | null; at: number }
export interface NEvent { id: string; accountId: string; t: number; kind: "deposit" | "withdraw" | "adjust"; econ: string; qty: number; usd: number | null; txid: string | null; counterparty: string | null; note: string }
export interface OkxSnapshot { at: number; totalEqUsd: number | null; holdings: NHolding[]; positions: NPosition[]; events: NEvent[]; accounts: { id: string; name: string }[]; warnings: string[]; sources?: Record<string, boolean>; positionsOk?: boolean; historyComplete?: boolean }

const n = (v: string | undefined) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** Símbolos com identidade econômica conhecida (o resto fica no próprio grupo, sem palpite). */
const ECON: Record<string, string> = { BTC: "BTC", ETH: "ETH", SOL: "SOL", USDC: "USDC", USDT: "USDT", HYPE: "HYPE", ZEC: "ZEC", BNB: "BNB", DAI: "DAI" };
const econOf = (ccy: string) => ECON[ccy.toUpperCase()] ?? ccy.toUpperCase();

type Bal = { totalEq: string; details: { ccy: string; eq: string; cashBal: string; availBal: string; frozenBal: string; eqUsd: string; upl: string }[] };
type Fund = { ccy: string; bal: string; frozenBal: string; availBal: string };
type Pos = { instType: string; instId: string; mgnMode: string; posSide: string; pos: string; avgPx: string; markPx: string; upl: string; notionalUsd: string; lever: string; liqPx: string; margin: string; imr: string; ccy: string };
type Inst = { instId: string; ctVal: string; ctValCcy: string; ctMult?: string };
type Sav = { ccy: string; amt: string; earnings: string };
type Dep = { ccy: string; chain: string; amt: string; txId: string; ts: string; state: string; depId: string; from: string; to: string };
type Wd = { ccy: string; chain: string; amt: string; txId: string; ts: string; state: string; wdId: string; to: string; fee: string; feeCcy: string };
export async function pagedHistory<T extends { ts: string; billId?: string }>(c: OkxCreds, path: string, f: typeof fetch, cursorKind: "time" | "bill" = "time"): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = []; let after = "";
  for (let i = 0; i < 20; i++) {
    const page = await okxGet<T[]>(c, `${path}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, f);
    if (!Array.isArray(page)) throw new OkxError("FORMAT", "Histórico da OKX em formato inválido.");
    rows.push(...page);
    if (page.length < 100) return { rows, complete: true };
    const next = cursorKind === "bill" ? page.at(-1)?.billId : String(Math.min(...page.map((r) => Number(r.ts))));
    if (!next || next === after) return { rows, complete: false };
    after = next;
  }
  return { rows, complete: false };
}

export function normalize(a: { bal?: Bal; fund?: Fund[]; pos?: Pos[]; inst?: Inst[]; sav?: Sav[]; dep?: Dep[]; wd?: Wd[] }, at = Date.now()): OkxSnapshot {
  const holdings: NHolding[] = [], positions: NPosition[] = [], events: NEvent[] = [], warnings: string[] = [];
  for (const d of a.bal?.details ?? []) {
    if (!Number(d.eq)) continue;
    holdings.push({ accountId: "okx-trading", assetKey: `okx:trading:${d.ccy}`, econ: econOf(d.ccy), symbol: d.ccy, network: "OKX", qty: d.eq, quantityKind: "asset", custodyQty: n(d.cashBal) != null ? String(Math.max(0, Number(d.cashBal))) : null, available: d.availBal || undefined, locked: d.frozenBal || undefined, valueUsd: n(d.eqUsd), kind: "equity", source: "sync", at, name: Number(d.upl) ? "patrimônio da moeda (inclui P&L aberto)" : undefined });
  }
  for (const d of a.fund ?? []) {
    if (!Number(d.bal)) continue;
    holdings.push({ accountId: "okx-funding", assetKey: `okx:funding:${d.ccy}`, econ: econOf(d.ccy), symbol: d.ccy, network: "OKX", qty: d.bal, available: d.availBal, locked: d.frozenBal, kind: "spot", source: "sync", at });
  }
  for (const d of a.sav ?? []) {
    if (!Number(d.amt)) continue;
    holdings.push({ accountId: "okx-earn", assetKey: `okx:earn:${d.ccy}`, econ: econOf(d.ccy), symbol: d.ccy, network: "OKX", qty: d.amt, kind: "earn", source: "sync", at, name: "Simple Earn" });
  }
  const ct = new Map((a.inst ?? []).map((i) => [i.instId, i]));
  for (const p of a.pos ?? []) {
    const pos = Number(p.pos);
    if (!pos) continue;
    // pos = número de CONTRATOS em SWAP/FUTURES (documentação): tamanho no ativo = |pos| × ctVal × ctMult
    const inst = ct.get(p.instId);
    const contractsValue = inst ? Math.abs(pos) * Number(inst.ctVal) * Number(inst.ctMult || 1) : null;
    const base = p.instId.split("-")[0];
    const size = inst?.ctValCcy === base ? contractsValue : inst?.ctValCcy === "USD" && n(p.markPx) && Number(p.markPx) > 0 ? contractsValue! / Number(p.markPx) : p.instType === "SPOT" || p.instType === "MARGIN" ? Math.abs(pos) : null;
    if (!inst && (p.instType === "SWAP" || p.instType === "FUTURES")) warnings.push(`Tamanho de ${p.instId} em contratos (valor do contrato indisponível).`);
    const dir: "LONG" | "SHORT" = p.posSide === "short" ? "SHORT" : p.posSide === "long" ? "LONG" : pos > 0 ? "LONG" : "SHORT";
    positions.push({ accountId: "okx-trading", instrument: p.instId, dir, size: size ?? Math.abs(pos), sizeUnit: size == null ? "contracts" : "base", entry: n(p.avgPx), mark: n(p.markPx), notional: n(p.notionalUsd), margin: n(p.margin) ?? n(p.imr), upnl: n(p.upl), liq: n(p.liqPx), leverage: n(p.lever), at });
  }
  // depósitos e saques concluídos (estado 2 = sucesso nos depósitos; saques: "2" = sucesso)
  for (const d of a.dep ?? []) if (d.state === "2") events.push({ id: `okx:dep:${d.depId}`, accountId: "okx-funding", t: Number(d.ts), kind: "deposit", econ: econOf(d.ccy), qty: Number(d.amt), usd: null, txid: d.txId || null, counterparty: null, note: `Depósito ${d.ccy}${d.chain ? ` (${d.chain})` : ""}` });
  for (const w of a.wd ?? []) if (w.state === "2") events.push({ id: `okx:wd:${w.wdId}`, accountId: "okx-funding", t: Number(w.ts), kind: "withdraw", econ: econOf(w.ccy), qty: Number(w.amt), usd: null, txid: w.txId || null, counterparty: w.to || null, note: `Saque ${w.ccy}${w.chain ? ` (${w.chain})` : ""}${Number(w.fee) ? ` · taxa ${w.fee} ${w.feeCcy}` : ""}` });
  return {
    at, totalEqUsd: a.bal ? n(a.bal.totalEq) : null, holdings, positions, events, warnings,
    accounts: [{ id: "okx-funding", name: "OKX · Funding" }, { id: "okx-trading", name: "OKX · Trading" }, { id: "okx-earn", name: "OKX · Earn" }],
  };
}

/** Lê tudo o que a integração mostra. Cada parte que falhar vira aviso, sem derrubar as outras. */
export async function fetchSnapshot(c: OkxCreds, f: typeof fetch = fetch): Promise<OkxSnapshot> {
  const warnings: string[] = [];
  const safe = async <T>(label: string, p: () => Promise<T>): Promise<T | undefined> => {
    try { return await p(); } catch (e) { if (e instanceof OkxError && ["50105", "50111", "50113", "50114", "50119"].includes(e.code)) throw e; warnings.push(`${label}: ${(e as Error).message}`); return undefined; }
  };
  const [bal] = (await safe("Conta de trading", () => okxGet<Bal[]>(c, "/api/v5/account/balance", f))) ?? [];
  const fund = await safe("Conta de funding", () => okxGet<Fund[]>(c, "/api/v5/asset/balances", f));
  const pos = await safe("Posições", () => okxGet<Pos[]>(c, "/api/v5/account/positions", f));
  const sav = await safe("Simple Earn", () => okxGet<Sav[]>(c, "/api/v5/finance/savings/balance", f));
  const depPage = await safe("Depósitos", () => pagedHistory<Dep>(c, "/api/v5/asset/deposit-history", f));
  const wdPage = await safe("Saques", () => pagedHistory<Wd>(c, "/api/v5/asset/withdrawal-history", f));
  const dep = depPage?.rows, wd = wdPage?.rows;
  type Bill = { billId: string; ts: string; ccy: string; balChg: string; type: string; subType?: string; from?: string; to?: string };
  const tradingBills = await safe("Bills trading", () => pagedHistory<Bill>(c, "/api/v5/account/bills", f, "bill"));
  const fundingBills = await safe("Bills funding", () => pagedHistory<Bill>(c, "/api/v5/asset/bills", f, "bill"));
  const inst: Inst[] = [];
  for (const id of [...new Set((pos ?? []).filter((p) => p.instType === "SWAP" || p.instType === "FUTURES").map((p) => `${p.instType}|${p.instId}`))]) {
    const [type, instId] = id.split("|") as [string, string];
    const r = await safe(`Contrato ${instId}`, () => okxGet<Inst[]>(null, `/api/v5/public/instruments?instType=${type}&instId=${encodeURIComponent(instId)}`, f));
    if (r?.[0]) inst.push(r[0]);
  }
  const s = normalize({ bal, fund, pos, inst, sav, dep, wd });
  s.warnings.push(...warnings);
  s.sources = { "okx-trading": bal != null, "okx-funding": fund != null, "okx-earn": sav != null };
  s.positionsOk = pos != null;
  s.historyComplete = false; // bills e cobertura por conta são obrigatórios para rentabilidade completa.
  // Movimentações internas alteram o valor de CADA conta, mas a soma dos ajustes é neutra.
  // O esquema emitido é deliberadamente conservador: cobertura integral só após reconciliação das categorias.
  for (const [accountId, list] of [["okx-trading", tradingBills?.rows], ["okx-funding", fundingBills?.rows]] as const) {
    for (const b of list ?? []) {
      const transfer = accountId === "okx-trading" ? b.type === "1" && (b.from === "6" || b.to === "6") : ["130", "131", "75", "76"].includes(b.type);
      if (!transfer || !Number.isFinite(Number(b.balChg))) continue;
      const qty = Number(b.balChg);
      const event: NEvent = { id: `okx:bill:${accountId}:${b.billId}`, accountId, t: Number(b.ts), kind: "adjust", econ: econOf(b.ccy), qty, usd: ["USDC", "USDT", "DAI"].includes(b.ccy) ? qty : null, txid: null, counterparty: null, note: `Transferência por conta · bill ${b.billId}` };
      s.events.push(event);
      if (accountId === "okx-funding" && ["75", "76"].includes(b.type)) s.events.push({ ...event, id: event.id + ":earn", accountId: "okx-earn", qty: -event.qty, usd: event.usd == null ? null : -event.usd });
    }
  }
  if (!depPage?.complete || !wdPage?.complete || !tradingBills?.complete || !fundingBills?.complete) s.warnings.push("Histórico parcial: paginação atingiu o limite ou uma fonte de bills falhou.");
  s.warnings.push("Rentabilidade OKX indisponível enquanto a cobertura dos fluxos por conta não for conciliada; saldos oficiais continuam disponíveis.");
  return s;
}
