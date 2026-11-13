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
import { exportPortfolio, importPortfolio, validatePortfolio } from "../portfolio/db";
import { dateValue, finite, nonempty, record, rows, unique } from "../validation";

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
      if (!localStorage.getItem(KEY + ".before-accounts-v1")) { try { localStorage.setItem(KEY + ".before-accounts-v1", raw); } catch { /* originais mantidos na chave principal */ } }
      if (!localStorage.getItem(KEY + ".pre-audit-2026-11-11")) { try { localStorage.setItem(KEY + ".pre-audit-2026-11-11", raw); } catch { /* o dado original permanece na chave principal */ } }
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
  try { localStorage.setItem(KEY, JSON.stringify(s)); storageOk = true; } catch { storageOk = false; throw new Error("Não foi possível salvar. Exporte um backup e libere espaço no navegador."); }
  current = s;
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

/** Backup v4: dados da Estratégia (data) + Portfólio Consolidado (portfolio). Restaura também backups v1 a v3. */
/** Contas Hyperliquid adicionais no backup: só id, apelido e endereço (o histórico é baixado de novo). Lido direto do armazenamento, sem importar o módulo. */
function extraAccountsForBackup(): { id: string; name: string; address: string }[] {
  try { return ((JSON.parse(localStorage.getItem("bst.hl.extra.v1") ?? "null") as { accounts?: { id: string; name: string; address: string }[] } | null)?.accounts ?? []).map(({ id, name, address }) => ({ id, name, address })); } catch { return []; }
}

export function exportBackup(): string {
  return JSON.stringify({ app: "bitcoin-strategy-terminal", version: 4, exportedAt: new Date().toISOString(), data: getStore(), portfolio: exportPortfolio(), hlExtra: extraAccountsForBackup() }, null, 2);
}

