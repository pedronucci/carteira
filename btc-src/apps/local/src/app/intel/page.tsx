"use client";
/**
 * Performance Analytics (antes "Performance Intelligence"; a rota /inteligencia continua). Três visões separadas (nunca misturadas): Estratégia BTC/USDC, Portfólio Consolidado
 * e Trading (diário). Volatilidade e Sharpe só aparecem com amostra mínima de dias.
 */
import { journalStats } from "@bst/domain";
import { usePerformance } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { portfolio } from "@/lib/portfolio/db";
import { fmtDuration } from "@/lib/local/strategy";
import { AnalyticsSection } from "./analytics";
import { AttributionSection } from "./attribution";
import { Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

const need = (n: number, min: number) => `precisa de ${min} dias (há ${n})`;

export default function IntelPage() {
  const q = usePerformance();
  const f = useFmt();
  const v = q.data;
  if (q.loading || !v) return q.error ? <div className="pt-5"><Notice tone="loss">{q.error.message}</Notice></div> : <div className="pt-5"><Skeleton className="h-64" /></div>;

  const j = journalStats(portfolio().journal);
  const rAll = v.pv.series.length >= 2 && v.pv.series.every(p=>p.valid) ? v.pv.series.at(-1)! : null;
  return (
    <div className="pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Performance Analytics</h1>
      <p className="mb-4 text-[12px] text-muted">Aportes e retiradas nunca contam como lucro. Métricas estatísticas só com amostra suficiente.</p>

      <AttributionSection />

      {v.pv.warnings.map(w=><Notice key={w}>{w}</Notice>)}
      <AnalyticsSection strategyStart={null} />
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-12">
          <Panel className="overflow-hidden">
            <PanelHead title="Portfólio Consolidado" right={`${v.pv.series.length} retrato(s)`} />
            <KpiGrid className="m-0 grid-cols-2 rounded-none border-0">
              <Kpi label="Resultado (retratos)" tone={toneOf(rAll?.resultUsd)} value={rAll ? f.money(rAll.resultUsd, { signed: true }) : "—"} sub={rAll ? "sem aportes e ajustes" : "a partir do 2º retrato"} />
              <Kpi label="Retorno ajustado" tone={toneOf(rAll ? rAll.index - 1 : null)} value={rAll ? f.pct(rAll.index - 1) : "—"} />
              <Kpi label="Volatilidade" value={v.pStats.volAnnual != null ? f.pct(v.pStats.volAnnual, false) : "—"} sub={v.pStats.volAnnual != null ? "anualizada" : need(v.pStats.days, 14)} />
              <Kpi label="Sharpe" value={v.pStats.sharpe != null ? v.pStats.sharpe.toFixed(2).replace(".", ",") : "—"} sub={v.pStats.sharpe != null ? "taxa livre = 0" : need(v.pStats.days, 30)} />
            </KpiGrid>
            <div className="border-t border-line">
              <p className="lbl px-4 pt-3">Resultado por ativo (com custo conhecido)</p>
              {v.byAsset.length ? <ul className="divide-y divide-line">{v.byAsset.map((a) => <li key={a.key} className="flex justify-between px-4 py-2 text-[13px]"><span>{a.key}</span><span className={cn("num", toneCls(toneOf(a.pnl)))}>{f.money(a.pnl, { signed: true })} · {f.pct(a.cost > 0 ? a.pnl / a.cost : null)}</span></li>)}</ul>
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
