/** Agrupa execuções (fills) de perpétuos em OPERAÇÕES (round-trips) por instrumento e calcula estatísticas. */
export interface Fill { key: string; time: number; coin: string; px: number; sz: number; side: "B" | "A"; dir: string; fee: number; closedPnl: number; startPosition: number; oid?: number; liq?: boolean; feeToken?: string }
export interface FundingRow { key: string; time: number; coin: string; usd: number }

export interface Trade {
  id: string; coin: string; dir: "LONG" | "SHORT"; openedAt: number; closedAt: number | null; open: boolean;
  entries: number; exits: number; maxSize: number; avgEntry: number | null; avgExit: number | null;
  realizedPnl: number; fees: number; funding: number; netPnl: number; fills: Fill[];
  /** histórico começa com a posição já aberta: preço médio de entrada e abertura são desconhecidos */
  inherited: boolean;
}
export interface TradeStats {
  closedCount: number; openCount: number; wins: number; losses: number; winRate: number | null;
  grossProfit: number; grossLoss: number; profitFactor: number | null;
  realizedPnl: number; fees: number; funding: number; netPnl: number; avgWin: number | null; avgLoss: number | null; maxDrawdown: number;
  byCoin: Record<string, { trades: number; netPnl: number; realizedPnl: number; fees: number; funding: number }>;
}

const EPS = 1e-9;
interface St {
  coin: string; dir: "LONG" | "SHORT"; openedAt: number; cur: number; max: number; inherited: boolean;
  inPx: number; inSz: number; outPx: number; outSz: number; entries: number; exits: number; pnl: number; fees: number; fills: Fill[];
}

function finish(s: St, closedAt: number | null, funding: FundingRow[]): Trade {
  const end = closedAt ?? Infinity;
  // Funding na fronteira é anterior à execução: pertence à posição que está fechando.
  const fund = [...new Map(funding.map((f) => [f.key, f])).values()].filter((f) => f.coin === s.coin && f.time > s.openedAt && f.time <= end).reduce((a, f) => a + f.usd, 0);
  return {
    id: `${s.coin}|${s.openedAt}`, coin: s.coin, dir: s.dir, openedAt: s.openedAt, closedAt, open: closedAt === null,
    entries: s.entries, exits: s.exits, maxSize: s.max, avgEntry: s.inSz > EPS ? s.inPx / s.inSz : null, avgExit: s.outSz > EPS ? s.outPx / s.outSz : null,
    realizedPnl: s.pnl, fees: s.fees, funding: fund, netPnl: s.pnl - s.fees + fund, fills: s.fills, inherited: s.inherited,
  };
}

export function groupTrades(fills: Fill[], funding: FundingRow[]): Trade[] {
  const sorted = [...new Map(fills.map((f) => [f.key, f])).values()].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const byCoin = new Map<string, Fill[]>();
  for (const f of sorted) { const l = byCoin.get(f.coin) ?? []; l.push(f); byCoin.set(f.coin, l); }
  const out: Trade[] = [];
  for (const [coin, list] of byCoin) {
    let a: St | null = null;
    for (const fill of list) {
      let rest: Fill | null = fill;
      while (rest && rest.sz > EPS) {
        const f: Fill = rest; rest = null;
        if (!a) {
          const inh = Math.abs(f.startPosition) > EPS;
          const dir: "LONG" | "SHORT" = inh ? (f.startPosition > 0 ? "LONG" : "SHORT") : f.side === "B" ? "LONG" : "SHORT";
          a = { coin, dir, openedAt: f.time, cur: inh ? Math.abs(f.startPosition) : 0, max: inh ? Math.abs(f.startPosition) : 0, inherited: inh, inPx: 0, inSz: 0, outPx: 0, outSz: 0, entries: 0, exits: 0, pnl: 0, fees: 0, fills: [] };
        }
        const inc = (a.dir === "LONG" && f.side === "B") || (a.dir === "SHORT" && f.side === "A");
        if (inc) {
          a.cur += f.sz; a.max = Math.max(a.max, a.cur); a.inPx += f.px * f.sz; a.inSz += f.sz; a.entries++; a.fees += f.fee; a.pnl += f.closedPnl; a.fills.push(f);
        } else if (f.sz > a.cur + EPS) {
          const k = a.cur / f.sz;
          const close: Fill = { ...f, sz: a.cur, fee: f.fee * k, closedPnl: f.closedPnl };
          a.outPx += close.px * close.sz; a.outSz += close.sz; a.exits++; a.pnl += close.closedPnl; a.fees += close.fee; a.fills.push(close);
          out.push(finish(a, f.time, funding)); a = null;
          rest = { ...f, sz: f.sz - close.sz, fee: f.fee - close.fee, closedPnl: 0, startPosition: 0 };
        } else {
          a.cur -= f.sz; a.outPx += f.px * f.sz; a.outSz += f.sz; a.exits++; a.pnl += f.closedPnl; a.fees += f.fee; a.fills.push(f);
          if (a.cur <= EPS) { out.push(finish(a, f.time, funding)); a = null; }
        }
      }
    }
    if (a) out.push(finish(a, null, funding));
  }
  return out.sort((x, y) => x.openedAt - y.openedAt);
}

export function tradeStats(trades: Trade[]): TradeStats {
  const closed = trades.filter((t) => !t.open);
  let wins = 0, losses = 0, gp = 0, gl = 0;
  for (const t of closed) { if (t.netPnl > EPS) { wins++; gp += t.netPnl; } else if (t.netPnl < -EPS) { losses++; gl += -t.netPnl; } }
  let realizedPnl = 0, fees = 0, funding = 0, netPnl = 0;
  const byCoin: TradeStats["byCoin"] = {};
  for (const t of trades) {
    realizedPnl += t.realizedPnl; fees += t.fees; funding += t.funding; netPnl += t.netPnl;
    const c = (byCoin[t.coin] ??= { trades: 0, netPnl: 0, realizedPnl: 0, fees: 0, funding: 0 });
    c.trades++; c.netPnl += t.netPnl; c.realizedPnl += t.realizedPnl; c.fees += t.fees; c.funding += t.funding;
  }
  let cum = 0, peak = 0, dd = 0;
  for (const t of [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))) { cum += t.netPnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return {
    closedCount: closed.length, openCount: trades.length - closed.length, wins, losses, winRate: wins + losses ? wins / (wins + losses) : null,
    grossProfit: gp, grossLoss: gl, profitFactor: gl > EPS ? gp / gl : null, realizedPnl, fees, funding, netPnl,
    avgWin: wins ? gp / wins : null, avgLoss: losses ? gl / losses : null, maxDrawdown: dd, byCoin,
  };
}

export function filterTrades(trades: Trade[], f: { coin?: string; dir?: "LONG" | "SHORT"; from?: number; to?: number; status?: "open" | "closed" }): Trade[] {
  return trades.filter((t) => {
    if (f.coin && t.coin !== f.coin) return false;
    if (f.dir && t.dir !== f.dir) return false;
    if (f.status === "open" && !t.open) return false;
    if (f.status === "closed" && t.open) return false;
    const ref = t.closedAt ?? t.openedAt;
    return !(f.from != null && ref < f.from) && !(f.to != null && ref > f.to);
  });
}
