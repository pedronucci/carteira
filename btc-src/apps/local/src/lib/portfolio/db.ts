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
  sync: Record<string, { state: "ok" | "error" | "sync"; at: number; error?: string; info?: string }>;
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
    q.onsuccess = () => res((q.result as PortfolioData | undefined) ?? null);
    q.onerror = () => rej(q.error);
  });
}
async function writeRaw(d: PortfolioData): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(d, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error("Falha ao gravar no banco local."));
  });
}

const normalize = (d: Partial<PortfolioData>): PortfolioData => { const n = { ...EMPTY(), ...d, v: 1 as const }; n.snapshots = migrateSnapshots(n.snapshots ?? []); return n; };

/** Carrega do IndexedDB (uma vez). */
export async function loadPortfolio(): Promise<void> {
  if (ready) return;
  try { const d = await readRaw(); if (d) data = normalize(d); lastError = null; }
  catch (e) { lastError = (e as Error).message; }
  ready = true; notify();
}

let queue: Promise<void> = Promise.resolve();
/** Altera e grava (gravações em fila, na ordem). */
export function updatePortfolio(fn: (d: PortfolioData) => void) {
  const next = structuredClone(data);
  fn(next);
  data = next;
  notify();
  const snap = structuredClone(next);
  queue = queue.then(() => writeRaw(snap)).then(() => { lastError = null; }).catch((e) => { lastError = `Não foi possível salvar o portfólio: ${(e as Error).message}`; notify(); });
  return queue;
}

/** Para o backup v4. */
export const exportPortfolio = (): PortfolioData => structuredClone(data);
export function importPortfolio(d: unknown) {
  if (!d || typeof d !== "object" || !Array.isArray((d as PortfolioData).accounts)) throw new Error("Backup do portfólio inválido; nada foi alterado.");
  const n = normalize(d as PortfolioData);
  return updatePortfolio((x) => { Object.assign(x, n); });
}
export const uidP = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
