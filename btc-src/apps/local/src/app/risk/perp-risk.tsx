"use client";
/** Risk Center multiativo: exposição por ativo, LONG × SHORT e simulador de cenários em margem cruzada. */
import { useMemo, useState } from "react";
import { usePerps } from "@/lib/api";
import type { PerpAccountView } from "@/lib/perps/view";
import { useFmt } from "@/lib/state";
import { breakEvenShock, simulate } from "@/lib/perps/scenario";
import { CoinLogo } from "@/components/coin-logo";
import { Kpi, KpiGrid, Notice, Panel, PanelHead, cn, toneCls, toneOf } from "@/components/ui";

export function PerpRisk() {
  const q = usePerps();
  const v = q.data;
  if (!v || !v.connected) return null;
  return <>{v.accounts.filter((a) => a.sim && a.positions.length > 0).map((a) => <AccountRisk key={a.id} a={a} multi={v.accounts.length > 1} />)}</>;
}

function AccountRisk({ a, multi }: { a: PerpAccountView; multi: boolean }) {
  const f = useFmt();
  const v = a;
  const [sh, setSh] = useState<Record<string, string>>({});
  const shocks = useMemo(() => Object.fromEntries(Object.entries(sh).filter(([, x]) => x.trim() !== "" && Number.isFinite(Number(x.replace(",", ".")))).map(([k, x]) => [k, Number(x.replace(",", ".")) / 100])), [sh]);
  const sim = v.sim!;
  const r = simulate(sim, shocks);
  const gross = v.summary.gross || 1;
  const long = v.positions.filter((p) => p.dir === "LONG").reduce((a, p) => a + p.notional, 0);
  const short = v.summary.gross - long;
  const be = breakEvenShock(sim, "all");
  const preset = (m: Record<string, number>) => setSh(Object.fromEntries(Object.entries(m).map(([k, x]) => [k, String(x)])));
  const all = (x: number) => preset(Object.fromEntries(v.positions.map((p) => [p.coin, x])));
  return (
    <Panel tech className="mt-4 overflow-hidden">
      <PanelHead title={`Perpétuos · risco multiativo${multi ? ` · ${a.name}` : ""}`} right={<span className="text-[11px]">margem cruzada · estimativa</span>} />
      <KpiGrid className="m-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Exposição bruta" value={f.money(v.summary.gross, { compact: true })} sub={`long ${f.money(long, { compact: true })} · short ${f.money(short, { compact: true })}`} />
        <Kpi label="Alavancagem efetiva" value={v.summary.effLeverage != null ? `${v.summary.effLeverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"} sub="bruta ÷ equity da conta" />
        <Kpi label="Margem usada" value={f.money(v.summary.margin, { compact: true })} sub={`equity ${f.money(sim.accountValue, { compact: true })}`} />
        <Kpi label="Queda uniforme até liquidar" value={be != null ? f.pct(be, false) : "fora do alcance"} sub="todas as posições juntas, estimado" />
      </KpiGrid>
      <ul className="border-t border-line">
        {v.positions.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[13px]"><CoinLogo symbol={p.coin} size={18} /><span className="w-12 font-medium">{p.coin}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className={cn("h-full", p.dir === "LONG" ? "bg-gain" : "bg-loss")} style={{ width: `${Math.min(100, (p.notional / gross) * 100)}%` }} /></div>
            <span className="num w-14 text-right text-muted">{f.pct(p.notional / gross, false)}</span></li>
        ))}
      </ul>
      <div className="border-t border-line px-4 py-4">
        <p className="lbl">Simulador de cenários (variação % por ativo)</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          <button className="rounded-md border border-line px-2.5 py-1.5" onClick={() => all(-10)}>Tudo −10%</button>
          <button className="rounded-md border border-line px-2.5 py-1.5" onClick={() => preset({ BTC: -10, HYPE: -15, SOL: -12 })}>BTC −10 · HYPE −15 · SOL −12</button>
          <button className="rounded-md border border-line px-2.5 py-1.5" onClick={() => setSh({})}>Limpar</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {v.positions.map((p) => (
            <label key={p.id} className="block text-[12px] text-muted">{p.coin} ({p.dir === "LONG" ? "long" : "short"})
              <input inputMode="decimal" placeholder="0" value={sh[p.coin] ?? ""} onChange={(e) => setSh({ ...sh, [p.coin]: e.target.value })} className="num mt-1 h-10 w-full rounded-md border border-line bg-surface-2 px-2 text-[14px] text-ink" aria-label={`Variação de ${p.coin} em porcento`} />
            </label>
          ))}
        </div>
        {Object.keys(shocks).length > 0 && (
          <div className="mt-4 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span className="text-muted">Impacto nas posições</span><span className={cn("num", toneCls(toneOf(r.pnlDelta)))}>{f.money(r.pnlDelta, { signed: true })}</span></div>
            <div className="flex justify-between"><span className="text-muted">Equity da conta</span><span className="num">{f.money(r.newAccountValue)} {r.accountChangePct != null && <span className="text-muted">({f.pct(r.accountChangePct)})</span>}</span></div>
            {r.newConsolidated != null && <div className="flex justify-between"><span className="text-muted">Patrimônio consolidado</span><span className="num">{f.money(r.newConsolidated)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Margem de manutenção (conta toda)</span><span className="num">{f.money(r.maintMarginTotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Folga até liquidação</span><span className={cn("num", r.bufferUsd <= 0 ? "text-loss" : "")}>{f.money(r.bufferUsd, { signed: true })}</span></div>
            {r.liquidated ? <Notice tone="loss">Neste cenário a conta atingiria a zona de liquidação (margem cruzada).</Notice> : null}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted">{r.note} Conta em margem cruzada: a liquidação depende do conjunto de posições, não de cada uma isolada.</p>
      </div>
    </Panel>
  );
}
