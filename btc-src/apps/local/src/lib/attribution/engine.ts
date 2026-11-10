/**
 * Portfolio Attribution Engine (puro): quanto cada ativo contribuiu para o resultado, separando spot e perpétuos,
 * realizado e não realizado, funding recebido e pago, taxas e recompensas. Aportes, retiradas e transferências
 * internas ficam FORA do resultado. Calcula sobre o AttrLedger, o mesmo registro usado pelo Trading Journal.
 */
import type { AttrLedger, FlowRec, Market, Rec, UnrealRow } from "./ledger";
import { resolveRange, type Range, type RangeKind } from "../analytics/analytics";

export interface AttrFilter {
  range: Range; coin?: string | null; exchange?: string | null; accountId?: string | null; strategy?: string | null; market?: Market | null;
}
const EPS = 1e-9;
const inR = (t: number, r: Range) => (r.from == null || t >= r.from) && t <= r.to;

export function matchRec(r: Pick<Rec, "t" | "asset" | "exchange" | "accountId" | "strategy" | "market">, f: AttrFilter): boolean {
  return inR(r.t, f.range) && (!f.coin || r.asset === f.coin) && (!f.exchange || r.exchange === f.exchange) && (!f.accountId || r.accountId === f.accountId) && (!f.strategy || r.strategy === f.strategy) && (!f.market || r.market === f.market);
}
const matchUnreal = (u: UnrealRow, f: AttrFilter) => (!f.coin || u.asset === f.coin) && (!f.exchange || u.exchange === f.exchange) && (!f.accountId || u.accountId === f.accountId) && (!f.strategy || u.strategy === f.strategy) && (!f.market || u.market === f.market);

export interface Parts { realized: number; fees: number; fundingIn: number; fundingOut: number; funding: number; rewards: number; net: number }
const zero = (): Parts => ({ realized: 0, fees: 0, fundingIn: 0, fundingOut: 0, funding: 0, rewards: 0, net: 0 });
function add(p: Parts, r: Rec) {
  if (r.kind === "realized") p.realized += r.usd;
  else if (r.kind === "fee") p.fees += r.usd; // negativo
  else if (r.kind === "funding") { p.funding += r.usd; if (r.usd >= 0) p.fundingIn += r.usd; else p.fundingOut += r.usd; }
  else p.rewards += r.usd;
  p.net += r.usd;
}
export interface AssetAttr {
  asset: string; perp: Parts; spot: Parts; other: Parts; total: Parts;
  unrealizedPerp: number | null; unrealizedSpot: number | null; unrealizedReason: string | null;
  /** operações (perpétuos) que contribuíram, com o resultado de cada uma no período */
  trades: { uid: string; net: number }[]; fills: number;
  /** parcela do resultado líquido total do recorte (pode ser negativa ou >100%); null se o total é ~0 */ share: number | null;
}
export interface Flows { deposits: number; withdrawals: number; internal: number; net: number; count: number }
export interface Attribution {
  filter: AttrFilter; rows: AssetAttr[]; total: Parts; perp: Parts; spot: Parts; other: Parts;
  unrealized: { perp: number; spot: number; total: number; unknown: string[] };
  flows: Flows | null; recCount: number; notes: string[];
}

