/**
 * Retratos patrimoniais (evolução do Portfólio Consolidado): migração, remoção de duplicatas, séries por período
 * e rentabilidade ajustada por fluxos. Funções puras; nada aqui inventa dado: sem retrato suficiente, devolve `incomplete`.
 */
import { portfolioReturns, type PSnapshot } from "./portfolio";

export const SNAPSHOT_BUCKET_MS = 3600e3;
export type EvoPeriod = "1" | "7" | "30" | "90" | "365" | "all";
export type EvoCcy = "USD" | "BRL" | "BTC";
export interface Flow { t: number; accountId: string; usd: number }
/** Uma única seleção temporal para retorno, drawdown e benchmark; preserva a âncora real. */
export function selectSnapshotRange(snaps: PSnapshot[], range: { from: number | null; to: number }): PSnapshot[] {
  const all = [...snaps].filter((s) => s.t <= range.to).sort((a, b) => a.t - b.t);
  if (range.from == null) return all;
  let anchor = -1;
  for (let i = 0; i < all.length; i++) if (all[i]!.t <= range.from) anchor = i;
  return anchor >= 0 ? all.slice(anchor) : all.filter((s) => s.t >= range.from!);
}

export const snapshotTotal = (s: PSnapshot) => (s.total != null && Number.isFinite(s.total) ? s.total : Object.values(s.byAccount).reduce((x, v) => x + v, 0));

/** Normaliza (v1 → v2), descarta retratos inválidos, ordena e mantém só o último de cada hora. Nunca descarta dados válidos além da duplicata. */
export function migrateSnapshots(raw: PSnapshot[], bucketMs = SNAPSHOT_BUCKET_MS): PSnapshot[] {
  const ok = raw.filter((s) => s && Number.isFinite(s.t) && s.t > 0 && s.byAccount && Object.values(s.byAccount).every((v) => Number.isFinite(v)) && Object.keys(s.byAccount).length > 0);
  const norm = ok.map((s) => ({ ...s, v: 2 as const, total: snapshotTotal(s) })).sort((a, b) => a.t - b.t);
  const byBucket = new Map<number, PSnapshot>();
  for (const s of norm) byBucket.set(Math.floor(s.t / bucketMs), s);
  return [...byBucket.values()].sort((a, b) => a.t - b.t);
}

/** Decide se grava um novo retrato: no máximo um por hora, salvo `force` (que substitui o da mesma hora) e nunca em duplicata exata. */
export function nextSnapshots(list: PSnapshot[], snap: PSnapshot, force = false, bucketMs = SNAPSHOT_BUCKET_MS, max = 5000): PSnapshot[] {
  const last = list[list.length - 1];
  const sameBucket = last && Math.floor(last.t / bucketMs) === Math.floor(snap.t / bucketMs);
  if (last && !force && sameBucket) return list;
  if (last && snap.t <= last.t && !force) return list;
  const base = sameBucket ? list.slice(0, -1) : list;
  return [...base, snap].slice(-max);
}

export const periodMs = (p: EvoPeriod) => (p === "all" ? null : Number(p) * 86400e3);

/** Valor do retrato na moeda pedida; BRL/BTC usam o câmbio/preço do próprio retrato ou, na falta, o de referência (marcado como aproximado). */
export function snapValue(s: PSnapshot, ccy: EvoCcy, fb: { usdBrl?: number | null; btcUsd?: number | null }): { v: number | null; approx: boolean } {
  const usd = snapshotTotal(s);
  if (ccy === "USD") return { v: usd, approx: false };
  if (ccy === "BRL") { const fx = s.usdBrl ?? fb.usdBrl ?? null; return { v: fx ? usd * fx : null, approx: s.usdBrl == null && fx != null }; }
  const px = s.btcUsd ?? fb.btcUsd ?? null;
  return { v: px ? usd / px : null, approx: s.btcUsd == null && px != null };
}

export interface EvoResult {
  points: { t: number; usd: number; value: number | null; perpsUpnl: number | null }[];
  /** variação bruta do patrimônio (inclui aportes e retiradas) */
  rawChangeUsd: number | null;
  /** aportes − retiradas externos dentro da janela */
  flowsUsd: number;
  /** resultado sem aportes/retiradas */
  resultUsd: number | null;
  /** rentabilidade ponderada no tempo sem fluxos */
  twr: number | null;
  fromT: number | null;
  toT: number | null;
  /** janela pedida sem retratos suficientes (a série mostra só o que existe) */
  incomplete: boolean;
  /** primeiro retrato disponível, quando a janela pedida começa antes dele */
  availableFrom: number | null;
  approx: boolean;
  count: number;
}

