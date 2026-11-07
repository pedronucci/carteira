/**
 * Retrato inicial de um ciclo da estratégia.
 * - Início "agora" com a Hyperliquid ao vivo → retrato oficial (saldos, posições, margem).
 * - Início no passado → reconstruído: valor oficial da conta (histórico do endpoint portfolio),
 *   tamanho da posição pela primeira execução depois do início (startPosition é oficial),
 *   preço pela vela de 1 h da Hyperliquid.
 * - Sem dados suficientes → o usuário informa (referência manual).
 */
import { getStore } from "./store";
import { closeUsdAt, prices } from "./prices";
import { hlState, btcMarkAt, seriesAt } from "./hl";
import { account, accountStateAt, officialNow } from "./engine";
import { DAY, type StartSnapshot } from "./strategy";

export interface SnapResult { snap: StartSnapshot | null; missing: ("equity" | "arb" | "position")[]; detail: string[] }

export async function buildSnapshot(startAt: number, opts: { arbUsd?: number } = {}): Promise<SnapResult> {
  const s = getStore();
  const acc = account(s);
  const nowMs = Date.now();
  const spot = prices().spot?.btcUsd ?? (s.settings.manualBtcUsd ? Number(s.settings.manualBtcUsd) : null);
  const detail: string[] = [];
  const missing: SnapResult["missing"] = [];

  if (acc.kind === "hl") {
    const live = acc.live;
    // começo agora: retrato oficial ao vivo
    if (Math.abs(nowMs - startAt) < 5 * 60e3 && acc.liveFresh && live) {
      const btc = live.positions.find((p) => p.coin === "BTC" && p.szi > 0);
      return {
        missing, detail: ["Retrato oficial da Hyperliquid, ao vivo."],
        snap: {
          at: startAt, source: "live", equityUsd: String(officialNow(acc) ?? live.total), btcUsd: String(spot ?? btc?.entryPx ?? 0),
          balances: live.balances.map((b) => ({ coin: b.coin, where: b.where, total: String(b.total), usd: b.usd != null ? String(b.usd) : null })),
          positions: live.positions.map((p) => ({ coin: p.coin, size: String(p.szi), mark: String(p.coin === "BTC" ? spot ?? p.entryPx : p.entryPx), officialEntry: String(p.entryPx), upnl: String(p.upnl), marginUsed: String(p.marginUsed), liqPx: p.liqPx != null ? String(p.liqPx) : undefined })),
          marginUsed: String(live.positions.reduce((a, p) => a + p.marginUsed, 0)),
          accountPnlUsd: hlState().history?.pnl.length ? String(hlState().history!.pnl.at(-1)![1]) : undefined,
        },
      };
    }
    const h = hlState().history;
    if (!h) return { snap: null, missing: ["equity"], detail: ["Histórico da Hyperliquid ainda não sincronizado."] };
    // patrimônio oficial no instante
    const flows = h.ledger.filter((l) => l.kind !== "INTERNAL").map((l): [number, number] => [l.time, l.kind === "IN" ? l.amount : -l.amount]);
    let equity = seriesAt(h.accountValue, startAt, 6 * 3600e3, flows);
    if (equity != null) detail.push("Patrimônio pelo histórico oficial de valor da conta (Hyperliquid).");
    else if (!acc.truncated && !acc.otherCoins.length) {
      const st = accountStateAt(startAt);
      equity = st.equity; detail.push("Patrimônio reconstruído pelas execuções, depósitos e funding.");
    } else missing.push("equity");
    // posição BTC no instante: a primeira execução depois do início diz o tamanho que havia (startPosition)
    const btcFills = h.fills.filter((f) => f.coin === "BTC");
    const after = btcFills.find((f) => f.time > startAt);
    let size: number | null = after ? Math.max(0, after.startPosition) : (live ? Math.max(0, live.positions.find((p) => p.coin === "BTC")?.szi ?? 0) : null);
    if (size == null) missing.push("position");
    else detail.push(size > 0 ? "Posição em BTC aberta no início (herdada)." : "Sem posição em BTC no início.");
    // entrada oficial da posição herdada: média das compras desde que ela abriu
    let officialEntry: number | undefined;
    if (size && size > 0) {
      let sz = 0, n = 0;
      for (const f of btcFills) { if (f.time > startAt) break; if (f.startPosition <= 1e-9 && f.side === "B") { sz = 0; n = 0; } if (f.side === "B") { sz += f.sz; n += f.sz * f.px; } }
      if (sz > 0) officialEntry = n / sz;
    }
    const mark = (await btcMarkAt(startAt)) ?? closeUsdAt(Math.floor(startAt / 1000 / DAY) * DAY + DAY - 1) ?? spot ?? 0;
    if (acc.includeArb) {
      if (opts.arbUsd == null) missing.push("arb");
      else if (equity != null) equity += opts.arbUsd;
    }
    if (equity == null || size == null || (acc.includeArb && opts.arbUsd == null)) return { snap: null, missing, detail };
    const pnl = seriesAt(h.pnl, startAt);
    return {
      missing, detail,
      snap: {
        at: startAt, source: "reconstructed", equityUsd: equity.toFixed(2), btcUsd: String(mark),
        balances: acc.includeArb && opts.arbUsd ? [{ coin: "USDC", where: "arb", total: String(opts.arbUsd), usd: String(opts.arbUsd) }] : [],
        positions: size > 0 ? [{ coin: "BTC", size: String(size), mark: String(mark), officialEntry: officialEntry ? officialEntry.toFixed(2) : undefined, upnl: officialEntry ? String(size * (mark - officialEntry)) : undefined }] : [],
        accountPnlUsd: pnl != null ? pnl.toFixed(2) : undefined,
        note: detail.join(" "),
      },
    };
  }

  // lançamentos manuais: o próprio histórico diz o estado no início
  if (acc.firstT == null || startAt < acc.firstT) return { snap: null, missing: ["equity"], detail: ["Sem lançamentos antes do início: informe o patrimônio inicial."] };
  const st = accountStateAt(startAt);
  const px = st.px || spot || 0;
  return {
    missing, detail: ["Calculado pelos seus lançamentos até o início."],
    snap: {
      at: startAt, source: "reconstructed", equityUsd: st.equity.toFixed(2), btcUsd: String(px),
      balances: [], positions: st.size > 0 ? [{ coin: "BTC", size: String(st.size), mark: String(px) }] : [],
      note: "Calculado pelos lançamentos manuais.",
    },
  };
}