export function attribute(l: AttrLedger, f: AttrFilter): Attribution {
  const rows = new Map<string, AssetAttr>();
  const get = (asset: string): AssetAttr => {
    let x = rows.get(asset);
    if (!x) { x = { asset, perp: zero(), spot: zero(), other: zero(), total: zero(), unrealizedPerp: null, unrealizedSpot: null, unrealizedReason: null, trades: [], fills: 0, share: null }; rows.set(asset, x); }
    return x;
  };
  const total = zero(), perp = zero(), spot = zero(), other = zero();
  const byTrade = new Map<string, Map<string, number>>();
  let recCount = 0;
  for (const r of l.recs) {
    if (!matchRec(r, f)) continue;
    recCount++;
    const x = get(r.asset);
    add(x[r.market], r); add(x.total, r);
    add(total, r); add(r.market === "perp" ? perp : r.market === "spot" ? spot : other, r);
    if (r.kind === "realized" || r.kind === "fee") x.fills++;
    if (r.tradeUid) { const m = byTrade.get(r.asset) ?? new Map<string, number>(); m.set(r.tradeUid, (m.get(r.tradeUid) ?? 0) + r.usd); byTrade.set(r.asset, m); }
  }
  for (const [asset, m] of byTrade) get(asset).trades = [...m].map(([uid, net]) => ({ uid, net })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  // não realizado: situação de AGORA (não é do período), só entra nos recortes compatíveis
  const un = { perp: 0, spot: 0, total: 0, unknown: [] as string[] };
  for (const u of l.unreal) {
    if (!matchUnreal(u, f)) continue;
    const x = get(u.asset);
    if (u.usd == null) { un.unknown.push(`${u.asset} (${u.market === "spot" ? "spot" : "perp"})${u.reason ? `: ${u.reason}` : ""}`); if (u.market === "spot") { x.unrealizedReason = u.reason; } continue; }
    if (u.market === "perp") { x.unrealizedPerp = (x.unrealizedPerp ?? 0) + u.usd; un.perp += u.usd; } else { x.unrealizedSpot = (x.unrealizedSpot ?? 0) + u.usd; un.spot += u.usd; }
    un.total += u.usd;
  }
  const list = [...rows.values()].filter((x) => x.total.net !== 0 || x.fills > 0 || x.unrealizedPerp != null || x.unrealizedSpot != null || x.total.funding !== 0);
  for (const x of list) x.share = Math.abs(total.net) > EPS ? x.total.net / total.net : null;
  list.sort((a, b) => Math.abs(b.total.net) - Math.abs(a.total.net));

  // movimentações: só fazem sentido para o conjunto da conta (não por ativo/estratégia/mercado)
  let flows: Flows | null = null;
  if (!f.coin && !f.strategy && !f.market) {
    flows = { deposits: 0, withdrawals: 0, internal: 0, net: 0, count: 0 };
    for (const fl of l.flows) {
      if (!inR(fl.t, f.range) || (f.exchange && fl.exchange !== f.exchange) || (f.accountId && fl.accountId !== f.accountId)) continue;
      flows.count++;
      if (fl.cls === "deposit") flows.deposits += fl.usd; else if (fl.cls === "withdraw") flows.withdrawals += fl.usd; else flows.internal += fl.usd;
    }
    flows.net = flows.deposits - flows.withdrawals;
  }
  return { filter: f, rows: list, total, perp, spot, other, unrealized: un, flows, recCount, notes: l.notes };
}

// ───────── decomposição (waterfall) ─────────
export interface WfStep { key: string; label: string; value: number; kind: "delta" | "total"; note?: string }
export interface WfBar extends WfStep { base: number; up: number; down: number; end: number }

/** Passos do resultado atribuído. Linhas sem valor ficam de fora para o gráfico não ter degraus vazios. */
export function waterfallSteps(a: Attribution, bridge: Bridge | null): WfStep[] {
  const s: WfStep[] = ([
    { key: "perp", label: "Realizado perp", value: a.perp.realized, kind: "delta" },
    { key: "spot", label: "Realizado spot", value: a.spot.realized, kind: "delta" },
    { key: "fin", label: "Funding recebido", value: a.total.fundingIn, kind: "delta" },
    { key: "fout", label: "Funding pago", value: a.total.fundingOut, kind: "delta" },
    { key: "fee", label: "Taxas", value: a.total.fees, kind: "delta" },
    { key: "rew", label: "Recompensas", value: a.total.rewards, kind: "delta" },
  ] as WfStep[]).filter((x) => Math.abs(x.value) > EPS || x.key === "perp");
  s.push({ key: "net", label: "Resultado líquido", value: a.total.net, kind: "total" });
  if (bridge && bridge.available) {
    s.push({ key: "resid", label: "Aberto e outros", value: bridge.residual ?? 0, kind: "delta", note: "variação do P&L aberto, spot e itens não modelados" });
    s.push({ key: "eq", label: "Resultado patrimonial", value: (a.total.net) + (bridge.residual ?? 0), kind: "total" });
  }
  return s;
}
/** Converte os passos em barras empilhadas (base invisível + alta/baixa) para o gráfico. */
export function waterfallBars(steps: WfStep[]): WfBar[] {
  let run = 0;
  return steps.map((s) => {
    if (s.kind === "total") { const v = s.value; run = v; return { ...s, base: Math.min(0, v), up: v >= 0 ? v : 0, down: v < 0 ? -v : 0, end: v }; }
    const start = run, end = run + s.value; run = end;
    return { ...s, base: Math.min(start, end), up: s.value >= 0 ? s.value : 0, down: s.value < 0 ? -s.value : 0, end };
  });
}

// ───────── ponte com o patrimônio ─────────
export interface Bridge { available: boolean; reason: string | null; startEquity: number | null; endEquity: number | null; delta: number | null; flowsNet: number; attributed: number; residual: number | null }
/**
 * Variação do patrimônio = aportes líquidos + resultado atribuído + resíduo. O resíduo é tudo o que o histórico não
 * explica (P&L aberto, spot sem custo, diferenças de arredondamento): é mostrado, nunca escondido.
 */
export function bridge(startEquity: number | null, endEquity: number | null, flowsNet: number, attributed: number): Bridge {
  if (startEquity == null || endEquity == null) return { available: false, reason: "Histórico patrimonial insuficiente neste período (menos de 2 retratos).", startEquity, endEquity, delta: null, flowsNet, attributed, residual: null };
  const delta = endEquity - startEquity;
  return { available: true, reason: null, startEquity, endEquity, delta, flowsNet, attributed, residual: delta - flowsNet - attributed };
}

// ───────── períodos ─────────
export const PERIODS: { kind: RangeKind; label: string }[] = [{ kind: "1", label: "24h" }, { kind: "7", label: "7 dias" }, { kind: "30", label: "30 dias" }, { kind: "90", label: "90 dias" }, { kind: "ytd", label: "Ano" }, { kind: "all", label: "Tudo" }];
export function byPeriod(l: AttrLedger, f: Omit<AttrFilter, "range">, now: number) {
  return PERIODS.map((p) => { const a = attribute(l, { ...f, range: resolveRange(p.kind, now) }); return { ...p, net: a.total.net, realized: a.total.realized, funding: a.total.funding, fees: a.total.fees, count: a.recCount }; });
}

// ───────── ligação com o Trading Journal ─────────
export interface JournalLink { coin?: string; from?: number | null; to?: number | null; acc?: string | null; strategy?: string | null; market?: Market | null; trade?: string | null; exchange?: string | null }
/** Endereço do Journal já filtrado (ativo e período iguais aos da atribuição). */
export function journalHref(l: JournalLink): string {
  const q = new URLSearchParams();
  if (l.coin) q.set("coin", l.coin);
  if (l.from != null) q.set("from", String(Math.round(l.from)));
  if (l.to != null) q.set("to", String(Math.round(l.to)));
  if (l.acc) q.set("acc", l.acc);
  if (l.strategy) q.set("strat", l.strategy);
  if (l.market) q.set("market", l.market);
  if (l.exchange) q.set("ex", l.exchange);
  if (l.trade) q.set("trade", l.trade);
  const s = q.toString();
  return `/diario${s ? `?${s}` : ""}`;
}
export function attributionHref(l: JournalLink): string {
  const q = new URLSearchParams();
  if (l.coin) q.set("coin", l.coin);
  if (l.from != null) q.set("from", String(Math.round(l.from)));
  if (l.to != null) q.set("to", String(Math.round(l.to)));
  if (l.acc) q.set("acc", l.acc);
  if (l.strategy) q.set("strat", l.strategy);
  if (l.market) q.set("market", l.market);
  const s = q.toString();
  return `/inteligencia${s ? `?${s}` : ""}`;
}

/** Contribuição de UMA operação (caminho inverso: Journal → Attribution). */
export interface TradeContribution { net: number; parts: Parts; assetNet: number; totalNet: number; shareOfAsset: number | null; shareOfTotal: number | null; rank: number | null; inRange: boolean }
export function tradeContribution(l: AttrLedger, uid: string, asset: string, f: AttrFilter): TradeContribution {
  const parts = zero();
  for (const r of l.recs) if (r.tradeUid === uid && inR(r.t, f.range)) add(parts, r);
  const a = attribute(l, { ...f, coin: null, strategy: null, market: null });
  const row = a.rows.find((x) => x.asset === asset);
  const assetNet = row?.total.net ?? 0;
  const rank = row ? [...row.trades].sort((x, y) => y.net - x.net).findIndex((x) => x.uid === uid) : -1;
  return {
    net: parts.net, parts, assetNet, totalNet: a.total.net, inRange: Math.abs(parts.net) > EPS || row?.trades.some((x) => x.uid === uid) === true,
    shareOfAsset: Math.abs(assetNet) > EPS ? parts.net / assetNet : null, shareOfTotal: Math.abs(a.total.net) > EPS ? parts.net / a.total.net : null, rank: rank >= 0 ? rank + 1 : null,
  };
}
export type { FlowRec };
