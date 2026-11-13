/** Reconciliação dos perpétuos por conta e por ativo. Não declara "conciliado" só porque o saldo de hoje coincide. */
import type { Fill, FundingRow, Trade } from "./trades";
import { orderFills } from "./fill-order";

export type ReconStatus = "reconciled" | "divergence" | "incomplete" | "stale" | "partial";
export const RECON_LABEL: Record<ReconStatus, string> = { reconciled: "Conciliado", divergence: "Divergência identificada", incomplete: "Histórico incompleto", stale: "Dados desatualizados", partial: "Reconciliação parcial" };

export interface Divergence { at: number | null; coin: string; type: string; expected: number | null; found: number | null; diff: number; source: string; status: "aberta" | "informativa" }
export interface ReconInput {
  now: number; liveAt: number | null; officialEquity: number | null; livePositions: { coin: string; szi: number; upnl: number }[];
  fills: Fill[]; funding: FundingRow[]; trades: Trade[];
  /** depósitos/saques externos já classificados (positivo = entrou) */
  netExternalFlows: number | null; startEquity: number | null; historyTruncated: boolean; staleMs?: number; tolerance?: number;
  /** início da janela do modelo de equity (instante do patrimônio inicial); fills antes disso só entram na checagem de tamanho */
  since?: number; unmodeledSpot?: boolean;
  /** resultado fora das execuções e do funding, dentro da janela: recompensas (+) e taxas de saque/envio (−) */
  otherIncome?: number;
}
export interface ReconCoin { coin: string; realized: number; fees: number; funding: number; upnl: number; net: number; positionFromFills: number; positionLive: number; positionOk: boolean }
export interface ReconResult { status: ReconStatus; reasons: string[]; byCoin: ReconCoin[]; expectedEquity: number | null; officialEquity: number | null; equityDiff: number | null; divergences: Divergence[] }

const EPS = 1e-6;

export function reconcilePerps(i: ReconInput): ReconResult {
  const reasons: string[] = [], divergences: Divergence[] = [];
  const coins = [...new Set([...i.fills.map((f) => f.coin), ...i.livePositions.map((p) => p.coin)])];
  const sorted = orderFills(i.fills);
  const byCoin: ReconCoin[] = coins.map((coin) => {
    const fs = sorted.filter((f) => f.coin === coin);
    const last = fs[fs.length - 1];
    const fromFills = last ? last.startPosition + (last.side === "B" ? last.sz : -last.sz) : 0;
    const live = i.livePositions.find((p) => p.coin === coin);
    const liveSz = live?.szi ?? 0;
    const w = fs.filter((f) => f.time >= (i.since ?? 0));
    const realized = w.reduce((a, f) => a + f.closedPnl, 0), fees = w.reduce((a, f) => a + f.fee, 0);
    const fund = i.funding.filter((f) => f.coin === coin && f.time >= (i.since ?? 0)).reduce((a, f) => a + f.usd, 0);
    const upnl = live?.upnl ?? 0;
    const tol = Math.max(EPS, Math.abs(liveSz) * 1e-6);
    const ok = Math.abs(fromFills - liveSz) <= tol;
    if (!ok) divergences.push({ at: last?.time ?? null, coin, type: "Tamanho da posição", expected: fromFills, found: liveSz, diff: liveSz - fromFills, source: "execuções × posição ao vivo", status: "aberta" });
    return { coin, realized, fees, funding: fund, upnl, net: realized - fees + fund + upnl, positionFromFills: fromFills, positionLive: liveSz, positionOk: ok };
  });

  let expectedEquity: number | null = null, equityDiff: number | null = null;
  const openAtStart = i.since != null && i.trades.some((x) => x.openedAt < i.since! && (x.closedAt == null || x.closedAt >= i.since!));
  if (openAtStart) reasons.push("Havia posição aberta no início da janela: o P&L não realizado inicial é desconhecido, então o equity não pode ser reconstruído com exatidão.");
  if (i.unmodeledSpot) reasons.push("Há saldos spot de moedas voláteis (ex.: HYPE) cujo valor varia fora do modelo de perpétuos.");
  const canModel = i.startEquity != null && i.netExternalFlows != null && !openAtStart && !i.unmodeledSpot;
  if (canModel) {
    expectedEquity = i.startEquity! + i.netExternalFlows! + (i.otherIncome ?? 0) + byCoin.reduce((a, c) => a + c.net, 0);
    if (i.officialEquity != null) {
      equityDiff = i.officialEquity - expectedEquity;
      const tol = i.tolerance ?? Math.max(5, Math.abs(i.officialEquity) * 0.01);
      if (Math.abs(equityDiff) > tol) divergences.push({ at: null, coin: "Conta", type: "Equity da conta", expected: expectedEquity, found: i.officialEquity, diff: equityDiff, source: "equity oficial × modelo do terminal", status: "aberta" });
    }
  } else if (i.startEquity == null || i.netExternalFlows == null) reasons.push("Sem patrimônio inicial ou fluxos externos classificados: o saldo não pôde ser reconstruído.");

  const inherited = i.trades.filter((t) => t.inherited).map((t) => t.coin);
  if (inherited.length) { reasons.push(`Posição herdada (aberta antes do histórico): ${[...new Set(inherited)].join(", ")}.`); for (const c of new Set(inherited)) divergences.push({ at: null, coin: c, type: "Posição herdada", expected: null, found: null, diff: 0, source: "histórico de execuções", status: "informativa" }); }
  if (i.historyTruncated) reasons.push("O histórico da Hyperliquid pode estar truncado (limite de execuções da API).");
  const stale = i.liveAt == null || i.now - i.liveAt > (i.staleMs ?? 5 * 60e3);
  if (stale) reasons.push("Saldo ao vivo desatualizado.");

  const hasDiv = divergences.some((d) => d.status === "aberta");
  const status: ReconStatus = stale ? "stale" : hasDiv ? "divergence" : i.historyTruncated || inherited.length ? "incomplete" : !canModel ? "partial" : "reconciled";
  return { status, reasons, byCoin, expectedEquity, officialEquity: i.officialEquity, equityDiff, divergences };
}
