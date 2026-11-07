/**
 * Risco e desempenho (puro). Estimativas são marcadas como tal; métricas estatísticas só saem com amostra mínima.
 */

export interface RiskPosition { instrument: string; dir: "LONG" | "SHORT"; size: number; mark: number | null; entry: number | null; liq: number | null; accountId: string; notional: number | null }

/** O ativo-base de um instrumento (BTC-PERP, BTC-USDT-SWAP → BTC). */
export const baseOf = (instrument: string) => instrument.toUpperCase().split(/[-_/]/)[0]!.replace(/^U(?=BTC|ETH|SOL)/, "");

export interface ExposureSummary {
  grossUsd: number; netUsd: number; longUsd: number; shortUsd: number;
  /** BTC: spot possuído + sintético (perpétuos, com sinal) */
  btcSpot: number; btcSynthetic: number; btcNet: number;
  effLeverage: number | null; minLiqDistance: number | null;
}
export function exposure(positions: RiskPosition[], spotBtc: number, btcPx: number, equityUsd: number): ExposureSummary {
  let longUsd = 0, shortUsd = 0, syn = 0, minLiq: number | null = null;
  for (const p of positions) {
    const px = p.mark ?? btcPx;
    const n = p.notional ?? p.size * px;
    if (p.dir === "LONG") longUsd += n; else shortUsd += n;
    if (baseOf(p.instrument) === "BTC") syn += p.dir === "LONG" ? p.size : -p.size;
    if (p.liq && px) { const d = p.dir === "LONG" ? (px - p.liq) / px : (p.liq - px) / px; minLiq = minLiq == null ? d : Math.min(minLiq, d); }
  }
  const gross = longUsd + shortUsd;
  return { grossUsd: gross, netUsd: longUsd - shortUsd, longUsd, shortUsd, btcSpot: spotBtc, btcSynthetic: syn, btcNet: spotBtc + syn, effLeverage: equityUsd > 0 ? gross / equityUsd : null, minLiqDistance: minLiq };
}

export interface ShockRow {
  shock: number; btcPx: number;
  spotUsd: number; derivUsd: number; totalUsd: number; btcEquivalent: number;
  liquidated: string[]; nearLiq: string[];
}
/**
 * Simula um movimento do BTC sobre os dados reais: spot em BTC (e representações) varia com o preço; derivativos
 * em BTC variam por direção × tamanho × variação; os demais ativos ficam constantes (limitação declarada).
 * Posição cujo preço de liquidação é cruzado é marcada como liquidada e passa a valer −margem perdida (estimativa:
 * o resultado dela é limitado à perda até o preço de liquidação).
 */
export function shockScenarios(a: { btcPx: number; spotBtc: number; totalUsd: number; positions: RiskPosition[] }, shocks = [-0.2, -0.15, -0.1, -0.05, 0.05, 0.1, 0.2]): ShockRow[] {
  const btcPos = a.positions.filter((p) => baseOf(p.instrument) === "BTC");
  return shocks.map((s) => {
    const px = a.btcPx * (1 + s);
    const spotUsd = a.spotBtc * (px - a.btcPx);
    let derivUsd = 0;
    const liquidated: string[] = [], nearLiq: string[] = [];
    for (const p of btcPos) {
      const m = p.mark ?? a.btcPx;
      const pxP = m * (1 + s);
      const sign = p.dir === "LONG" ? 1 : -1;
      const hit = p.liq != null && (p.dir === "LONG" ? pxP <= p.liq : pxP >= p.liq);
      const end = hit ? p.liq! : pxP;
      derivUsd += sign * p.size * (end - m);
      if (hit) liquidated.push(`${p.instrument} (${p.dir})`);
      else if (p.liq != null && Math.abs(pxP - p.liq) / pxP < 0.05) nearLiq.push(`${p.instrument} (${p.dir})`);
    }
    const totalUsd = a.totalUsd + spotUsd + derivUsd;
    return { shock: s, btcPx: px, spotUsd, derivUsd, totalUsd, btcEquivalent: totalUsd / px, liquidated, nearLiq };
  });
}

