"use client";
/** Trading: posições abertas em derivativos de todas as contas e execuções da Estratégia. Somente leitura. */
import { useRisk } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { Notice, Panel, PanelHead, Pill, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

export default function TradingPage() {
  const q = useRisk();
  const f = useFmt();
  const r = q.data;
  if (q.loading || !r) return q.error ? <div className="pt-5"><Notice tone="loss">{q.error.message}</Notice></div> : <div className="pt-5"><Skeleton className="h-64" /></div>;
  const trades = r.strat ? [...r.strat.events].filter((e) => e.k === "trade").sort((a, b) => b.t - a.t).slice(0, 50) : [];
  const fees = r.strat?.fees ?? 0, funding = r.strat?.funding ?? 0;
  return (
    <div className="pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Trading</h1>
      <p className="mb-4 text-[12px] text-muted">Somente acompanhamento: o terminal não envia ordens.</p>
      <Panel className="mb-4 overflow-hidden">
        <PanelHead title="Posições abertas" right={`${r.positions.length} · nocional não somado ao patrimônio`} />
        {r.positions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead><tr className="border-b border-line text-left">{["Instrumento", "Direção", "Quantidade", "Preço médio", "Mark", "Nocional", "Margem", "Alav.", "P&L", "Liquidação", "Funding", "Conta"].map((h) => <th key={h} className="lbl px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {r.positions.map((p) => (
                  <tr key={`${p.accountId}${p.instrument}`}>
                    <td className="px-3 py-2.5 font-medium">{p.instrument}</td>
                    <td className="px-3 py-2.5"><Pill tone={p.dir === "LONG" ? "btc" : "loss"}>{p.dir}</Pill></td>
                    <td className="num px-3 py-2.5 text-right">{f.btc(p.size, 6)}</td>
                    <td className="num px-3 py-2.5 text-right">{p.entry != null ? f.px(p.entry) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{p.mark != null ? f.px(p.mark) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{p.notional != null ? f.money(p.notional, { compact: true }) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{p.margin != null ? f.money(p.margin) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{p.leverage != null ? `${p.leverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</td>
                    <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(p.upnl)))}>{p.upnl != null ? f.money(p.upnl, { signed: true }) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{p.liq != null ? f.px(p.liq) : "—"}</td>
                    <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(p.funding)))}>{p.funding != null ? f.money(p.funding, { signed: true }) : "—"}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{r.accounts.find((a) => a.id === p.accountId)?.institution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 py-5 text-[13px] text-muted">Nenhuma posição aberta nas contas conectadas.</p>}
      </Panel>
      <Panel className="overflow-hidden">
        <PanelHead title="Execuções da Estratégia BTC/USDC" right={r.strat ? `taxas ${f.money(-fees, { signed: true })} · funding ${f.money(funding, { signed: true })} no ciclo` : undefined} />
        {trades.length ? <ul className="divide-y divide-line">{trades.map((e) => e.k === "trade" && (
          <li key={e.key} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="num w-[96px] shrink-0 text-[11px] text-muted">{new Date(e.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span className={cn("w-14 font-medium", e.side === "B" ? "text-gain" : "text-loss")}>{e.side === "B" ? "Compra" : "Venda"}</span>
            <span className="num flex-1">{f.btc(e.sz, 6)} BTC a {f.px(e.px)}</span>
            <span className="num text-muted">taxa {f.money(e.fee)}</span>
          </li>
        ))}</ul> : <p className="px-4 py-5 text-[13px] text-muted">Nenhuma execução no ciclo.</p>}
      </Panel>
    </div>
  );
}
