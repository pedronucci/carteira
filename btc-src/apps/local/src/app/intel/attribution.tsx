"use client";
/**
 * Portfolio Attribution Engine: quanto cada ativo contribuiu para o resultado do portfólio, separando spot e perpétuos,
 * realizado e não realizado, funding recebido/pago, taxas e recompensas. Aportes, retiradas e transferências internas
 * ficam fora do resultado. Mesmo registro financeiro e mesmos ids do Trading Journal.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFmt } from "@/lib/state";
import { navigate } from "@/lib/router";
import { portfolio } from "@/lib/portfolio/db";
import { useDataVersion } from "@/lib/api";
import { useAttrData } from "@/lib/journal/use";
import { rangeOf, useUrlFilters } from "@/lib/journal/filters";
import { attribute, bridge, byPeriod, journalHref, matchRec, waterfallBars, waterfallSteps, type AssetAttr } from "@/lib/attribution/engine";
import { dayKey } from "@/lib/journal/analytics";
import { FilterSelect, PeriodPicker } from "@/components/filter-bar";
import { CoinLogo } from "@/components/coin-logo";
import { C } from "@/components/charts";
import { Button, Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, Row, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

type Fmt = ReturnType<typeof useFmt>;
const TIP = { background: "var(--color-surface-3)", border: "1px solid var(--color-line-strong)", borderRadius: 8, fontSize: 12 } as const;
const pctS = (x: number | null) => (x == null ? "—" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);
const MKT = { perp: "Perpétuos", spot: "Spot", other: "Outros" } as const;

export function AttributionSection() {
  useDataVersion();
  const f = useFmt();
  const { f: flt, set, clear } = useUrlFilters();
  const { data, loading, error } = useAttrData();
  const [open, setOpen] = useState<string | null>(null);
  const range = rangeOf(flt);

  const filter = useMemo(() => ({ range, coin: flt.coin, exchange: flt.ex, accountId: flt.acc, strategy: flt.strat, market: flt.market }), [range.from, range.to, flt.coin, flt.ex, flt.acc, flt.strat, flt.market]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useMemo(() => (data ? attribute(data.ledger, filter) : null), [data, filter]);

  // ponte com o patrimônio: retratos do portfólio dentro do período
  const br = useMemo(() => {
    if (!a) return null;
    const snaps = portfolio().snapshots.filter((s) => s.total != null && (range.from == null || s.t >= range.from) && s.t <= range.to).sort((x, y) => x.t - y.t);
    const whole = !flt.coin && !flt.strat && !flt.market && !flt.acc && !flt.ex;
    if (!whole) return null;
    return bridge(snaps.length >= 2 ? snaps[0]!.total! : null, snaps.length >= 2 ? snaps.at(-1)!.total! : null, a.flows?.net ?? 0, a.total.net);
  }, [a, range.from, range.to, flt.coin, flt.strat, flt.market, flt.acc, flt.ex]);
  const bars = useMemo(() => (a ? waterfallBars(waterfallSteps(a, br)) : []), [a, br]);
  const periods = useMemo(() => (data ? byPeriod(data.ledger, { coin: flt.coin, exchange: flt.ex, accountId: flt.acc, strategy: flt.strat, market: flt.market }, Date.now()) : []), [data, flt.coin, flt.ex, flt.acc, flt.strat, flt.market]);
  const daily = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { t: number; net: number }>();
    for (const r of data.ledger.recs) if (matchRec(r, filter)) { const k = dayKey(r.t); const c = m.get(k) ?? { t: new Date(new Date(r.t).getFullYear(), new Date(r.t).getMonth(), new Date(r.t).getDate()).getTime(), net: 0 }; c.net += r.usd; m.set(k, c); }
    let cum = 0;
    return [...m.values()].sort((x, y) => x.t - y.t).map((d) => { cum += d.net; return { ...d, cum }; });
  }, [data, filter]);

  if (!data && loading) return <Skeleton className="mb-4 h-48" />;
  if (!data || !a) return <div className="mb-4"><Notice tone="loss">{error ?? "Atribuição indisponível."}</Notice></div>;

  const L = data.ledger;
  const assets = [...new Set([...L.recs.map((r) => r.asset), ...L.unreal.map((u) => u.asset)])].sort();
  const exchanges = [...new Set([...L.recs.map((r) => r.exchange), ...L.accounts.map((x) => x.exchange)])];
  const accs = L.accounts.map((x) => ({ value: x.id, label: x.name }));
  const strats = [...new Set(L.recs.map((r) => r.strategy))];
  const hasFilter = Boolean(flt.coin || flt.acc || flt.strat || flt.market || flt.ex || flt.p !== "all");
  const rows = [...a.rows].sort((x, y) => Math.abs(y.total.net) - Math.abs(x.total.net));
  const chartRows = rows.slice(0, 12).map((r) => ({ asset: r.asset, net: r.total.net }));
  const noHist = L.accounts.filter((x) => !x.hasHistory);
  const toJournal = (coin?: string, trade?: string) => navigate(journalHref({ coin, trade, from: range.from, to: flt.p === "all" ? null : range.to, acc: flt.acc, strategy: flt.strat, market: flt.market, exchange: flt.ex }));
  const tradeMeta = new Map(data.trades.map((t) => [t.uid, t]));

  return (
    <section className="mb-4 space-y-4" aria-label="Portfolio Attribution">
      <div>
        <h2 className="text-[16px] font-semibold">Contribuição por ativo</h2>
        <p className="text-[12px] text-muted">Quanto cada ativo somou ao resultado. Aportes, retiradas e transferências internas não entram. Não realizado é mostrado à parte.</p>
      </div>
      <Panel className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <FilterSelect label="Ativo" value={flt.coin} onChange={(v) => set({ coin: v })} options={assets.map((x) => ({ value: x, label: x }))} />
          <FilterSelect label="Exchange" value={flt.ex} onChange={(v) => set({ ex: v })} options={exchanges.map((x) => ({ value: x, label: x }))} />
          <FilterSelect label="Carteira / conta" value={flt.acc} onChange={(v) => set({ acc: v })} options={accs} />
          <FilterSelect label="Estratégia" value={flt.strat} onChange={(v) => set({ strat: v })} options={strats.map((x) => ({ value: x, label: x }))} />
          <FilterSelect label="Mercado" value={flt.market} onChange={(v) => set({ market: v as never })} options={[{ value: "perp", label: "Perpétuos" }, { value: "spot", label: "Spot" }, { value: "other", label: "Outros" }]} />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <PeriodPicker p={flt.p} from={flt.p === "custom" ? flt.from : null} to={flt.p === "custom" ? flt.to : null} onPreset={(k) => set({ p: k })} onCustom={(x, y) => set({ p: "custom", from: x, to: y })} />
          {hasFilter && <Button size="sm" onClick={clear}>Limpar filtros</Button>}
        </div>
      </Panel>

      {L.notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      {a.notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      {noHist.map((x) => <Notice key={x.id} tone="info">{x.exchange} · {x.name}: sem histórico de operações disponível. O saldo conta no patrimônio, mas não há atribuição de resultado por ativo.</Notice>)}
      {!L.accounts.length && <Notice tone="info">Nenhuma conta com histórico de operações. Conecte a Hyperliquid em Ajustes para ver a atribuição.</Notice>}

      <KpiGrid>
        <Kpi label="Resultado líquido" value={f.money(a.total.net, { signed: true })} tone={toneOf(a.total.net)} sub={`${a.recCount} eventos financeiros`} />
        <Kpi label="Realizado" value={f.money(a.total.realized, { signed: true })} tone={toneOf(a.total.realized)} sub={`perp ${f.money(a.perp.realized, { signed: true, compact: true })} · spot ${f.money(a.spot.realized, { signed: true, compact: true })}`} />
        <Kpi label="Funding" value={f.money(a.total.funding, { signed: true })} tone={toneOf(a.total.funding)} sub={`recebido ${f.money(a.total.fundingIn, { compact: true })} · pago ${f.money(a.total.fundingOut, { compact: true })}`} />
        <Kpi label="Taxas" value={f.money(a.total.fees, { signed: true })} tone={a.total.fees < 0 ? "loss" : null} sub={a.total.rewards ? `recompensas ${f.money(a.total.rewards, { signed: true, compact: true })}` : undefined} />
        <Kpi label="Não realizado agora" value={f.money(a.unrealized.total, { signed: true })} tone={toneOf(a.unrealized.total)} sub={a.unrealized.unknown.length ? `sem custo: ${a.unrealized.unknown.join(", ")}` : "posições abertas e spot"} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Contribuição por ativo" sub="Resultado líquido no período (toque numa barra para ver as operações)" />
          <div className="px-2 pb-3" style={{ height: Math.max(180, chartRows.length * 34 + 30) }}>
            {chartRows.length ? (
              <ResponsiveContainer>
                <BarChart data={chartRows} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="asset" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={56} />
                  <ReferenceLine x={0} stroke="var(--chart-line)" />
                  <Tooltip contentStyle={TIP} formatter={(v) => [f.money(Number(v), { signed: true }), "Resultado"]} />
                  <Bar dataKey="net" radius={3} isAnimationActive={false} cursor="pointer" onClick={(d) => toJournal((d as unknown as { asset: string }).asset)}>
                    {chartRows.map((d) => <Cell key={d.asset} fill={d.net >= 0 ? C.gain : C.loss} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="px-3 py-10 text-center text-[13px] text-muted">Sem resultados neste recorte.</p>}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Decomposição do resultado" sub={br?.available ? "Do resultado atribuído à variação do patrimônio" : "Cascata do resultado atribuído"} />
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer>
              <ComposedChart data={bars} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" stroke={C.muted} fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={52} />
                <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={52} />
                <ReferenceLine y={0} stroke="var(--chart-line)" />
                <Tooltip contentStyle={TIP} formatter={(_v, _n, p) => { const b = p.payload as { value: number; note?: string }; return [f.money(b.value, { signed: true }), b.note ?? ""]; }} />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="up" stackId="w" isAnimationActive={false}>{bars.map((b) => <Cell key={b.key} fill={b.kind === "total" ? C.accent : C.gain} />)}</Bar>
                <Bar dataKey="down" stackId="w" isAnimationActive={false}>{bars.map((b) => <Cell key={b.key} fill={b.kind === "total" ? C.accent : C.loss} />)}</Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {br && !br.available && <p className="px-4 pb-3 text-[11.5px] text-muted">{br.reason}</p>}
          {br?.available && <p className="px-4 pb-3 text-[11.5px] text-muted">Patrimônio {f.money(br.startEquity!)} → {f.money(br.endEquity!)} ({f.money(br.delta!, { signed: true })}) = aportes líquidos {f.money(br.flowsNet, { signed: true })} + resultado atribuído {f.money(br.attributed, { signed: true })} + aberto/outros {f.money(br.residual!, { signed: true })}.</p>}
        </Panel>
      </div>

      <Panel>
        <PanelHead title="Ativos" sub="Spot × perpétuos, realizado × não realizado, funding e taxas" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead><tr className="text-left text-[11px] text-muted">{["Ativo", "Líquido", "Parcela", "Perp", "Spot", "Realizado", "Funding rec.", "Funding pago", "Taxas", "Não realizado"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => <AssetRow key={r.asset} r={r} f={f} open={open === r.asset} onToggle={() => setOpen(open === r.asset ? null : r.asset)} onJournal={toJournal} meta={tradeMeta} />)}
              {!rows.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted">Sem eventos financeiros neste recorte.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Evolução" sub="Resultado diário e acumulado (mesmo recorte)" />
          <div className="h-56 px-2 pb-3">
            {daily.length ? (
              <ResponsiveContainer>
                <ComposedChart data={daily} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={52} />
                  <ReferenceLine y={0} stroke="var(--chart-line)" />
                  <Tooltip contentStyle={TIP} labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("pt-BR")} formatter={(v, n) => [f.money(Number(v), { signed: true }), n === "net" ? "No dia" : "Acumulado"]} />
                  <Bar dataKey="net" isAnimationActive={false}>{daily.map((d) => <Cell key={d.t} fill={d.net >= 0 ? C.gain : C.loss} fillOpacity={0.7} />)}</Bar>
                  <Line dataKey="cum" type="monotone" stroke={C.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="px-3 py-10 text-center text-[13px] text-muted">Sem eventos neste recorte.</p>}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Por período" sub="Mesmos filtros de ativo, conta e estratégia" />
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11px] text-muted"><th className="px-4 py-2 font-medium">Período</th>{["Líquido", "Realizado", "Funding", "Taxas"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {periods.map((p) => (
                <tr key={p.kind} className="num">
                  <td className="px-4 py-2 font-sans text-ink-2">{p.label}</td>
                  <td className={cn("px-3 py-2 text-right font-semibold", toneCls(toneOf(p.net)))}>{p.count ? f.money(p.net, { signed: true, compact: true }) : "—"}</td>
                  <td className="px-3 py-2 text-right">{p.count ? f.money(p.realized, { signed: true, compact: true }) : "—"}</td>
                  <td className="px-3 py-2 text-right">{p.count ? f.money(p.funding, { signed: true, compact: true }) : "—"}</td>
                  <td className="px-3 py-2 text-right">{p.count ? f.money(p.fees, { signed: true, compact: true }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel>
        <PanelHead title="Aportes, retiradas e transferências" sub="Ficam fora do resultado. Só aparecem sem filtro de ativo, estratégia ou mercado." />
        <div className="px-4 pb-4">
          {a.flows ? (
            <>
              <Row label="Aportes">{f.money(a.flows.deposits, { signed: true })}</Row>
              <Row label="Retiradas">{f.money(a.flows.withdrawals, { signed: true })}</Row>
              <Row label="Transferências internas (entre suas contas)">{f.money(a.flows.internal, { signed: true })}</Row>
              <Row label="Líquido externo">{f.money(a.flows.net, { signed: true })}</Row>
              <p className="mt-2 text-[11.5px] text-muted">{a.flows.count} movimentações no período. Transferência entre contas próprias não é aporte nem retirada.</p>
            </>
          ) : <p className="pt-2 text-[13px] text-muted">Remova os filtros de ativo, estratégia e mercado para ver as movimentações do período.</p>}
        </div>
      </Panel>
      <p className="text-[11.5px] text-muted">Hyperliquid: resultado realizado, taxas e funding vêm das execuções e pagamentos reais, contados uma única vez. O patrimônio já inclui o P&L aberto; por isso o não realizado nunca é somado ao saldo.</p>
    </section>
  );
}

function AssetRow({ r, f, open, onToggle, onJournal, meta }: { r: AssetAttr; f: Fmt; open: boolean; onToggle: () => void; onJournal: (coin?: string, trade?: string) => void; meta: Map<string, { dir: "LONG" | "SHORT"; openedAt: number; open: boolean }> }) {
  const unreal = (r.unrealizedPerp ?? 0) + (r.unrealizedSpot ?? 0);
  const hasU = r.unrealizedPerp != null || r.unrealizedSpot != null;
  const m = (v: number) => f.money(v, { signed: true, compact: true });
  return (
    <>
      <tr className="num cursor-pointer [@media(hover:hover)]:hover:bg-surface-2" onClick={onToggle}>
        <td className="px-3 py-2.5 font-sans"><span className="flex items-center gap-2"><CoinLogo symbol={r.asset} size={20} /><b>{r.asset}</b>{open ? <ChevronUp className="size-3.5 text-muted" /> : <ChevronDown className="size-3.5 text-muted" />}</span></td>
        <td className={cn("px-3 py-2.5 text-right font-semibold", toneCls(toneOf(r.total.net)))}>{m(r.total.net)}</td>
        <td className="px-3 py-2.5 text-right text-muted">{pctS(r.share)}</td>
        <td className="px-3 py-2.5 text-right">{r.perp.net ? m(r.perp.net) : "—"}</td>
        <td className="px-3 py-2.5 text-right">{r.spot.net ? m(r.spot.net) : "—"}</td>
        <td className="px-3 py-2.5 text-right">{m(r.total.realized)}</td>
        <td className="px-3 py-2.5 text-right">{r.total.fundingIn ? m(r.total.fundingIn) : "—"}</td>
        <td className="px-3 py-2.5 text-right">{r.total.fundingOut ? m(r.total.fundingOut) : "—"}</td>
        <td className="px-3 py-2.5 text-right">{r.total.fees ? m(r.total.fees) : "—"}</td>
        <td className={cn("px-3 py-2.5 text-right", hasU && toneCls(toneOf(unreal)))} title={r.unrealizedReason ?? undefined}>{hasU ? m(unreal) : r.unrealizedReason ? "s/ custo" : "—"}</td>
      </tr>
      {open && (
        <tr><td colSpan={10} className="bg-surface-2/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-muted">{r.trades.length} operações de perpétuos contribuíram · {r.fills} execuções</span>
            <Button size="sm" onClick={() => onJournal(r.asset)}><ListChecks className="mr-1 size-4" />Ver no Trading Journal</Button>
          </div>
          <ul className="mt-2 divide-y divide-line text-[12.5px]">
            {[...r.trades].sort((x, y) => Math.abs(y.net) - Math.abs(x.net)).slice(0, 8).map((t) => {
              const mt = meta.get(t.uid);
              return (
                <li key={t.uid}><button onClick={() => onJournal(r.asset, t.uid)} className="flex w-full items-center justify-between py-2 text-left">
                  <span className="flex items-center gap-2">{mt && <Pill tone={mt.dir === "LONG" ? "gain" : "loss"}>{mt.dir}</Pill>}<span className="text-muted">{mt ? new Date(mt.openedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "operação"}{mt?.open ? " · aberta" : ""}</span></span>
                  <span className={cn("num font-semibold", toneCls(toneOf(t.net)))}>{f.money(t.net, { signed: true })}</span>
                </button></li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted">Perp {MKT.perp.toLowerCase()}: {f.money(r.perp.net, { signed: true })} · {MKT.spot.toLowerCase()}: {f.money(r.spot.net, { signed: true })}{r.other.net ? ` · ${MKT.other.toLowerCase()}: ${f.money(r.other.net, { signed: true })}` : ""}. Funding sem operação associada fica no total do ativo.</p>
        </td></tr>
      )}
    </>
  );
}