export function evolution(snaps: PSnapshot[], flows: Flow[], period: EvoPeriod, ccy: EvoCcy, now: number, fb: { usdBrl?: number | null; btcUsd?: number | null } = {}): EvoResult {
  const all = [...snaps].sort((a, b) => a.t - b.t);
  const win = periodMs(period);
  const start = win == null ? -Infinity : now - win;
  // inclui o último retrato anterior à janela como âncora (a variação começa nele)
  let anchor = -1;
  for (let i = 0; i < all.length; i++) if (all[i]!.t <= start) anchor = i;
  const sel = win == null ? all : all.slice(anchor >= 0 ? anchor : all.findIndex((s) => s.t > start) < 0 ? all.length : all.findIndex((s) => s.t > start));
  const empty = { points: [], rawChangeUsd: null, flowsUsd: 0, resultUsd: null, twr: null, fromT: null, toT: null, incomplete: true, availableFrom: all[0]?.t ?? null, approx: false, count: 0 } satisfies EvoResult;
  if (!sel.length) return empty;
  let approx = false;
  const rets = portfolioReturns(sel, flows);
  const points = sel.map((s) => { const sv = snapValue(s, ccy, fb); if (sv.approx) approx = true; return { t: s.t, usd: snapshotTotal(s), value: sv.v, perpsUpnl: s.perps ? s.perps.upnl : null }; });
  const first = sel[0]!, last = sel[sel.length - 1]!;
  const fl = flows.filter((f) => f.t > first.t && f.t <= last.t).reduce((x, f) => x + f.usd, 0);
  const tooShort = sel.length < 2;
  // janela mal coberta: o primeiro retrato disponível está bem depois do início pedido (> 15% da janela)
  const gap = win != null && anchor < 0 && first.t - start > win * 0.15;
  const r = rets[rets.length - 1]!;
  return {
    points, rawChangeUsd: tooShort ? null : snapshotTotal(last) - snapshotTotal(first), flowsUsd: fl,
    resultUsd: tooShort || !r.valid ? null : r.resultUsd, twr: tooShort || !r.valid ? null : r.index - 1, fromT: first.t, toT: last.t,
    incomplete: tooShort || gap || !r.valid, availableFrom: gap || tooShort ? first.t : null, approx, count: sel.length,
  };
}

/** Variação de valor por ativo entre o primeiro e o último retrato da janela que têm `byAsset` (inclui compras/vendas; não é rentabilidade). */
export function assetChanges(snaps: PSnapshot[], period: EvoPeriod, now: number) {
  const win = periodMs(period);
  const withAssets = [...snaps].filter((s) => s.byAsset && Object.keys(s.byAsset).length).sort((a, b) => a.t - b.t);
  const inWin = win == null ? withAssets : withAssets.filter((s) => s.t >= now - win);
  if (inWin.length < 2) return { rows: [] as { key: string; from: number; to: number; changeUsd: number; changePct: number | null }[], fromT: null as number | null, available: false };
  const a = inWin[0]!, b = inWin[inWin.length - 1]!;
  const keys = new Set([...Object.keys(a.byAsset!), ...Object.keys(b.byAsset!)]);
  const rows = [...keys].map((key) => { const from = a.byAsset![key] ?? 0, to = b.byAsset![key] ?? 0; return { key, from, to, changeUsd: to - from, changePct: from > 0 ? to / from - 1 : null }; }).sort((x, y) => y.to - x.to);
  return { rows, fromT: a.t, available: true };
}

/** Retorno do BTC (Buy & Hold) no mesmo intervalo, a partir dos preços gravados nos retratos. */
export function btcReturn(snaps: PSnapshot[], fromT: number | null, toT: number | null): number | null {
  if (fromT == null || toT == null) return null;
  const a = snaps.find((s) => s.t === fromT)?.btcUsd, b = snaps.find((s) => s.t === toT)?.btcUsd;
  return a && b ? b / a - 1 : null;
}
