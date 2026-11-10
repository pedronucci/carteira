/**
 * Classifica as execuções (fills) de uma operação: entrada, aumento, redução parcial, encerramento, stop, take profit
 * e liquidação. Usa só dados reais da Hyperliquid: o tipo de gatilho só aparece quando o oid da execução é conhecido.
 */
import type { Fill, Trade } from "./trades";
import type { HlOrderKind } from "../local/hl";

export type ExecKind = "ENTRY" | "ADD" | "REDUCE" | "CLOSE";
export type Trigger = "SL" | "TP" | "LIQ" | null;
export interface Exec {
  fill: Fill; kind: ExecKind; trigger: Trigger; dir: "LONG" | "SHORT";
  /** tamanho da posição depois da execução (em contratos) */ posAfter: number;
  /** rótulo curto em português */ label: string;
}
const EPS = 1e-9;

export function execLabel(kind: ExecKind, trigger: Trigger, dir: "LONG" | "SHORT"): string {
  if (trigger === "LIQ") return "Liquidação";
  if (trigger === "SL") return kind === "CLOSE" ? "Stop (encerra)" : "Stop (parcial)";
  if (trigger === "TP") return kind === "CLOSE" ? "Take profit (encerra)" : "Take profit (parcial)";
  if (kind === "ENTRY") return dir === "LONG" ? "Entrada LONG" : "Entrada SHORT";
  if (kind === "ADD") return "Aumento de posição";
  if (kind === "REDUCE") return "Redução parcial";
  return "Fechamento";
}

export function classifyExecs(t: Pick<Trade, "dir" | "fills" | "inherited">, orders?: Record<string, HlOrderKind> | null): Exec[] {
  const fills = [...t.fills].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
  let cur = t.inherited && fills[0] ? Math.abs(fills[0].startPosition) : 0;
  let opened = cur > EPS;
  return fills.map((f) => {
    const inc = (t.dir === "LONG" && f.side === "B") || (t.dir === "SHORT" && f.side === "A");
    let kind: ExecKind;
    if (inc) { kind = !opened ? "ENTRY" : "ADD"; opened = true; cur += f.sz; }
    else { cur = Math.max(0, cur - f.sz); kind = cur <= EPS ? "CLOSE" : "REDUCE"; }
    const k = f.oid != null ? orders?.[String(f.oid)] : undefined;
    const trigger: Trigger = f.liq ? "LIQ" : !inc && k === "SL" ? "SL" : !inc && k === "TP" ? "TP" : null;
    return { fill: f, kind, trigger, dir: t.dir, posAfter: cur, label: execLabel(kind, trigger, t.dir) };
  });
}
