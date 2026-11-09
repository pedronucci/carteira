/** Cálculos puros da Visão Geral (sem dependência de tela): lado das posições, alocação e margem. Nada aqui inventa dado. */
import type { PerpPosition } from "../perps/positions";

export interface SideSplit { long: { n: number; notional: number; upnl: number }; short: { n: number; notional: number; upnl: number }; grossNotional: number; netNotional: number }
export function longShort(ps: Pick<PerpPosition, "dir" | "notional" | "upnl">[]): SideSplit {
  const z = () => ({ n: 0, notional: 0, upnl: 0 });
  const long = z(), short = z();
  for (const p of ps) { const t = p.dir === "LONG" ? long : short; t.n += 1; t.notional += Math.abs(p.notional); t.upnl += p.upnl; }
  return { long, short, grossNotional: long.notional + short.notional, netNotional: long.notional - short.notional };
}

const PALETTE = ["#42D9D0", "#D7B36A", "#8B9CF0", "#B583F5", "#36C995", "#EF6878", "#6FA8DC"];
const FIXED: Record<string, string> = { BTC: "#F7931A", USDC: "#2775CA", USDT: "#26A17B", ETH: "#8B9CF0", SOL: "#B583F5", HYPE: "#42D9D0" };
export interface AllocPart { symbol: string; value: number; share: number; color: string }
/** Alocação por ativo do patrimônio (valor próprio + equity de derivativos). O notional das posições nunca entra. */
export function allocation(assets: { symbol: string; valueUsd: number | null }[], top = 6): AllocPart[] {
  const rows = assets.filter((a) => a.valueUsd != null && a.valueUsd > 0).map((a) => ({ symbol: a.symbol, value: a.valueUsd! })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((x, r) => x + r.value, 0);
  if (!total) return [];
  const head = rows.slice(0, top), tail = rows.slice(top);
  const list = tail.length ? [...head, { symbol: "Outros", value: tail.reduce((x, r) => x + r.value, 0) }] : head;
  let i = 0;
  return list.map((r) => ({ ...r, share: r.value / total, color: FIXED[r.symbol] ?? (r.symbol === "Outros" ? "#6B7D94" : PALETTE[i++ % PALETTE.length]!) }));
}

/** Uso de margem: margem usada ÷ equity (null se não houver equity). */
export const marginUse = (margin: number, equity: number | null) => (equity && equity > 0 ? margin / equity : null);
/** ROI das posições sobre a margem usada (soma dos P&L abertos ÷ soma das margens); null sem margem conhecida. */
export const roiOnMargin = (ps: Pick<PerpPosition, "upnl" | "margin">[]) => { const m = ps.reduce((x, p) => x + (p.margin ?? 0), 0); return m > 0 ? ps.reduce((x, p) => x + p.upnl, 0) / m : null; };
