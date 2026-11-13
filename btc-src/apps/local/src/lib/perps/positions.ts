/** Posições perpétuas descobertas na Hyperliquid, de todos os instrumentos, com métricas derivadas. Sem lista fixa de ativos. */
export interface RawPos { coin: string; szi: number; entryPx: number; leverage: number; levType: string; liqPx: number | null; upnl: number; marginUsed: number; posValue: number; fundingSinceOpen: number }
export interface PerpPosition {
  /** conta + mercado + instrumento: nunca duas vezes no patrimônio */
  id: string; accountId: string; coin: string; dir: "LONG" | "SHORT"; size: number; entry: number | null; mark: number | null; notional: number;
  leverage: number; levType: string; margin: number | null; upnl: number; roiOnMargin: number | null; liq: number | null; liqDistance: number | null;
  funding: number | null; linkedStrategy: boolean;
}
export interface PerpSummary {
  count: number; upnl: number; gross: number; net: number; margin: number; equity: number | null; effLeverage: number | null; funding: number;
  worstLiqDistance: number | null; riskLevel: "ok" | "warn" | "high" | "none";
}

export function perpId(accountId: string, coin: string) { return `${accountId}|perp|${coin}`; }

export function buildPositions(accountId: string, raw: RawPos[]): PerpPosition[] {
  return raw.filter((p) => Math.abs(p.szi) > 0).map((p) => {
    const size = Math.abs(p.szi);
    const mark = size > 0 && p.posValue ? Math.abs(p.posValue) / size : null;
    const dir = p.szi > 0 ? "LONG" : "SHORT";
    const liq = p.liqPx && p.liqPx > 0 ? p.liqPx : null;
    const liqDistance = liq != null && mark ? (dir === "LONG" ? (mark - liq) / mark : (liq - mark) / mark) : null;
    return {
      id: perpId(accountId, p.coin), accountId, coin: p.coin, dir, size, entry: p.entryPx > 0 ? p.entryPx : null, mark, notional: Math.abs(p.posValue), leverage: p.leverage, levType: p.levType,
      margin: p.marginUsed > 0 ? p.marginUsed : null, upnl: p.upnl, roiOnMargin: p.marginUsed > 0 ? p.upnl / p.marginUsed : null, liq, liqDistance,
      funding: Number.isFinite(p.fundingSinceOpen) ? p.fundingSinceOpen : null, linkedStrategy: false,
    };
  });
}

/** Risco por distância da liquidação, relativa ao limite do usuário (minLiq, fração). */
export function riskLevel(dist: number | null, minLiq: number): "ok" | "warn" | "high" | "none" {
  if (dist == null) return "none";
  return dist < minLiq ? "high" : dist < minLiq * 2 ? "warn" : "ok";
}

/** Equity, margem e nocional são coisas diferentes: o nocional nunca é somado ao patrimônio. */
export function summarize(pos: PerpPosition[], equity: number | null, minLiq = 0.1): PerpSummary {
  const dists = pos.map((p) => p.liqDistance).filter((x): x is number => x != null);
  const worst = dists.length ? Math.min(...dists) : null;
  const gross = pos.reduce((a, p) => a + p.notional, 0);
  const net = pos.reduce((a, p) => a + (p.dir === "LONG" ? p.notional : -p.notional), 0);
  return {
    count: pos.length, upnl: pos.reduce((a, p) => a + p.upnl, 0), gross, net, margin: pos.reduce((a, p) => a + (p.margin ?? 0), 0), equity,
    effLeverage: equity != null && equity > 0 ? gross / equity : null, funding: pos.reduce((a, p) => a + (p.funding ?? 0), 0),
    worstLiqDistance: worst, riskLevel: pos.length ? riskLevel(worst, minLiq) : "none",
  };
}
