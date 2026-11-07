"use client";
/**
 * Performance Intelligence. Três visões separadas (nunca misturadas): Estratégia BTC/USDC, Portfólio Consolidado
 * e Trading (diário). Volatilidade e Sharpe só aparecem com amostra mínima de dias.
 */
import { journalStats } from "@bst/domain";
import { usePerformance } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { portfolio } from "@/lib/portfolio/db";
import { fmtDuration } from "@/lib/local/strategy";
import { Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

const need = (n: number, min: number) => `precisa de ${min} dias (há ${n})`;

export default function IntelPage() {
  const q = usePerformance();
  const f = useFmt();
  const v = q.data;
  if (q.loading || !v) return q.error ? <div className="pt-5"><Notice tone="loss">{q.error.message}</Notice></div> : <div className="pt-5"><Skeleton className="h-64" /></div>;
  const s = v.strat;
  const j = journalStats(portfolio().journal);
  const rAll = v.pv.series.length >= 2 ? v.pv.series.at(-1)! : null;
  return (
    <div className="pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Performance Intelligence</h1>
      <p className="mb-4 text-[12px] text-muted">Aportes e retiradas nunca contam como lucro. Métricas estatísticas só com amostra suficiente.</p>

      <Panel className="mb-4 overflow-hidden border-gold/40">
        <PanelHead title={<span className="text-gold">Estratégia BTC/USDC</span>} right={s ? `${s.label} · ${fmtDuration(Date.now() - s.startT)}` : undefined} />
        {s ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ["Resultado", f.money(s.result, { signed: true, compact: true }), toneOf(s.result), undefined],
                ["s/ capital", s.roc != null ? f.pct(s.roc) : "—", toneOf(s.roc), "retorno absoluto %"],
                ["TWR", s.twr != null ? f.pct(s.twr) : "—", toneOf(s.twr), "ponderado no tempo"],
                ["TIR (MWR)", v.sMwr != null && v.spanDays >= 30 ? f.pct(v.sMwr) : "—", toneOf(v.sMwr), v.spanDays < 30 ? "a.a., após 30 dias" : "ponderado pelo dinheiro, a.a."],
                ["Queda máx.", f.pct(-s.maxDD), s.maxDD > 0 ? "loss" : null, undefined],
                ["Volatilidade", v.sStats.volAnnual != null ? f.pct(v.sStats.volAnnual, false) : "—", null, v.sStats.volAnnual != null ? "anualizada" : need(v.sStats.days, 14)],
                ["Sharpe", v.sStats.sharpe != null ? v.sStats.sharpe.toFixed(2).replace(".", ",") : "—", null, v.sStats.sharpe != null ? "taxa livre = 0" : need(v.sStats.days, 30)],
                ["vs. só BTC", s.vsHodlPct != null ? f.pct(s.vsHodlPct) : "—", toneOf(s.vsHodlPct), undefined],
              ].map(([l, val, t, sub], i) => <Kpi key={l as string} className={cn("border-b border-line", i % 2 === 0 && "border-r", "sm:border-r lg:border-b-0")} label={l as string} value={val as string} tone={t as "gain" | "loss" | null} sub={sub as string | undefined} />)}
            </div>
            <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
              <Kpi className="border-r border-line" label="Taxas totais" tone={s.fees ? "loss" : null} value={f.money(-s.fees, { signed: true })} />
              <Kpi className="sm:border-r sm:border-line" label="Funding líquido" tone={toneOf(s.funding)} value={f.money(s.funding, { signed: true })} />
              <Kpi className="border-r border-t border-line sm:border-t-0" label="Realizado" tone={toneOf(s.realized)} value={f.money(s.realized, { signed: true })} />
              <Kpi className="border-t border-line sm:border-t-0" label="Não realizado" tone={toneOf(s.unrealized)} value={f.money(s.unrealized, { signed: true })} />
            </div>
          </>
        ) : <p className="px-4 py-5 text-[13px] text-muted">Nenhum ciclo configurado.</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <Panel className="min-w-0 overflow-hidden lg:col-span-7">
          <PanelHead title="Resultado por ciclo" />
          {v.cycles.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[13px]"><tbody className="divide-y divide-line">
              {v.cycles.map(({ c, r }) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5"><span className="block">{c.name}</span>{c.status === "active" ? <Pill tone="gold">em andamento</Pill> : <Pill>encerrado</Pill>}</td>
                  <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r?.result)))}>{r ? f.money(r.result, { signed: true, compact: true }) : "—"}</td>
                  <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r?.twr)))}>{r?.twr != null ? `TWR ${f.pct(r.twr)}` : "—"}</td>
                  <td className="num px-3 py-2.5 text-right text-ink-2">{r ? `taxas ${f.money(r.fees)}` : ""}</td>
                  <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r?.vsHodlPct)))}>{r?.vsHodlPct != null ? `vs BTC ${f.pct(r.vsHodlPct)}` : ""}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <p className="px-4 py-5 text-[13px] text-muted">Sem ciclos.</p>}
        </Panel>

        <div className="min-w-0 space-y-4 lg:col-span-5">
          <Panel className="overflow-hidden">
            <PanelHead title="Portfólio Consolidado" right={`${v.pv.series.length} retrato(s)`} />
            <KpiGrid className="m-0 grid-cols-2 rounded-none border-0">
              <Kpi label="Resultado (retratos)" tone={toneOf(rAll?.resultUsd)} value={rAll ? f.money(rAll.resultUsd, { signed: true }) : "—"} sub={rAll ? "sem aportes e ajustes" : "a partir do 2º retrato"} />
              <Kpi label="TWR" tone={toneOf(rAll ? rAll.index - 1 : null)} value={rAll ? f.pct(rAll.index - 1) : "—"} />
              <Kpi label="Volatilidade" value={v.pStats.volAnnual != null ? f.pct(v.pStats.volAnnual, false) : "—"} sub={v.pStats.volAnnual != null ? "anualizada" : need(v.pStats.days, 14)} />
              <Kpi label="Sharpe" value={v.pStats.sharpe != null ? v.pStats.sharpe.toFixed(2).replace(".", ",") : "—"} sub={v.pStats.sharpe != null ? "taxa livre = 0" : need(v.pStats.days, 30)} />
            </KpiGrid>
            <div className="border-t border-line">
              <p className="lbl px-4 pt-3">Resultado por ativo (com custo conhecido)</p>
              {v.byAsset.length ? <ul className="divide-y divide-line">{v.byAsset.map((a) => <li key={a.key} className="flex justify-between px-4 py-2 text-[13px]"><span>{a.key}</span><span className={cn("num", toneCls(toneOf(a.pnl)))}>{f.money(a.pnl, { signed: true })} · {f.pct(a.pnl / a.cost)}</span></li>)}</ul>
                : <p className="px-4 py-3 text-[12px] text-muted">Informe o custo de aquisição dos saldos para ver o resultado por ativo.</p>}
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHead title="Trading (diário)" right={`${j.total} registro(s)`} />
            <KpiGrid className="m-0 grid-cols-2 rounded-none border-0">
              <Kpi label="Acertos" value={j.winRate != null ? f.pct(j.winRate, false) : "—"} sub={`${j.closed} encerrada(s)`} />
              <Kpi label="R médio" value={j.avgR != null ? j.avgR.toFixed(2).replace(".", ",") : "—"} sub={`${j.withStop} com stop`} />
              <Kpi label="Expectativa" tone={toneOf(j.expectancyPct)} value={j.expectancyPct != null ? f.pct(j.expectancyPct) : "—"} sub="por operação" />
              <Kpi label="Fator de lucro" value={j.profitFactor != null ? j.profitFactor.toFixed(2).replace(".", ",") : "—"} />
            </KpiGrid>
          </Panel>
        </div>
      </div>
    </div>
  );
}
