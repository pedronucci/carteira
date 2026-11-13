/**
 * Dados do Portfólio Consolidado no IndexedDB (banco "bst5"), separados dos dados da Estratégia
 * (localStorage "bst.local.v2", que não é tocado). Nada sai deste aparelho.
 *
 * Coleções: contas, saldos (manuais e lidos das fontes), movimentações, retratos (evolução) e preferências.
 * Em memória fica uma cópia para leitura síncrona pelas telas; cada gravação vai para o IndexedDB.
 */
import type { PlannedLevel, HistoricLevel } from "../perps/chart-lines";
import type { TradeNote } from "../journal/types";
import { migrateSnapshots, type JournalEntry, type PAccount, type PEvent, type PHolding, type PPosition, type PSnapshot } from "@bst/domain";
import { finite, nonempty, record, rows, unique } from "../validation";

export interface PortfolioData {
  v: 1;
  accounts: PAccount[];
  /** saldos cadastrados à mão ou importados por CSV (fonte de verdade é o usuário) */
  manual: PHolding[];
  /** saldos lidos das integrações (cache da última leitura; sempre refeitos na sincronização) */
  synced: PHolding[];
  positions: PPosition[];
  events: PEvent[];
  snapshots: PSnapshot[];
  /** id CoinGecko por ativo econômico (para ativos fora do registro) e preço manual */
  priceIds: Record<string, string>;
  manualPrices: Record<string, number>;
  /** estado da última sincronização de cada conta conectada */
  sync: Record<string, { state: "ok" | "error" | "sync" | "partial"; at: number; error?: string; info?: string; historyComplete?: boolean }>;
  /** Trading Journal: independente da contabilidade patrimonial */
  journal: JournalEntry[];
  /** níveis planejados pelo usuário (TP/SL/entrada). NÃO são ordens da exchange. */
  plans: PlannedLevel[];
  /** anotações de cada operação do Trading Journal, por id da operação (conta|primeira execução) */
  tradeNotes: Record<string, TradeNote>;
  /** TP/SL reais vistos na exchange durante cada operação (continuam no gráfico depois do encerramento) */
  levelHistory: Record<string, HistoricLevel[]>;
}

const DB = "bst5", STORE = "kv", KEY = "portfolio";
const EMPTY = (): PortfolioData => ({ v: 1, accounts: [], manual: [], synced: [], positions: [], events: [], snapshots: [], priceIds: {}, manualPrices: {}, sync: {}, journal: [], plans: [], tradeNotes: {}, levelHistory: {} });

let data: PortfolioData = EMPTY();
let ready = false;
let lastError: string | null = null;
const subs = new Set<() => void>();
export const subscribePortfolio = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach((f) => f());
export const portfolio = () => data;
export const portfolioReady = () => ready;
export const portfolioError = () => lastError;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("Este navegador não oferece IndexedDB."));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("Falha ao abrir o banco local."));
  });
}
async function readRaw(): Promise<PortfolioData | null> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    q.onsuccess = () => { db.close(); res((q.result as PortfolioData | undefined) ?? null); };
    q.onerror = () => { db.close(); rej(q.error); };
  });
}
async function writeRaw(d: PortfolioData): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(d, KEY);
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = () => { db.close(); rej(tx.error ?? new Error("Falha ao gravar no banco local.")); };
    tx.onabort = () => { db.close(); rej(tx.error ?? new Error("Gravação interrompida.")); };
  });
}

export function validatePortfolio(input: unknown): PortfolioData {
  const d = record(input, "Portfólio");
  const accounts = rows(d.accounts, "Contas"); unique(accounts, "id", "Conta");
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) { nonempty(a.name, "Nome da conta"); nonempty(a.institution, "Instituição"); if (!["strategy", "manual", "csv", "hyperliquid", "okx", "evm", "bitcoin", "solana"].includes(String(a.kind))) throw new Error("Tipo de conta inválido."); }
  for (const key of ["manual", "synced"]) for (const h of rows(d[key] ?? [], "Saldos")) {
    if (!ids.has(h.accountId)) throw new Error("Saldo de conta inexistente.");
    nonempty(h.assetKey, "Identidade do ativo"); nonempty(h.econ, "Ativo"); nonempty(h.symbol, "Símbolo");
    finite(h.qty, "Quantidade"); finite(h.at, "Data do saldo", 0);
    for (const field of ["valueUsd", "priceUsd", "costUsd"]) if (h[field] != null) finite(h[field], field);
    if (!["spot", "equity", "earn"].includes(String(h.kind))) throw new Error("Tipo de saldo inválido.");
  }
  const events = rows(d.events ?? [], "Eventos"); unique(events, "id", "Evento");
  for (const e of events) { finite(e.t, "Data do evento", 0); finite(e.qty, "Quantidade do evento"); if (e.usd != null) finite(e.usd, "Valor do evento"); }
  for (const s of rows(d.snapshots ?? [], "Retratos")) { finite(s.t, "Data do retrato", 0); for (const v of Object.values(record(s.byAccount, "Contas do retrato"))) finite(v, "Patrimônio"); }
  for (const key of ["positions", "journal", "plans"]) rows(d[key] ?? [], key);
  for (const key of ["priceIds", "manualPrices", "sync", "tradeNotes", "levelHistory"]) record(d[key] ?? {}, key);
  for (const v of Object.values((d.manualPrices ?? {}) as Record<string, unknown>)) finite(v, "Preço manual", 0);
  return normalize(d as Partial<PortfolioData>);
}
const normalize = (d: Partial<PortfolioData>): PortfolioData => {
  const n = { ...EMPTY(), ...d, v: 1 as const };
  n.snapshots = migrateSnapshots(n.snapshots ?? []);
  // Migração sem apagar o original: versões anteriores usavam adjust para transferência interna.
  n.events = (n.events ?? []).map((e) => e.kind === "adjust" && e.note?.includes("classificado pelo usuário") ? { ...e, classification: "internal" as const } : e);
  return n;
};

/** Carrega do IndexedDB (uma vez). */
export async function loadPortfolio(): Promise<void> {
  if (ready) return;
  try { const d = await readRaw(); if (d) { await preserveOriginal(d); await preserveOriginal(d, "portfolio.before-accounts-v1"); data = normalize(d); } lastError = null; }
  catch (e) { lastError = (e as Error).message; }
  ready = true; notify();
}

let queue: Promise<void> = Promise.resolve();
async function preserveOriginal(d: PortfolioData, key = "portfolio.pre-audit-2026-11-11") {
  const db = await open();
  await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE); const q = store.get(key); q.onsuccess = () => { if (!q.result) store.put(d, key); }; tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => { db.close(); rej(tx.error); }; });
}
/** Altera e grava (gravações em fila, na ordem). */
export function updatePortfolio(fn: (d: PortfolioData) => void) {
  const previous = data;
  const next = structuredClone(data);
  fn(next);
  data = next;
  notify();
  const snap = structuredClone(next);
  const operation = queue.then(() => writeRaw(snap)).then(() => { lastError = null; notify(); });
  queue = operation.catch((e) => { if (data === next) data = previous; lastError = `Não foi possível salvar o portfólio: ${(e as Error).message}`; notify(); });
  return operation;
}

/** Para o backup v4. */
export const exportPortfolio = (): PortfolioData => structuredClone(data);
export function importPortfolio(d: unknown) {
  const n = validatePortfolio(d);
  return updatePortfolio((x) => { Object.assign(x, n); });
}
export const uidP = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