export function validateStore(value: unknown): Store {
  const input = record(value, "Estratégia");
  const cycles = rows(input.cycles, "Operações"); unique(cycles, "id", "Operação");
  for (const c of cycles) {
    const open = dateValue(c.openedAt, "Abertura"); finite(c.entryPx, "Preço de entrada", Number.MIN_VALUE); finite(c.capital, "Capital", 0); finite(c.leverage, "Alavancagem", Number.MIN_VALUE);
    if (c.closedAt && dateValue(c.closedAt, "Encerramento") < open) throw new Error("Encerramento anterior à abertura.");
    for (const key of ["exitPx", "stopPx", "targetPx", "liqPx"]) if (c[key] != null && c[key] !== "") finite(c[key], key, Number.MIN_VALUE);
    for (const key of ["feesOpen", "feesClose", "funding"]) if (c[key] != null && c[key] !== "") finite(c[key], key);
    for (const a of rows(c.adds ?? [], "Aumentos")) { if (dateValue(a.at, "Data do aumento") < open) throw new Error("Aumento anterior à abertura."); finite(a.px, "Preço do aumento", Number.MIN_VALUE); finite(a.capital, "Capital do aumento", 0); finite(a.leverage, "Alavancagem do aumento", Number.MIN_VALUE); }
  }
  const flows = rows(input.flows, "Fluxos"); unique(flows, "id", "Fluxo");
  for (const f of flows) { dateValue(f.date, "Data do fluxo"); finite(f.amount, "Valor do fluxo", 0); if (f.kind !== "IN" && f.kind !== "OUT") throw new Error("Direção de fluxo inválida."); }
  const strategies = rows(input.strategies ?? [], "Ciclos"); unique(strategies, "id", "Ciclo");
  if (strategies.filter((s) => s.status === "active").length > 1) throw new Error("Há mais de um ciclo ativo.");
  const sorted = [...strategies].sort((a, b) => Number(a.startAt) - Number(b.startAt));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!; const start = finite(s.startAt, "Início do ciclo", 0);
    if (s.status !== "active" && s.status !== "closed") throw new Error("Estado do ciclo inválido.");
    if (s.endAt != null && finite(s.endAt, "Fim do ciclo", start) < start) throw new Error("Janela de ciclo inválida.");
    if (i > 0 && Number(sorted[i - 1]!.endAt ?? Infinity) > start) throw new Error("Ciclos sobrepostos.");
    new Intl.DateTimeFormat("pt-BR", { timeZone: nonempty(s.tz, "Fuso") });
    for (const a of rows(s.accounts, "Vínculos")) if (a.kind !== "manual" && (a.kind !== "hyperliquid" || !/^0x[0-9a-f]{40}$/i.test(String(a.address)))) throw new Error("Vínculo de conta inválido.");
    if (s.snapshot) { const snap = record(s.snapshot, "Retrato inicial"); finite(snap.equityUsd, "Patrimônio inicial", 0); if (snap.btcUsd !== "") finite(snap.btcUsd, "Preço inicial", Number.MIN_VALUE); for (const p of rows(snap.positions, "Posições iniciais")) { finite(p.size, "Tamanho inicial"); finite(p.mark, "Preço da posição", Number.MIN_VALUE); } }
  }
  if (input.initial) { const initial = record(input.initial, "Saldo inicial"); dateValue(initial.date, "Data inicial"); finite(initial.usdc, "Saldo inicial", 0); }
  const settings = record(input.settings ?? {}, "Ajustes");
  for (const key of ["manualBtcUsd", "manualUsdBrl", "defaultLeverage"]) if (settings[key]) finite(settings[key], key, Number.MIN_VALUE);
  if (settings.maintenanceRate != null && (finite(settings.maintenanceRate, "Manutenção", 0) >= 1)) throw new Error("Manutenção deve ser inferior a 100%.");
  return normalize(input as Partial<Store>);
}
const RESTORE_JOURNAL = "bst.restore.pending.v1";
/** Diário persistente: recupera a versão anterior se o navegador fechar entre as duas bases. */
export async function recoverInterruptedRestore(): Promise<boolean> {
  const raw = localStorage.getItem(RESTORE_JOURNAL);
  if (!raw) return false;
  const journal = JSON.parse(raw);
  const oldStore = validateStore(journal.data), oldPortfolio = validatePortfolio(journal.portfolio);
  await importPortfolio(oldPortfolio);
  updateStore(cur => Object.assign(cur, oldStore));
  if (journal.extra == null) localStorage.removeItem("bst.hl.extra.v1"); else localStorage.setItem("bst.hl.extra.v1", journal.extra);
  localStorage.removeItem(RESTORE_JOURNAL);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("bst:extra-reload"));
  return true;
}
export async function importBackup(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("O arquivo não é um JSON válido."); }
  const data = ((parsed as { data?: unknown }).data ?? parsed) as Partial<Store> & V1 & { v?: number };
  if (!data || typeof data !== "object") throw new Error("Este arquivo não é um backup do Bitcoin Strategy Terminal.");
  let next: Store;
  if ((data.v as number) === 2 || data.v === 3 || Array.isArray(data.cycles)) {
    if (!Array.isArray(data.cycles) || !Array.isArray(data.flows)) throw new Error("Backup incompleto; nada foi alterado.");
    for (const c of data.cycles) if (!c.id || !c.openedAt || !c.entryPx || !c.leverage || !c.capital) throw new Error("Backup com ciclo incompleto; nada foi alterado.");
    next = validateStore(data);
  } else if (Array.isArray(data.ops)) next = validateStore(fromV1(data));
  else throw new Error("Este arquivo não é um backup do Bitcoin Strategy Terminal.");
  const pf = (parsed as { portfolio?: unknown }).portfolio;
  const stagedPortfolio = pf ? validatePortfolio(pf) : null;
  const ex = (parsed as { hlExtra?: { id: string; name: string; address: string }[] }).hlExtra;
  if (ex != null && (!Array.isArray(ex) || ex.some((x) => !x || !/^0x[0-9a-fA-F]{40}$/.test(x.address) || !x.id))) throw new Error("Contas adicionais inválidas; nada foi alterado.");
  if (ex && new Set(ex.map((x) => x.address.toLowerCase())).size !== ex.length) throw new Error("Contas adicionais repetidas.");
  backupNow("antes de restaurar um backup");
  const previous = structuredClone(getStore()), previousPortfolio = exportPortfolio();
  const previousExtra = localStorage.getItem("bst.hl.extra.v1");
  // Sem espaço para preservar o original, não iniciar a restauração.
  localStorage.setItem(RESTORE_JOURNAL, JSON.stringify({ data: previous, portfolio: previousPortfolio, extra: previousExtra }));
  try {
  if (stagedPortfolio) await importPortfolio(stagedPortfolio);
  updateStore((cur) => Object.assign(cur, next));
  if (Array.isArray(ex)) {
    try {
      const keep = ex.filter((x) => x && /^0x[0-9a-fA-F]{40}$/.test(x.address)).map((x) => ({ id: x.id, name: String(x.name), address: x.address.toLowerCase(), live: null, history: null, error: null, syncing: false }));
      localStorage.setItem("bst.hl.extra.v1", JSON.stringify({ v: 1, accounts: keep, storageError: null }));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("bst:extra-reload"));
    } catch (e) { throw new Error(`Não foi possível restaurar as contas adicionais: ${(e as Error).message}`); }
  }
  localStorage.removeItem(RESTORE_JOURNAL);
  } catch (e) {
    try { await recoverInterruptedRestore(); }
    catch { throw new Error("Restauração interrompida. A cópia anterior está preservada para recuperação ao reabrir; verifique o armazenamento do navegador."); }
    throw e;
  }
}

export function resetStore() { backupNow("antes de apagar tudo"); updateStore((s) => Object.assign(s, structuredClone(DEFAULT))); }
