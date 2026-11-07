"use client";
import { useMemo, useState } from "react";
import { NeedsSetup, useSnapshot } from "@/lib/api";
import { StrategySetup } from "@/components/strategy";
import { useFmt } from "@/lib/state";
import { drawdownPoints, inCcy, periodReturn } from "@/lib/local/engine";
import { Kpi, KpiGrid, Notice, Panel, PanelHead, Row, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { Hero } from "@/components/shell";
import { BtcChart, C, DrawdownChart, EquityChart } from "@/components/charts";

function PeriodKpi({ label, r }: { label: string; r: { pct: number; money: number } | null }) {
  const f = useFmt();
  return <Kpi label={label} tone={r ? toneOf(r.pct) : null} value={r ? f.pct(r.pct) : "—"} sub={r ? f.cash(r.money, { signed: true }) : "sem histórico"} />;
}

export default function PerformancePage() {
  const q = useSnapshot();
  const f = useFmt();
  const [view, setView] = useState<"all" | "cycle">("all");
  const s = q.data;
  const pts = useMemo(() => (s ? inCcy(s.points, f.ccy, f.fx) : []), [s, f.ccy, f.fx]);
  const cycleFrom = s?.current ? s.current.trip.openT / 1000 : s?.trips[0]?.closeT ? s.trips[0].closeT / 1000 : null;
  const shown = useMemo(() => {
    if (view === "all" || !cycleFrom) return pts;
    const day = Math.floor(cycleFrom / 86400) * 86400;
    const i = Math.max(0, pts.findIndex((p) => p.ts >= day) - 1);
    return pts.slice(i);
  }, [pts, view, cycleFrom]);
  const dd = useMemo(() => drawdownPoints(pts), [pts]);
  if (q.loading) return <div className="space-y-3 pt-4"><Skeleton className="h-28" /><Skeleton className="h-60" /></div>;
  if (q.error instanceof NeedsSetup) return <StrategySetup />;
  if (q.error || !s) return <div className="pt-4"><Notice tone="loss">{q.error?.message}</Notice></div>;

  const lastP = pts[pts.length - 1];
  const invested = lastP?.contrib ?? 0;
  const value = lastP?.equity ?? s.equity.toNumber() * f.fx;
  const gain = value - invested;
  const hodlRet = s.hodlRet;
  const st = s.stats;
  const maxDD = dd.reduce((m, x) => Math.max(m, x.dd), 0);

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4" style={{ background: C.gold }} />Estratégia</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-muted" />Capital</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4" style={{ background: C.btc }} />Só BTC</span>
    </div>
  );

  return (
    <div>
      <Hero />
      <KpiGrid className="mb-4 grid-cols-2 sm:grid-cols-4">
        <PeriodKpi label="7 dias" r={periodReturn(pts, 7)} />
        <PeriodKpi label="30 dias" r={periodReturn(pts, 30)} />
        <Kpi label="Queda máxima" tone={maxDD > 0 ? "loss" : null} value={f.pct(-maxDD)} sub="desde o pico" />
        <Kpi label="vs. só BTC" tone={toneOf(s.vsHodlPct)} value={s.vsHodlPct != null ? f.pct(s.vsHodlPct) : "—"} sub={hodlRet != null ? `BTC ${f.pct(hodlRet)} no período` : undefined} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <Panel className="overflow-hidden">
            <PanelHead title="Patrimônio" right={<Segmented size="sm" label="Período do gráfico" value={view} onChange={setView} options={[{ value: "all", label: "Ciclo inteiro" }, { value: "cycle", label: s.current ? "Posição atual" : "Desde a saída" }]} />} />
            <div className="px-1 pt-4 pb-3">
              {shown.length >= 2 ? <EquityChart ccy={f.ccy} points={shown.map((p) => ({ ts: p.ts, equity: p.equity, contrib: p.contrib, hodl: p.hodl, inBtc: p.inBtc }))} height={280} />
                : <p className="px-4 py-14 text-center text-[14px] text-muted">O gráfico aparece a partir do segundo ponto de histórico.</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">{legend}<span className="text-[11px] text-muted">faixa laranja: em BTC</span></div>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel className="overflow-hidden">
              <PanelHead title="Patrimônio em BTC" right={pts.length ? <span className="num">{f.btc(pts.at(-1)!.btc, 6)} BTC</span> : undefined} />
              <p className="px-4 pt-3 text-[12px] leading-relaxed text-muted">A estratégia funciona quando esta linha sobe: sair antes das quedas e voltar mais barato rende mais BTC.</p>
              <div className="px-1 pt-2 pb-3">{pts.length >= 2 ? <BtcChart points={pts.map((p) => ({ ts: p.ts, btc: p.btc }))} height={170} /> : null}</div>
            </Panel>
            <Panel className="overflow-hidden">
              <PanelHead title="Queda desde o pico" right={<span className="num text-loss">máx. {f.pct(-maxDD)}</span>} />
              <p className="px-4 pt-3 text-[12px] leading-relaxed text-muted">Distância do melhor momento da carteira, sem o efeito de aportes e retiradas.</p>
              <div className="px-1 pt-2 pb-3">{dd.length >= 2 ? <DrawdownChart points={dd} height={170} /> : null}</div>
            </Panel>
          </div>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-4">
          <Panel className="overflow-hidden">
            <PanelHead title={s.scope.kind === "account" ? "Resultado da conta" : "Resultado do ciclo"} />
            <div className="divide-y divide-line px-4">
              <Row label={s.scope.kind === "account" ? "Saldo no início" : "Patrimônio inicial"}>{f.money(s.equity0)}</Row>
              <Row label="+ Aportes">{f.money(s.flowsIn)}</Row>
              <Row label="− Retiradas">{f.money(s.flowsOut)}</Row>
              <Row label="= Capital">{f.cash(invested)}</Row>
              <Row label={s.closed ? "Valor no encerramento" : "Valor atual"}>{f.cash(value)}</Row>
            </div>
            <div className="border-t border-line bg-surface-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3"><span className="lbl">Resultado</span><span className={cn("num text-[20px] font-semibold", toneCls(toneOf(gain)))}>{f.cash(gain, { signed: true })}</span></div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px]"><span className="text-muted">Retorno sobre o capital</span><span className={cn("num", toneCls(toneOf(gain)))}>{s.roc != null ? f.pct(s.roc) : "—"}</span></div>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-[13px]"><span className="text-muted">TWR (ponderado no tempo)</span><span className={cn("num", toneCls(toneOf(s.twr)))}>{s.twr != null ? f.pct(s.twr) : "—"}</span></div>
            </div>
            <div className="divide-y divide-line border-t border-line px-4">
              <Row label="Taxas pagas" tone={s.fees ? "loss" : null}>{f.money(-s.fees, { signed: true })}</Row>
              <Row label="Funding" tone={toneOf(s.funding)}>{f.money(s.funding, { signed: true })}</Row>
              <Row label="Buy & Hold no período" tone={toneOf(hodlRet)}>{hodlRet != null ? f.pct(hodlRet) : "—"}</Row>
              <Row label="Estratégia vs. só BTC" tone={toneOf(s.vsHodlPct)}>{s.vsHodlPct != null ? f.pct(s.vsHodlPct) : "—"}</Row>
              {s.reconciliation != null && <Row label="Reconciliação Hyperliquid">{Math.abs(s.reconciliation) < 0.01 ? "ok" : f.money(s.reconciliation, { signed: true })}</Row>}
            </div>
            <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted">Aportes e retiradas mudam o capital, nunca o resultado. <b className="font-semibold text-ink-2">Retorno sobre o capital</b> = resultado ÷ capital. <b className="font-semibold text-ink-2">TWR</b> mede a estratégia sem o peso do tamanho de cada aporte: a carteira é avaliada no instante de cada aporte e os períodos são encadeados.</p>
          </Panel>

          {st.count > 0 && (
            <Panel className="overflow-hidden">
              <PanelHead title="Operações encerradas" right={<span className="num">{st.wins} de {st.count} com lucro</span>} />
              <div className="grid grid-cols-3 border-b border-line">
                <Kpi className="border-r border-line" label="Somado" tone={toneOf(st.net)} value={f.money(st.net, { signed: true, compact: true })} />
                <Kpi className="border-r border-line" label="Ganho médio" tone="gain" value={st.avgWinPct ? f.pct(st.avgWinPct) : "—"} />
                <Kpi label="Perda média" tone="loss" value={st.avgLossPct ? f.pct(st.avgLossPct) : "—"} />
              </div>
              <ul className="divide-y divide-line">
                {s.trips.slice(0, 12).map((t) => (
                  <li key={t.openT} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1"><span className="block text-ink-2">{new Date(t.openT).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} → {t.closeT ? new Date(t.closeT).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"}{t.inherited ? " · herdada" : ""}</span>
                      <span className="num block text-[12px] text-muted">{f.px(t.entry)} → {t.exit ? f.px(t.exit) : "—"}</span></span>
                    <span className={cn("num text-right font-semibold", toneCls(toneOf(t.pnl)))}>{f.money(t.pnl, { signed: true })}<span className="block text-[11px] font-normal">{t.pnlPct != null ? f.pct(t.pnlPct) : ""}</span></span>
                  </li>
                ))}
              </ul>
              {st.profitFactor != null && <p className="border-t border-line px-4 py-2.5 text-[12px] text-muted">Fator de lucro <span className="num text-ink-2">{st.profitFactor.toFixed(2).replace(".", ",")}</span>: ganhos ÷ perdas.</p>}
            </Panel>
          )}
        </div>
      </div>
      <p className="mt-5 px-0.5 text-[11px] leading-relaxed text-muted">Pontos: início do ciclo, cada aporte ou retirada, fechamento diário (Binance, UTC) e agora{s.acc.kind === "hl" ? " (Hyperliquid)" : ""}. Só eventos a partir do início entram no cálculo. Em reais, cada ponto usa o dólar daquela data. “Só BTC” compra BTC com o patrimônio inicial do ciclo e com cada aporte posterior, e nunca vende.</p>
    </div>
  );
}
