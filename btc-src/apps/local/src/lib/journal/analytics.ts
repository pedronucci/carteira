/**
 * Estatísticas do Trading Journal (puras): métricas, curva de resultado, calendário e padrões recorrentes.
 * Somente operações ENCERRADAS entram nas estatísticas de acerto; operações abertas aparecem à parte.
 * Resultado de uma operação = realizado − taxas + funding (o mesmo critério do Portfolio Attribution Engine).
 */
import type { JTrade } from "./trades";
import type { Rec } from "../attribution/ledger";

const EPS = 1e-9;
export interface JFilter { coin?: string | null; strategy?: string | null; acc?: string | null; dir?: "LONG" | "SHORT" | null; result?: "win" | "loss" | "open" | null; from?: number | null; to?: number | null; q?: string | null }

/** Uma operação entra no período quando algum evento financeiro dela (execução) ou o fechamento cai dentro dele. */
export function filterJournal(trades: JTrade[], f: JFilter): JTrade[] {
  const q = f.q?.trim().toLowerCase();
  return trades.filter((t) => {
    if (f.coin && t.coin !== f.coin) return false;
    if (f.acc && t.accountId !== f.acc) return false;
    if (f.strategy && t.strategy !== f.strategy) return false;
    if (f.dir && t.dir !== f.dir) return false;
    if (f.result === "open" && !t.open) return false;
    if (f.result === "win" && !(!t.open && t.netPnl > EPS)) return false;
    if (f.result === "loss" && !(!t.open && t.netPnl < -EPS)) return false;
    if (f.from != null || f.to != null) {
      const touched = t.fills.some((x) => (f.from == null || x.time >= f.from) && (f.to == null || x.time <= f.to));
      if (!touched) return false;
    }
    if (q) { const hay = `${t.coin} ${t.strategy} ${t.note?.thesis ?? ""} ${t.note?.notes ?? ""} ${(t.note?.tags ?? []).join(" ")}`.toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
}

export interface JMetrics {
  total: number; closed: number; open: number; wins: number; losses: number; flat: number; winRate: number | null;
  avgWin: number | null; avgLoss: number | null; payoff: number | null; profitFactor: number | null; expectancy: number | null;
  net: number; realized: number; fees: number; funding: number; grossProfit: number; grossLoss: number;
  maxDrawdown: number; best: JTrade | null; worst: JTrade | null; avgDurationMs: number | null; maxLossStreak: number; maxWinStreak: number;
}
export function journalMetrics(trades: JTrade[]): JMetrics {
  const closed = trades.filter((t) => !t.open).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  const wins = closed.filter((t) => t.netPnl > EPS), losses = closed.filter((t) => t.netPnl < -EPS);
  const gp = wins.reduce((a, t) => a + t.netPnl, 0), gl = -losses.reduce((a, t) => a + t.netPnl, 0);
  let cum = 0, peak = 0, dd = 0, ls = 0, ws = 0, mls = 0, mws = 0;
  for (const t of closed) {
    cum += t.netPnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
    if (t.netPnl < -EPS) { ls++; ws = 0; } else if (t.netPnl > EPS) { ws++; ls = 0; } else { ls = 0; ws = 0; }
    mls = Math.max(mls, ls); mws = Math.max(mws, ws);
  }
  const avgWin = wins.length ? gp / wins.length : null, avgLoss = losses.length ? gl / losses.length : null;
  const sum = (k: "realizedPnl" | "fees" | "funding" | "netPnl") => trades.reduce((a, t) => a + t[k], 0);
  return {
    total: trades.length, closed: closed.length, open: trades.length - closed.length, wins: wins.length, losses: losses.length, flat: closed.length - wins.length - losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null, avgWin, avgLoss,
    payoff: avgWin != null && avgLoss ? avgWin / avgLoss : null, profitFactor: gl > EPS ? gp / gl : null, expectancy: closed.length ? closed.reduce((a, t) => a + t.netPnl, 0) / closed.length : null,
    net: sum("netPnl"), realized: sum("realizedPnl"), fees: sum("fees"), funding: sum("funding"), grossProfit: gp, grossLoss: gl, maxDrawdown: dd,
    best: closed.length ? closed.reduce((a, t) => (t.netPnl > a.netPnl ? t : a)) : null, worst: closed.length ? closed.reduce((a, t) => (t.netPnl < a.netPnl ? t : a)) : null,
    avgDurationMs: closed.length ? closed.reduce((a, t) => a + t.durationMs, 0) / closed.length : null, maxLossStreak: mls, maxWinStreak: mws,
  };
}

/** Curva do resultado acumulado das operações encerradas (na data de fechamento) e a queda desde o pico. */
export function equityCurve(trades: JTrade[]): { t: number; cum: number; dd: number; uid: string }[] {
  let cum = 0, peak = 0;
  return trades.filter((t) => !t.open).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0)).map((t) => { cum += t.netPnl; peak = Math.max(peak, cum); return { t: t.closedAt!, cum, dd: peak - cum, uid: t.uid }; });
}

// ───────── calendário ─────────
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export interface DayCell { key: string; net: number; closedTrades: number; events: number }
/** Resultado por dia (data local) a partir dos MESMOS eventos financeiros usados na atribuição (realizado − taxas + funding). */
export function calendarDays(recs: Rec[], trades: JTrade[]): Map<string, DayCell> {
  const m = new Map<string, DayCell>();
  const cell = (k: string) => { let c = m.get(k); if (!c) { c = { key: k, net: 0, closedTrades: 0, events: 0 }; m.set(k, c); } return c; };
  for (const r of recs) { if (r.market !== "perp") continue; const c = cell(dayKey(r.t)); c.net += r.usd; c.events++; }
  for (const t of trades) if (!t.open && t.closedAt != null) cell(dayKey(t.closedAt)).closedTrades++;
  return m;
}

// ───────── padrões recorrentes ─────────
export interface Pattern { id: string; dimension: string; label: string; n: number; winRate: number | null; expectancy: number; net: number; tone: "gain" | "loss" | "neutral"; text: string }
const MIN_N = 4;
const WD = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const durBucket = (ms: number) => (ms < 3600e3 ? "menos de 1 h" : ms < 6 * 3600e3 ? "1 a 6 h" : ms < 86400e3 ? "6 a 24 h" : ms < 3 * 86400e3 ? "1 a 3 dias" : "mais de 3 dias");
const money = (v: number) => `${v < 0 ? "−" : ""}US$ ${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

export function findPatterns(all: JTrade[]): Pattern[] {
  const closed = all.filter((t) => !t.open);
  if (closed.length < MIN_N) return [];
  const dims: { dimension: string; key: (t: JTrade) => string | null }[] = [
    { dimension: "Ativo", key: (t) => t.coin },
    { dimension: "Direção", key: (t) => t.dir },
    { dimension: "Ativo e direção", key: (t) => `${t.dir} em ${t.coin}` },
    { dimension: "Estratégia", key: (t) => t.strategy },
    { dimension: "Dia da semana (fechamento)", key: (t) => WD[new Date(t.closedAt!).getDay()]! },
    { dimension: "Horário de entrada", key: (t) => { const h = new Date(t.openedAt).getHours(); return `${String(Math.floor(h / 4) * 4).padStart(2, "0")}h–${String(Math.floor(h / 4) * 4 + 3).padStart(2, "0")}h`; } },
    { dimension: "Duração", key: (t) => durBucket(t.durationMs) },
    { dimension: "Aumentou a posição", key: (t) => (t.execs.some((e) => e.kind === "ADD") ? "com aumento de posição" : "sem aumento de posição") },
    { dimension: "Stop planejado", key: (t) => (t.note?.plannedStop != null ? "com stop planejado" : "sem stop planejado") },
  ];
  const out: Pattern[] = [];
  for (const d of dims) {
    const g = new Map<string, JTrade[]>();
    for (const t of closed) { const k = d.key(t); if (k) g.set(k, [...(g.get(k) ?? []), t]); }
    if (g.size < 2) continue; // uma única categoria não diz nada
    for (const [label, ts] of g) {
      if (ts.length < MIN_N) continue;
      const net = ts.reduce((a, t) => a + t.netPnl, 0), wins = ts.filter((t) => t.netPnl > EPS).length, dec = ts.filter((t) => Math.abs(t.netPnl) > EPS).length;
      const exp = net / ts.length, wr = dec ? wins / dec : null;
      const tone: Pattern["tone"] = exp > EPS ? "gain" : exp < -EPS ? "loss" : "neutral";
      out.push({ id: `${d.dimension}|${label}`, dimension: d.dimension, label, n: ts.length, winRate: wr, expectancy: exp, net, tone,
        text: `${d.dimension}: ${label} — ${ts.length} operações, ${wr != null ? `acerto ${Math.round(wr * 100)}%, ` : ""}expectância ${money(exp)} por operação, resultado ${money(net)}.` });
    }
  }
  // destaca o que mais pesa no resultado (positivo e negativo), sem repetir a mesma operação em muitas dimensões
  out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const picked: Pattern[] = [];
  const perDim = new Map<string, number>();
  for (const p of out) { if ((perDim.get(p.dimension) ?? 0) >= 2 || p.tone === "neutral") continue; perDim.set(p.dimension, (perDim.get(p.dimension) ?? 0) + 1); picked.push(p); if (picked.length >= 8) break; }
  // custos recorrentes
  const gp = closed.filter((t) => t.netPnl > EPS).reduce((a, t) => a + t.realizedPnl, 0), fees = closed.reduce((a, t) => a + t.fees, 0), fund = closed.reduce((a, t) => a + t.funding, 0);
  if (gp > EPS && fees / gp > 0.3) picked.push({ id: "costs|fees", dimension: "Custos", label: "Taxas", n: closed.length, winRate: null, expectancy: -fees / closed.length, net: -fees, tone: "loss", text: `Custos: as taxas consumiram ${Math.round((fees / gp) * 100)}% do lucro bruto das operações vencedoras (${money(-fees)} no total).` });
  if (fund < -EPS && Math.abs(fund) > 0.1 * Math.max(gp, EPS)) picked.push({ id: "costs|funding", dimension: "Custos", label: "Funding", n: closed.length, winRate: null, expectancy: fund / closed.length, net: fund, tone: "loss", text: `Custos: o funding pago somou ${money(fund)} nas operações encerradas.` });
  const m = journalMetrics(closed);
  if (m.maxLossStreak >= 3) picked.push({ id: "streak", dimension: "Sequência", label: "Perdas seguidas", n: m.maxLossStreak, winRate: null, expectancy: 0, net: 0, tone: "loss", text: `Sequência: houve até ${m.maxLossStreak} perdas seguidas.` });
  return picked;
}
