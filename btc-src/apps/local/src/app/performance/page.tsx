"use client";
import { useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { NeedsSetup, useSnapshot } from "@/lib/api";
import { StrategySetup } from "@/components/strategy";
import { useFmt } from "@/lib/state";
import { inCcy, periodReturn } from "@/lib/local/engine";
import { drawdownSeries, d } from "@bst/domain";
import { Notice, Panel, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { Hero } from "@/components/shell";
import { BtcChart, C, DrawdownChart, EquityChart } from "@/components/charts";

function PeriodCard({ label, r, icon }: { label: string; r: { pct: number; money: number } | null; icon?: boolean }) {
  const f = useFmt();
  const t = r ? toneOf(r.money) : null;
  return (
    <Panel className="min-h-[132px] p-5">
      <div className="flex items-center justify-between text-[17px] text-ink-2">{label}
        {icon && r && (r.money >= 0 ? <TrendingUp className="size-5 text-gain" /> : <TrendingDown className="size-5 text-loss" />)}</div>
      {r ? (
        <>
          <p className={cn("num mt-3 text-[26px] font-bold", toneCls(t))}>{f.pct(r.pct)}</p>
          <p className="num mt-1 text-[16px] text-ink-2">{f.cash(r.money, { signed: true })}</p>
        </>
      ) : <p className="mt-3 text-[19px] text-muted">Sem dados</p>}
    </Panel>
  );
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
  const dd = useMemo(() => drawdownSeries(pts.map((p) => ({ ts: p.ts, equityUsd: d(p.equity), netFlowUsd: d(p.netFlow) }))), [pts]);
  if (q.loading) return <div className="space-y-3 pt-4"><Skeleton className="h-28" /><Skeleton className="h-60" /></div>;
  if (q.error instanceof NeedsSetup) return <StrategySetup />;
  if (q.error || !s) return <div className="pt-4"><Notice tone="loss">{q.error?.message}</Notice></div>;

  const lastP = pts[pts.length - 1];
  const invested = lastP?.contrib ?? 0;
  const value = lastP?.equity ?? s.equity.toNumber() * f.fx;
  const gain = value - invested;
  const total = periodReturn(pts, null);
  const hodlRet = s.hodlRet;
  const st = s.stats;
  const maxDD = dd.reduce((m, x) => Math.max(m, x.drawdown.toNumber()), 0);

  return (
    <div>
      <Hero />
      <Panel className="p-6">
        <h2 className="text-[22px] font-semibold tracking-tight">Performance da carteira</h2>
        <dl className="mt-6 space-y-6 text-[17px]">
          <div className="flex items-baseline justify-between gap-4"><dt className="text-ink-2">{s.closed ? "Valor no encerramento" : "Valor atual"}</dt><dd className="num text-[21px] font-bold">{f.cash(value)}</dd></div>
          <div className="flex items-baseline justify-between gap-4"><dt className="text-ink-2">Capital da estratégia</dt><dd className="num text-[21px] font-bold">{f.cash(invested)}</dd></div>
          <div className="flex items-start justify-between gap-4"><dt className="pt-1 text-ink-2">Resultado</dt>
            <dd className={cn("num text-right", toneCls(toneOf(gain)))}><span className="block text-[21px] font-bold">{f.cash(gain, { signed: true })}</span><span className="text-[16px]">{s.twr != null ? f.pct(s.twr) : "—"}</span></dd></div>
        </dl>
        <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-[14px]">
          <div className="flex justify-between gap-3 text-muted"><span>{s.scope.kind === "account" ? "Saldo no início da conta" : "Patrimônio inicial do ciclo"}</span><span className="num">{f.money(s.equity0)}</span></div>
          <div className="flex justify-between gap-3 text-muted"><span>+ Aportes depois do início</span><span className="num">{f.money(s.flowsIn)}</span></div>
          <div className="flex justify-between gap-3 text-muted"><span>− Retiradas</span><span className="num">{f.money(s.flowsOut)}</span></div>
          <div className="flex justify-between gap-3 text-muted"><span>Taxas pagas · funding</span><span className="num">{f.money(-s.fees, { signed: true })} · {f.money(s.funding, { signed: true })}</span></div>
          {s.reconciliation != null && <div className="flex justify-between gap-3 text-muted"><span>Reconciliação com a Hyperliquid</span><span className="num">{Math.abs(s.reconciliation) < 0.01 ? "ok" : f.money(s.reconciliation, { signed: true })}</span></div>}
        </div>
        <p className="mt-4 border-t border-line pt-4 text-[15px] text-ink-2">Buy & Hold no mesmo período: <span className="text-accent">{hodlRet != null ? f.pct(hodlRet) : "—"}</span>
          {s.vsHodlPct != null ? <span className="text-muted"> · estratégia {f.pct(s.vsHodlPct)} vs. BTC</span> : null}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">Aportes e retiradas mudam o capital, nunca o resultado. Resultado = patrimônio {s.closed ? "no encerramento" : "atual"} − capital da estratégia. Percentual ponderado no tempo.</p>
      </Panel>

      <h2 className="mt-9 mb-4 text-[24px] font-semibold tracking-tight">Variações por período</h2>
      <div className="grid grid-cols-2 gap-3">
        <PeriodCard label="Total" r={total} icon />
        <PeriodCard label="30 dias" r={periodReturn(pts, 30)} />
        <PeriodCard label="7 dias" r={periodReturn(pts, 7)} />
        <PeriodCard label="24h" r={periodReturn(pts, 1)} />
      </div>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted">Percentuais ponderados no tempo: aportes e retiradas não contam como ganho.</p>

      <div className="mt-9 mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[24px] font-semibold leading-tight tracking-tight">Gráfico de<br />performance</h2>
        <Segmented label="Período do gráfico" value={view} onChange={setView} options={[{ value: "all", label: "Histórico" }, { value: "cycle", label: s.current ? "Posição atual" : "Desde a saída" }]} />
      </div>
      <Panel className="px-2 pt-5 pb-4">
        {shown.length >= 2 ? <EquityChart ccy={f.ccy} points={shown.map((p) => ({ ts: p.ts, equity: p.equity, contrib: p.contrib, hodl: p.hodl, inBtc: p.inBtc }))} height={280} />
          : <p className="px-4 py-14 text-center text-[15px] text-muted">O gráfico aparece a partir do segundo dia de histórico.</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[15px] text-ink-2">
          <span className="inline-flex items-center gap-2"><span className="h-[3px] w-6 rounded" style={{ background: C.accent }} />Carteira</span>
          <span className="inline-flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-muted" />Investido</span>
          <span className="inline-flex items-center gap-2"><span className="h-[3px] w-6 rounded" style={{ background: C.btc }} />Só BTC</span>
        </div>
        <p className="mt-2 text-center text-[12px] text-muted">Faixas alaranjadas: períodos em BTC</p>
      </Panel>

      <Panel className="mt-6 px-2 pt-5 pb-4">
        <div className="px-4">
          <h3 className="text-[19px] font-semibold">Patrimônio em BTC</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">Quanto a carteira valeria em bitcoin em cada data. A estratégia funciona quando esta linha sobe: sair antes das quedas e voltar mais barato rende mais BTC.</p>
        </div>
        <div className="mt-4">{pts.length >= 2 ? <BtcChart points={pts.map((p) => ({ ts: p.ts, btc: p.btc }))} /> : null}</div>
      </Panel>

      <Panel className="mt-6 px-2 pt-5 pb-4">
        <div className="flex items-baseline justify-between px-4">
          <h3 className="text-[19px] font-semibold">Quedas</h3>
          <span className="num text-[15px] text-loss">máx. {f.pct(-maxDD)}</span>
        </div>
        <p className="mt-1 px-4 text-[15px] text-muted">Distância do pico anterior da carteira</p>
        <div className="mt-3">{dd.length >= 2 ? <DrawdownChart points={dd.map((x) => ({ ts: x.ts, dd: x.drawdown.toNumber() }))} height={150} /> : null}</div>
      </Panel>

      {st.count > 0 && (
        <Panel className="mt-6 p-6">
          <h3 className="text-[19px] font-semibold">Operações encerradas</h3>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
            <div><p className="text-[14px] text-muted">Acertos</p><p className="num mt-1 text-[20px] font-bold">{st.wins} de {st.count}</p></div>
            <div><p className="text-[14px] text-muted">Resultado somado</p><p className={cn("num mt-1 text-[20px] font-bold", toneCls(toneOf(st.net)))}>{f.money(st.net, { signed: true })}</p></div>
            <div><p className="text-[14px] text-muted">Ganho médio</p><p className="num mt-1 text-[20px] font-bold text-gain">{st.avgWinPct ? f.pct(st.avgWinPct) : "—"}</p></div>
            <div><p className="text-[14px] text-muted">Perda média</p><p className="num mt-1 text-[20px] font-bold text-loss">{st.avgLossPct ? f.pct(st.avgLossPct) : "—"}</p></div>
          </div>
          {st.profitFactor != null && <p className="mt-5 text-[14px] text-muted">Fator de lucro {st.profitFactor.toFixed(2).replace(".", ",")}: ganhos somados ÷ perdas somadas.</p>}
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {s.trips.slice(0, 12).map((t) => (
              <li key={t.openT} className="flex items-center gap-3 py-3 text-[14px]">
                <span className="min-w-0 flex-1"><span className="block font-medium">{new Date(t.openT).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} → {t.closeT ? new Date(t.closeT).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }) : "—"}{t.inherited ? " · herdada" : ""}</span>
                  <span className="num block text-muted">{f.px(t.entry)} → {t.exit ? f.px(t.exit) : "—"}</span></span>
                <span className={cn("num text-right font-semibold", toneCls(toneOf(t.pnl)))}>{f.money(t.pnl, { signed: true })}<span className="block text-[12px] font-normal">{t.pnlPct != null ? f.pct(t.pnlPct) : ""}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <p className="mt-6 px-1 text-[12px] leading-relaxed text-muted">Fechamento diário da Binance; o ponto de hoje usa o valor atual{s.acc.kind === "hl" ? " da Hyperliquid" : ""}. Só eventos depois do início entram no cálculo. Em reais, cada dia usa o dólar daquele dia. “Só BTC” compra BTC com o patrimônio inicial do ciclo e com cada aporte posterior, na data, e nunca vende.</p>
    </div>
  );
}
