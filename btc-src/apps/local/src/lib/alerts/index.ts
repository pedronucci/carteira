/**
 * Alertas locais: avaliados com o app aberto (a cada atualização de dados, no máximo a cada 30 s).
 * Disparam na TRANSIÇÃO da condição (com intervalo mínimo entre disparos) e aparecem no app e, se você permitir,
 * como notificação do sistema. Com o app fechado é preciso o gateway com Web Push (ver docs/ALERTAS.md).
 */
import { evaluateCondition, step, type AlertRule, type AlertState, type AlertType, type MarketContext } from "@bst/domain";

const KEY = "bst.alerts.v1";
export interface AlertLog { id: string; ruleId: string; at: number; message: string; seen: boolean }
export interface AlertsData { rules: (AlertRule & { label?: string; ref?: number | null })[]; state: Record<string, AlertState>; log: AlertLog[] }
const EMPTY: AlertsData = { rules: [], state: {}, log: [] };

let data: AlertsData = load();
const subs = new Set<() => void>();
export const subscribeAlerts = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const alerts = () => data;
function load(): AlertsData { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "null") }; } catch { return structuredClone(EMPTY); } }
function save(d: AlertsData) { data = d; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* sem armazenamento */ } subs.forEach((f) => f()); }

export const ALERT_TYPES: { type: AlertType; label: string; unit: "usd" | "pct" | "x" | "btc" | "rate" | "none"; hint: string }[] = [
  { type: "PRICE_ABOVE", label: "BTC acima de", unit: "usd", hint: "preço em US$" },
  { type: "PRICE_BELOW", label: "BTC abaixo de", unit: "usd", hint: "preço em US$" },
  { type: "LIQ_DISTANCE_BELOW", label: "Distância da liquidação abaixo de", unit: "pct", hint: "ex.: 20 = 20%" },
  { type: "LEVERAGE_ABOVE", label: "Alavancagem efetiva acima de", unit: "x", hint: "ex.: 3" },
  { type: "DRAWDOWN_ABOVE", label: "Queda desde o pico acima de", unit: "pct", hint: "ex.: 10 = 10%" },
  { type: "FUNDING_CHANGE", label: "Funding do BTC mudar mais que", unit: "rate", hint: "por hora, em %; ex.: 0,005" },
  { type: "EXPOSURE_CHANGE", label: "Exposição líquida em BTC mudar mais que", unit: "btc", hint: "em BTC" },
  { type: "BTC_EQUIV_CHANGE", label: "BTC equivalente da estratégia variar mais que", unit: "pct", hint: "no ciclo, em %" },
  { type: "DIVERGENCE_ABOVE", label: "Divergência saldo oficial × cálculo acima de", unit: "usd", hint: "em US$ (Hyperliquid)" },
  { type: "SYNC_FAILURE", label: "Falha de sincronização", unit: "none", hint: "qualquer integração" },
];

export function addRule(type: AlertType, threshold: number, cooldownMin: number, ref: number | null = null) {
  const id = Math.random().toString(36).slice(2, 10);
  save({ ...data, rules: [...data.rules, { id, type, threshold, cooldownSec: cooldownMin * 60, enabled: true, ref }] });
}
export const toggleRule = (id: string) => save({ ...data, rules: data.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) });
export const removeRule = (id: string) => { const state = { ...data.state }; delete state[id]; save({ ...data, rules: data.rules.filter((r) => r.id !== id), state }); };
export const markSeen = () => save({ ...data, log: data.log.map((l) => ({ ...l, seen: true })) });

let lastEval = 0;
/** Avalia as regras. `ctx` vem do app; regras com referência (funding, exposição) usam o valor guardado na criação. */
export function evaluateAlerts(ctx: MarketContext, notify: (msg: string) => void) {
  if (Date.now() - lastEval < 30e3) return;
  lastEval = Date.now();
  const d = structuredClone(data);
  let fired = false;
  for (const r of d.rules) {
    if (!r.enabled) continue;
    const c = { ...ctx, fundingRef: r.type === "FUNDING_CHANGE" ? r.ref ?? null : ctx.fundingRef, btcNetRef: r.type === "EXPOSURE_CHANGE" ? r.ref ?? null : ctx.btcNetRef };
    const st = d.state[r.id] ?? { lastConditionTrue: false, lastFiredAt: null };
    const res = step(r, st, c);
    d.state[r.id] = res.state;
    if (res.fire) {
      const message = evaluateCondition(r, c).message;
      d.log.unshift({ id: Math.random().toString(36).slice(2, 10), ruleId: r.id, at: Date.now(), message, seen: false });
      notify(message); fired = true;
    }
  }
  d.log = d.log.slice(0, 200);
  if (fired || JSON.stringify(d.state) !== JSON.stringify(data.state)) save(d);
}
