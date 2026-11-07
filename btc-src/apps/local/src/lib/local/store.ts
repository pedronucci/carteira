/**
 * Banco de dados local (localStorage). Nada sai deste aparelho.
 *
 * Modelo da estratégia: o patrimônio fica 100% em USDC ou 100% em BTC.
 * Em BTC, a exposição é um long em perpétuo com alavancagem baixa, usando o USDC como margem.
 * Cada entrada → saída é um CICLO.
 */
import type { ScenarioRules } from "@bst/domain";
import type { StrategyCycle } from "./strategy";
import { zonedToUtc } from "./strategy";

export interface Initial {
  date: string; // yyyy-mm-dd
  /** Patrimônio inicial em USD (USDC). Se começou em BTC, é o capital da posição aberta na data. */
  usdc: string;
}

/** Aumento de uma posição aberta: mais margem em USDC, mais BTC, novo preço médio. */
export interface Add {
  id: string;
  at: string; // yyyy-mm-ddThh:mm
  px: string; // preço do BTC no aumento
  capital: string; // USDC de margem adicionados
  leverage: string; // alavancagem do aumento
  fees?: string;
  liqPx?: string; // nova liquidação informada pela corretora
  /** O dinheiro veio de fora (aporte registrado junto). */
  deposit?: boolean;
}

export interface Cycle {
  id: string;
  openedAt: string; // yyyy-mm-ddThh:mm
  entryPx: string; // USD
  leverage: string; // ex.: 1.5
  /** USDC usado como margem. Padrão: todo o caixa livre na entrada. */
  capital: string;
  liqPx?: string; // informado pela plataforma
  feesOpen?: string; // USD
  platform?: string;
  note?: string;
  stopPx?: string;
  targetPx?: string;
  closedAt?: string;
  exitPx?: string;
  feesClose?: string;
  funding?: string; // USD acumulado: + recebido, − pago
  /** Tamanho em BTC (ciclos importados). Quando presente, o valor é C + tam·(P − E). */
  sizeBtc?: string;
  /** Capital = todo o caixa disponível na abertura (ciclos importados). */
  auto?: boolean;
  source?: "hl";
  adds?: Add[];
}

export interface Flow { id: string; date: string; kind: "IN" | "OUT"; amount: string; note?: string }

export interface Settings {
  defaultLeverage: string;
  maintenanceRate: string; // ex.: 0.0125
  minLiqDistance: string; // ex.: 0.15
  manualBtcUsd?: string;
  manualUsdBrl?: string;
  scenarioRules?: Partial<ScenarioRules>;
  /** Conta da Hyperliquid acompanhada (somente leitura, pelo endereço público). */
  hl?: { address: string; includeArb?: boolean };
}

export interface Store {
  v: 3; initial: Initial | null; cycles: Cycle[]; flows: Flow[]; settings: Settings; updatedAt: string; migratedNote?: string;
  /** Ciclos da estratégia (independentes da conta). */
  strategies: StrategyCycle[];
  /** O que as telas mostram: id de um ciclo, "active" (o ciclo em andamento) ou "account" (histórico completo da conta). */
  view: string;
}

const KEY = "bst.local.v2";
/** Cópias automáticas (as mais recentes primeiro), feitas antes de qualquer operação que substitui dados. */
const AUTO = "bst.local.v2.auto";
const AUTO_MAX = 12;
const OLD = "bst.local.v1";
const DEFAULT: Store = {
  v: 3, initial: null, cycles: [], flows: [], updatedAt: new Date(0).toISOString(), strategies: [], view: "active",
  settings: { defaultLeverage: "1.5", maintenanceRate: "0.0125", minLiqDistance: "0.2" },
};

let current: Store | null = null;
let storageOk = true;
const subs = new Set<() => void>();

export function getStore(): Store {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.v !== 3 && !localStorage.getItem(KEY + ".bak")) localStorage.setItem(KEY + ".bak", raw); // cópia intacta antes da migração
      if (parsed.v !== 3) pushAuto(raw, "antes da migração de versão");
      current = normalize(parsed);
      if (parsed.v !== 3) localStorage.setItem(KEY, JSON.stringify(current));
    }
    else {
      const old = localStorage.getItem(OLD);
      current = old ? fromV1(JSON.parse(old)) : structuredClone(DEFAULT);
      if (old) localStorage.setItem(KEY, JSON.stringify(current)); // a versão antiga fica guardada intacta
    }
  } catch {
    storageOk = false;
    current = structuredClone(DEFAULT);
  }
  return current;
}

export const storageAvailable = () => { getStore(); return storageOk; };

export const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"; } catch { return "America/Sao_Paulo"; } };

function normalize(s: Partial<Store>): Store {
  const out = { ...structuredClone(DEFAULT), ...s, settings: { ...DEFAULT.settings, ...(s.settings ?? {}) }, cycles: s.cycles ?? [], flows: s.flows ?? [], strategies: s.strategies ?? [], view: s.view ?? "active", v: 3 } as Store;
  // migração v2 → v3: a posição inicial vira o primeiro ciclo da estratégia (referência manual). Nada é apagado.
  if (!s.strategies && out.initial) {
    const tz = localTz();
    out.strategies.push({
      id: "s-" + Math.random().toString(36).slice(2, 8), name: "Estratégia BTC ↔ USDC", tz, status: "active", createdAt: Date.now(),
      startAt: zonedToUtc(out.initial.date, "00:00", tz),
      accounts: out.settings.hl ? [{ kind: "hyperliquid", address: out.settings.hl.address, includeArb: out.settings.hl.includeArb }] : [{ kind: "manual" }],
      snapshot: { at: zonedToUtc(out.initial.date, "00:00", tz), source: "manual", equityUsd: out.initial.usdc, btcUsd: "", balances: [{ coin: "USDC", where: "manual", total: out.initial.usdc, usd: out.initial.usdc }], positions: [], note: "Migrado da posição inicial" },
    });
  }
  return out;
}