/** Concentração: participação do maior item e índice de Herfindahl (0–1). */
export function concentration(shares: number[]) {
  const s = shares.filter((x) => x > 0);
  return { top: s.length ? Math.max(...s) : null, hhi: s.length ? s.reduce((x, v) => x + v * v, 0) : null };
}

/**
 * Volatilidade anualizada e Sharpe (taxa livre de risco = 0) a partir de um índice acumulado no tempo.
 * Agrega em retornos diários; só calcula com pelo menos `minDays` retornos diários (padrão 14 para volatilidade,
 * 30 para Sharpe). Sem amostra suficiente: null (nunca um número com falsa precisão).
 */
export function dailyStats(points: { t: number; index: number }[], opts: { minVolDays?: number; minSharpeDays?: number } = {}) {
  const minVol = opts.minVolDays ?? 14, minSh = opts.minSharpeDays ?? 30;
  const byDay = new Map<number, number>();
  for (const p of [...points].sort((a, b) => a.t - b.t)) byDay.set(Math.floor(p.t / 86400e3), p.index);
  const idx = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const r: number[] = [];
  for (let i = 1; i < idx.length; i++) if (idx[i - 1]! > 0) r.push(idx[i]! / idx[i - 1]! - 1);
  const n = r.length;
  if (n < 2) return { days: n, volAnnual: null, sharpe: null };
  const mean = r.reduce((x, v) => x + v, 0) / n;
  const sd = Math.sqrt(r.reduce((x, v) => x + (v - mean) ** 2, 0) / (n - 1));
  return { days: n, volAnnual: n >= minVol ? sd * Math.sqrt(365) : null, sharpe: n >= minSh && sd > 0 ? (mean / sd) * Math.sqrt(365) : null };
}

/**
 * Retorno ponderado pelo dinheiro (TIR anualizada, XIRR). Fluxos do ponto de vista do investidor:
 * aportes negativos, retiradas positivas, valor final positivo. Sem troca de sinal: null.
 */
export function xirr(flows: { t: number; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...flows.map((f) => f.t));
  const yrs = flows.map((f) => (f.t - t0) / (365 * 86400e3));
  const npv = (r: number) => flows.reduce((x, f, i) => x + f.amount / Math.pow(1 + r, yrs[i]!), 0);
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// ───────── diário de operações ─────────

export interface JournalEntry {
  id: string; asset: string; strategy: string; date: string; dir: "LONG" | "SHORT";
  entry: number; exit: number | null; stop: number | null; targets: number[]; size?: number | null;
  rationale: string; notes: string; image?: string | null; createdAt: number;
}
/** Resultado de uma operação do diário: % pelo movimento e múltiplo de R (risco até o stop). */
export function journalResult(e: JournalEntry) {
  if (e.exit == null) return { closed: false, pct: null, r: null };
  const sign = e.dir === "LONG" ? 1 : -1;
  const pct = sign * (e.exit / e.entry - 1);
  const risk = e.stop != null ? Math.abs(e.entry - e.stop) : null;
  const r = risk ? (sign * (e.exit - e.entry)) / risk : null;
  return { closed: true, pct, r };
}
export function journalStats(entries: JournalEntry[]) {
  const res = entries.map(journalResult).filter((x) => x.closed);
  const wins = res.filter((x) => (x.pct ?? 0) > 0), losses = res.filter((x) => (x.pct ?? 0) < 0);
  const rs = res.map((x) => x.r).filter((x): x is number => x != null);
  const gw = wins.reduce((x, v) => x + v.pct!, 0), gl = losses.reduce((x, v) => x - v.pct!, 0);
  return {
    total: entries.length, closed: res.length, open: entries.length - res.length,
    winRate: res.length ? wins.length / res.length : null,
    avgWinPct: wins.length ? gw / wins.length : null, avgLossPct: losses.length ? -gl / losses.length : null,
    avgR: rs.length ? rs.reduce((x, v) => x + v, 0) / rs.length : null,
    expectancyPct: res.length ? res.reduce((x, v) => x + v.pct!, 0) / res.length : null,
    profitFactor: gl > 0 ? gw / gl : null,
    withStop: entries.filter((e) => e.stop != null).length,
  };
}
