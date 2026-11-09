/**
 * Portfólio Consolidado no app: junta as fontes (Estratégia/Hyperliquid, cadastros manuais, CSV e, nas próximas
 * fases, OKX e carteiras) e entrega a consolidação do @bst/domain. Nunca escreve nos dados da Estratégia.
 */
import { effectiveHoldings } from "../wallets";
import { classifyFlows, consolidate, exchangeEcon, portfolioReturns, type PAccount, type PHolding, type PPosition, type PriceBook } from "@bst/domain";
import { compute } from "../local/engine";
import { getStore } from "../local/store";
import { hlState } from "../local/hl";
import { prices as btcPrices } from "../local/prices";
import { portfolio, updatePortfolio, uidP } from "./db";

/** Ids CoinGecko dos ativos econômicos conhecidos. Outros ativos: id informado pelo usuário ou preço manual. */
export const CG_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", HYPE: "hyperliquid", ZEC: "zcash", BNB: "binancecoin",
  USDC: "usd-coin", USDT: "tether", DAI: "dai",
};

let book: PriceBook = {};
let bookAt = 0;
let bookError: string | null = null;
const subs = new Set<() => void>();
export const subscribePortfolioPrices = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const priceBookInfo = () => ({ at: bookAt, error: bookError });

/** Cotações em USD (CoinGecko, com variação de 24 h). O BTC usa a mesma cotação da Estratégia. */
export async function refreshPortfolioPrices(): Promise<void> {
  const p = portfolio();
  const econs = new Set<string>(["BTC", "USDC", "USDT"]);
  for (const h of [...p.manual, ...p.synced]) econs.add(h.econ);
  const ids = new Map<string, string>();
  for (const e of econs) { const id = p.priceIds[e] ?? CG_IDS[e]; if (id) ids.set(e, id); }
  try {
    const q = [...new Set(ids.values())].join(",");
    if (q) {
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(q)}&vs_currencies=usd&include_24hr_change=true`);
      if (!r.ok) throw new Error(`CoinGecko respondeu ${r.status}`);
      const j = (await r.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
      const next: PriceBook = {};
      for (const [e, id] of ids) { const v = j[id]; if (v?.usd) next[e] = { usd: v.usd, change24h: v.usd_24h_change != null ? v.usd_24h_change / 100 : null, at: Date.now(), source: "CoinGecko" }; }
      book = { ...book, ...next }; bookAt = Date.now(); bookError = null;
    }
  } catch (e) { bookError = (e as Error).message; }
  subs.forEach((f) => f());
}

/** Livro de preços efetivo: CoinGecko + BTC da Estratégia + preços manuais (marcados como manuais). */
export function priceBook(): PriceBook {
  const p = portfolio();
  const out: PriceBook = { ...book };
  const spot = btcPrices().spot?.btcUsd;
  if (spot) out.BTC = { usd: spot, change24h: out.BTC?.change24h ?? null, at: btcPrices().spot?.at ?? Date.now(), source: btcPrices().spot?.source };
  for (const [e, v] of Object.entries(p.manualPrices)) if (!out[e] && v > 0) out[e] = { usd: v, source: "preço manual" };
  return out;
}

const STRATEGY_ID = "strategy";

/** Conta da Estratégia BTC/USDC no portfólio: o patrimônio real dela agora (não o resultado do ciclo). */
function strategySource(): { account: PAccount; holdings: PHolding[]; positions: PPosition[] } | null {
  const s = getStore();
  const hl = hlState();
  const addr = s.settings.hl?.address?.toLowerCase();
  const now = Date.now();
  if (addr && hl.live && hl.address === addr) {
    const account: PAccount = { id: STRATEGY_ID, kind: "hyperliquid", name: "Hyperliquid (Estratégia BTC/USDC)", institution: "Hyperliquid", network: "hyperliquid", addresses: [addr], createdAt: 0 };
    const holdings: PHolding[] = hl.live.balances.filter((b) => b.where !== "arb").map((b) => {
      const id = exchangeEcon(b.coin);
      const isPerp = b.where === "perp";
      return {
        accountId: STRATEGY_ID, assetKey: `hl:${b.where}:${b.coin}`, econ: isPerp ? "USDC" : id.econ, symbol: isPerp ? "USDC" : b.coin,
        name: isPerp ? "Patrimônio da conta perp (margem + P&L aberto)" : undefined, network: "hyperliquid", qty: String(b.total),
        valueUsd: isPerp ? b.usd : null, kind: isPerp ? "equity" : "spot", source: "sync", wrapped: !isPerp && id.wrapped, at: hl.live!.at,
      };
    });
    // conta unificada: o colateral está no saldo spot e o P&L aberto das posições fica à parte (a Hyperliquid soma os dois)
    if (hl.live.mode === "unifiedAccount" || hl.live.mode === "portfolioMargin") {
      const upnl = hl.live.positions.reduce((x, p) => x + p.upnl, 0);
      if (upnl) holdings.push({ accountId: STRATEGY_ID, assetKey: "hl:upnl", econ: "USDC", symbol: "USDC", name: "P&L aberto das posições (conta unificada)", network: "hyperliquid", qty: String(upnl), valueUsd: upnl, kind: "equity", source: "sync", at: hl.live.at });
    }
    const positions: PPosition[] = hl.live.positions.map((p) => ({
      accountId: STRATEGY_ID, instrument: `${p.coin}-PERP`, dir: p.szi > 0 ? "LONG" : "SHORT", size: Math.abs(p.szi), entry: p.entryPx, mark: p.posValue && p.szi ? Math.abs(p.posValue / p.szi) : null,
      notional: Math.abs(p.posValue), margin: p.marginUsed, upnl: p.upnl, liq: p.liqPx, leverage: p.leverage, funding: p.fundingSinceOpen, at: hl.live!.at,
    }));
    return { account, holdings, positions };
  }
  // lançamento manual: o modelo da conta (todos os lançamentos) dá o patrimônio atual
  try {
    const r = compute("account");
    const account: PAccount = { id: STRATEGY_ID, kind: "strategy", name: "Estratégia BTC/USDC (lançamento manual)", institution: "Estratégia BTC/USDC", network: "hyperliquid", createdAt: 0 };
    const holdings: PHolding[] = [{ accountId: STRATEGY_ID, assetKey: "strategy:equity", econ: "USDC", symbol: "USDC", name: "Patrimônio da estratégia (margem + P&L aberto)", network: "hyperliquid", qty: r.equity.toFixed(2), valueUsd: r.equity.toNumber(), kind: "equity", source: "manual", at: now }];
    const positions: PPosition[] = r.current ? [{ accountId: STRATEGY_ID, instrument: "BTC-PERP", dir: r.current.dir, size: Math.abs(r.current.sizeBtc.toNumber()), entry: r.current.officialEntry, mark: r.now.btcUsd.toNumber(), notional: r.current.notional, margin: r.current.cycle ? Number(r.current.cycle.capital) : null, upnl: r.unrealized, liq: r.current.liq?.toNumber() ?? null, leverage: r.current.effLeverage, funding: r.current.funding, at: now }] : [];
    return { account, holdings, positions };
  } catch { return null; }
}

/** Fotografia completa do portfólio para as telas. */
export function portfolioView() {
  const p = portfolio();
  const strat = strategySource();
  const accounts = [...(strat ? [strat.account] : []), ...p.accounts];
  const holdings = effectiveHoldings(accounts, [...(strat?.holdings ?? []), ...p.manual, ...p.synced]);
  const positions = [...(strat?.positions ?? []), ...p.positions];
  const prices = priceBook();
  const c = consolidate(accounts, holdings, prices);
  // movimentações: as do portfólio + aportes/retiradas da Estratégia (para a rentabilidade da conta dela)
  let stratFlows: { t: number; accountId: string; usd: number }[] = [];
  try { stratFlows = compute("account").events.filter((e) => e.k === "flow").map((e) => ({ t: e.t, accountId: STRATEGY_ID, usd: (e as { usd: number }).usd })); } catch { /* sem estratégia */ }
  const classified = classifyFlows(p.events, accounts);
  const flows = [
    ...stratFlows,
    // pendentes contam como aporte/retirada até o usuário classificar: entrada não classificada nunca vira lucro
    ...classified.filter((e) => (e.cls === "external" || e.cls === "pending" || e.kind === "adjust") && e.usd != null).map((e) => ({ t: e.t, accountId: e.accountId, usd: (e.kind === "withdraw" || e.kind === "transfer_out" ? -1 : 1) * Math.abs(e.usd!) })),
  ];
  const series = portfolioReturns(p.snapshots, flows);
  return { accounts, holdings, positions, prices, c, classified, series, pending: classified.filter((e) => e.cls === "pending") };
}

/** Grava um retrato (no máximo um por hora) para a evolução patrimonial. */
export function recordSnapshot(force = false) {
  const p = portfolio();
  const v = portfolioView();
  if (!v.c.byAccount.length) return;
  const last = p.snapshots[p.snapshots.length - 1];
  if (!force && last && Date.now() - last.t < 3600e3) return;
  const byAccount = Object.fromEntries(v.c.byAccount.map((a) => [a.accountId, Math.round(a.valueUsd * 100) / 100]));
  void updatePortfolio((d) => { d.snapshots.push({ t: Date.now(), byAccount }); if (d.snapshots.length > 5000) d.snapshots = d.snapshots.slice(-5000); });
}

// ───────── cadastro manual ─────────

export interface ManualInput { institution: string; name: string; symbol: string; qty: string; network?: string; date?: string; costUsd?: string; note?: string; cgId?: string; manualPrice?: string }

/** Conta manual por instituição (reaproveita a existente com o mesmo nome). */
function manualAccountId(d: ReturnType<typeof portfolio>, institution: string): string {
  const name = institution.trim() || "Cadastro manual";
  const a = d.accounts.find((x) => x.kind === "manual" && x.institution.toLowerCase() === name.toLowerCase());
  if (a) return a.id;
  const id = "m-" + uidP();
  d.accounts.push({ id, kind: "manual", name, institution: name, createdAt: Date.now() });
  return id;
}

/** Valor em USD de um saldo, com o livro de preços atual (para o ajuste de cadastro). */
function valueNow(h: PHolding): number | null {
  const px = h.priceUsd ?? priceBook()[h.econ]?.usd ?? null;
  return px != null ? Number(h.qty) * px : null;
}

/**
 * Salva um saldo manual. Cadastrar ou alterar um saldo gera um "ajuste de cadastro" (não é lucro nem aporte):
 * a rentabilidade do portfólio desconsidera a diferença de valor.
 */
export function saveManualHolding(input: ManualInput, editKey?: string) {
  const sym = input.symbol.trim().toUpperCase();
  const id = exchangeEcon(sym);
  const econ = id.econ;
  return updatePortfolio((d) => {
    const accountId = manualAccountId(d, input.institution);
    const assetKey = `manual:${(input.network || "").toLowerCase() || "geral"}:${sym}`;
    const prev = editKey ? d.manual.find((h) => `${h.accountId}|${h.assetKey}` === editKey) : d.manual.find((h) => h.accountId === accountId && h.assetKey === assetKey);
    const at = input.date ? new Date(`${input.date}T12:00`).getTime() : Date.now();
    const h: PHolding = {
      accountId, assetKey, econ, symbol: sym, name: input.name.trim() || sym, network: input.network?.trim() || "—", qty: input.qty,
      kind: "spot", source: "manual", wrapped: id.wrapped, costUsd: input.costUsd ? Number(input.costUsd) : null, at, note: input.note?.trim() || undefined,
    };
    if (input.cgId?.trim()) d.priceIds[econ] = input.cgId.trim().toLowerCase();
    if (input.manualPrice && Number(input.manualPrice) > 0) d.manualPrices[econ] = Number(input.manualPrice);
    d.manual = d.manual.filter((x) => x !== prev && !(x.accountId === accountId && x.assetKey === assetKey));
    d.manual.push(h);
    const delta = (valueNow(h) ?? 0) - (prev ? valueNow(prev) ?? 0 : 0);
    if (delta) d.events.push({ id: "adj-" + uidP(), accountId, t: Date.now(), kind: "adjust", econ, qty: Number(h.qty) - (prev ? Number(prev.qty) : 0), usd: delta, note: prev ? "alteração de saldo manual" : "cadastro de saldo manual" });
  }).then(() => { if (!priceBook()[econ]) void refreshPortfolioPrices(); });
}
export function removeManualHolding(key: string) {
  return updatePortfolio((d) => {
    const h = d.manual.find((x) => `${x.accountId}|${x.assetKey}` === key);
    if (!h) return;
    d.manual = d.manual.filter((x) => x !== h);
    const v = valueNow(h);
    if (v) d.events.push({ id: "adj-" + uidP(), accountId: h.accountId, t: Date.now(), kind: "adjust", econ: h.econ, qty: -Number(h.qty), usd: -v, note: "remoção de saldo manual" });
  });
}
/** Aporte ou retirada externa registrada à mão numa conta do portfólio. */
export function addManualFlow(accountId: string, kind: "deposit" | "withdraw", usd: number, at: number, note?: string) {
  return updatePortfolio((d) => { d.events.push({ id: "mf-" + uidP(), accountId, t: at, kind, econ: "USD", qty: usd, usd, note }); });
}
/** Classificação manual de uma movimentação pendente. */
export function resolvePending(id: string, as: "internal" | "deposit" | "withdraw") {
  return updatePortfolio((d) => {
    const e = d.events.find((x) => x.id === id);
    if (!e) return;
    if (as === "internal") e.kind = "adjust"; else e.kind = as;
    e.note = `${e.note ? e.note + " · " : ""}classificado pelo usuário`;
  });
}

// ───────── importação CSV ─────────

/**
 * Importa saldos de um CSV com cabeçalho. Colunas aceitas (ordem livre, ; ou ,):
 * instituicao, ativo (símbolo), quantidade, nome, rede, data, custo_usd, observacao.
 * Devolve quantas linhas entraram e os erros por linha. Nada é gravado se nenhuma linha for válida.
 */
export function parseHoldingsCsv(text: string): { rows: ManualInput[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ["O arquivo precisa de um cabeçalho e ao menos uma linha."] };
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (l: string) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]!).map((h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = { inst: col("instituicao", "custodia", "exchange", "carteira"), sym: col("ativo", "simbolo", "symbol"), qty: col("quantidade", "qtd", "amount"), name: col("nome", "name"), net: col("rede", "network", "blockchain"), date: col("data", "date"), cost: col("custo_usd", "custo", "cost"), note: col("observacao", "obs", "note") };
  if (ci.sym < 0 || ci.qty < 0) return { rows: [], errors: ["Faltam as colunas obrigatórias “ativo” e “quantidade”."] };
  const num = (v: string | undefined) => (v ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const rows: ManualInput[] = [], errors: string[] = [];
  lines.slice(1).forEach((l, i) => {
    const c = split(l);
    const qty = num(c[ci.qty]);
    if (!c[ci.sym] || !(Number(qty) >= 0) || qty === "") { errors.push(`Linha ${i + 2}: ativo ou quantidade inválidos.`); return; }
    const cost = ci.cost >= 0 ? num(c[ci.cost]) : "";
    rows.push({ institution: ci.inst >= 0 ? c[ci.inst] ?? "" : "Importação CSV", symbol: c[ci.sym]!, qty, name: ci.name >= 0 ? c[ci.name] ?? "" : "", network: ci.net >= 0 ? c[ci.net] : undefined, date: ci.date >= 0 ? c[ci.date] : undefined, costUsd: cost && Number(cost) >= 0 ? cost : undefined, note: ci.note >= 0 ? c[ci.note] : undefined });
  });
  return { rows, errors };
}
export async function importHoldingsCsv(rows: ManualInput[]) { for (const r of rows) await saveManualHolding(r); await refreshPortfolioPrices(); }