/** Converte a versão anterior (operações à vista) para ciclos. Compras/vendas à vista não têm equivalente direto. */
type V1 = { initial?: { date: string; btc: string; cash: string; value: string; cur: "BRL" | "USD"; usdBrl: string } | null; ops?: { id: string; type: string; date: string; total?: string; cur: "BRL" | "USD"; usdBrl: string }[]; positions?: { id: string; openedAt: string; entryPx: string; leverage: string; marginUsd: string; liqPx?: string; feesUsd?: string; fundingUsd?: string; platform?: string; closed?: { px: string; at: string } }[] };
function fromV1(o: V1): Store {
  const s = structuredClone(DEFAULT);
  const usd = (v: string | undefined, cur: "BRL" | "USD", fx: string) => (cur === "USD" ? Number(v || 0) : Number(v || 0) / Number(fx || 1));
  if (o.initial) s.initial = { date: o.initial.date, usdc: usd(o.initial.value, o.initial.cur, o.initial.usdBrl).toFixed(2) };
  let skipped = 0;
  for (const op of o.ops ?? []) {
    if (op.type === "DEPOSIT" || op.type === "WITHDRAW") s.flows.push({ id: op.id, date: op.date, kind: op.type === "DEPOSIT" ? "IN" : "OUT", amount: usd(op.total, op.cur, op.usdBrl).toFixed(2) });
    else skipped++;
  }
  for (const p of o.positions ?? []) s.cycles.push({ id: p.id, openedAt: p.openedAt, entryPx: p.entryPx, leverage: p.leverage, capital: p.marginUsd, liqPx: p.liqPx, feesOpen: p.feesUsd, funding: p.fundingUsd, platform: p.platform, ...(p.closed ? { closedAt: p.closed.at, exitPx: p.closed.px } : {}) });
  if (skipped) s.migratedNote = `${skipped} compra(s)/venda(s) à vista da versão anterior não foram convertidas. Relance-as como ciclos em Operações.`;
  return s;
}

export function updateStore(fn: (s: Store) => void) {
  // cópia periódica: no máximo uma a cada 6 h de uso
  const lastAt = readAuto()[0]?.at;
  if (!lastAt || Date.now() - new Date(lastAt).getTime() > 6 * 3600e3) backupNow("cópia periódica");
  const s = structuredClone(getStore());
  fn(s);
  s.updatedAt = new Date().toISOString();
  current = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); storageOk = true; } catch { storageOk = false; }
  subs.forEach((f) => f());
}

// ───────── cópias automáticas ─────────

export interface AutoBackup { at: string; reason: string; data: string }

function readAuto(): AutoBackup[] {
  try { const a = JSON.parse(localStorage.getItem(AUTO) ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
function pushAuto(data: string, reason: string) {
  try {
    const list = readAuto();
    if (list[0]?.data === data) return; // nada mudou desde a última cópia
    list.unshift({ at: new Date().toISOString(), reason, data });
    let keep = list.slice(0, AUTO_MAX);
    // se o armazenamento estiver cheio, descarta as cópias mais antigas até caber
    for (;;) {
      try { localStorage.setItem(AUTO, JSON.stringify(keep)); return; }
      catch { if (keep.length <= 1) return; keep = keep.slice(0, -1); }
    }
  } catch { /* sem armazenamento */ }
}
/** Guarda uma cópia dos dados atuais antes de uma operação que pode substituir ou apagar algo. */
export function backupNow(reason: string) {
  try { const raw = localStorage.getItem(KEY); if (raw) pushAuto(raw, reason); } catch { /* sem armazenamento */ }
}
export const listAutoBackups = (): AutoBackup[] => readAuto();
/** Restaura uma cópia automática (fazendo antes uma cópia do estado atual, para poder voltar). */
export function restoreAutoBackup(at: string) {
  const b = readAuto().find((x) => x.at === at);
  if (!b) throw new Error("Cópia não encontrada.");
  const next = normalize(JSON.parse(b.data));
  backupNow("antes de restaurar uma cópia automática");
  updateStore((cur) => { for (const k of Object.keys(cur)) delete (cur as unknown as Record<string, unknown>)[k]; Object.assign(cur, next); });
}

export function subscribeStore(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function exportBackup(): string {
  return JSON.stringify({ app: "bitcoin-strategy-terminal", version: 3, exportedAt: new Date().toISOString(), data: getStore() }, null, 2);
}

export function importBackup(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("O arquivo não é um JSON válido."); }
  const data = ((parsed as { data?: unknown }).data ?? parsed) as Partial<Store> & V1 & { v?: number };
  if (!data || typeof data !== "object") throw new Error("Este arquivo não é um backup do Bitcoin Strategy Terminal.");
  let next: Store;
  if ((data.v as number) === 2 || data.v === 3 || Array.isArray(data.cycles)) {
    if (!Array.isArray(data.cycles) || !Array.isArray(data.flows)) throw new Error("Backup incompleto; nada foi alterado.");
    for (const c of data.cycles) if (!c.id || !c.openedAt || !c.entryPx || !c.leverage || !c.capital) throw new Error("Backup com ciclo incompleto; nada foi alterado.");
    next = normalize(data);
  } else if (Array.isArray(data.ops)) next = fromV1(data);
  else throw new Error("Este arquivo não é um backup do Bitcoin Strategy Terminal.");
  backupNow("antes de restaurar um backup");
  updateStore((cur) => Object.assign(cur, next));
}

export function resetStore() { backupNow("antes de apagar tudo"); updateStore((s) => Object.assign(s, structuredClone(DEFAULT))); }
