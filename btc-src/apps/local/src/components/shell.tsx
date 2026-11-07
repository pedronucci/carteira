"use client";
import { useMemo } from "react";
import { Bitcoin } from "lucide-react";
import { useSnapshot } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { inCcy, periodReturn } from "@/lib/local/engine";
import { fmtDuration } from "@/lib/local/strategy";
import { ScopeButton } from "./strategy";
import { STRATEGY_TABS, SubNav } from "./nav";
import { Kpi, KpiGrid, toneOf } from "./ui";

/** Topo das telas: seletor do ciclo, patrimônio e a faixa de indicadores do ciclo. */
export function Hero() {
  const q = useSnapshot();
  const f = useFmt();
  const s = q.data;
  const day = useMemo(() => (s ? periodReturn(inCcy(s.points.slice(-4), f.ccy, f.fx), 1, true) : null), [s, f.ccy, f.fx]);
  if (!s) return <div className="pt-3 pb-4"><SubNav items={STRATEGY_TABS} /><div className="mt-3"><ScopeButton /></div></div>;
  const c = s.current;
  const lev = c?.effLeverage ?? null;
  const liqTone = c?.liqDist && c.liqDist.lt(s.s.settings.minLiqDistance) ? ("loss" as const) : null;
  return (
    <section aria-label="Estratégia BTC/USDC" className="pt-3 pb-5">
      <SubNav items={STRATEGY_TABS} />
      <div className="mt-4" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-gold"><Bitcoin className="size-4" strokeWidth={2} />ESTRATÉGIA BTC/USDC</h1>
        <ScopeButton />
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <p className="lbl">{s.closed ? "Patrimônio no encerramento" : "Patrimônio da estratégia"}</p>
          <p className="num mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] lg:text-[38px]">{f.money(s.equity)}</p>
        </div>
        <p className="num pb-0.5 text-[13px] text-muted">≈ {f.btc(s.equity.toNumber() / (s.points.at(-1)?.price || s.now.btcUsd.toNumber()), 8)} BTC</p>
      </div>
      <KpiGrid className="mt-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label={s.closed ? "Resultado do ciclo" : s.scope.kind === "account" ? "Resultado" : "Resultado do ciclo"} tone={toneOf(s.result)}
          value={f.money(s.result, { signed: true })} sub={s.roc != null ? `${f.pct(s.roc)} s/ capital` : undefined} />
        <Kpi label="TWR" tone={toneOf(s.twr)} value={s.twr != null ? f.pct(s.twr) : "—"} sub="ponderado no tempo" />
        {s.closed ? <Kpi label="Duração" value={fmtDuration(s.endT - s.startT)} sub={`até ${new Date(s.endT).toLocaleDateString("pt-BR")}`} />
          : <Kpi label={day?.partial ? "Desde o início" : "24 h"} tone={toneOf(day?.money)} value={day ? f.cash(day.money, { signed: true }) : "—"} sub={day ? f.pct(day.pct) : undefined} />}
        {c ? <Kpi label="Exposição" tone={liqTone} value={lev != null ? `${lev.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}
          sub={c.liqDist ? `liquidação a ${f.pct(c.liqDist, false)}` : f.money(c.notional, { compact: true })} />
          : <Kpi label="Estado" value="100% USDC" sub={s.inUsdcSince ? `desde ${new Date(s.inUsdcSince).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : undefined} />}
      </KpiGrid>
    </section>
  );
}

export { AppShell, Mark } from "./nav";
