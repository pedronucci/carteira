"use client";
/** Performance Analytics: análise de resultado por período, ativo, origem, perpétuos e benchmarks. Somente leitura. */
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFmt } from "@/lib/state";
import { sortPerf, type RangeKind, type SortKey } from "@/lib/analytics/analytics";
import { useAnalytics, type Analytics, type Custom } from "@/lib/analytics/use";
import { C } from "@/components/charts";
import { Kpi, Notice, Panel, PanelHead, Pill, Segmented, cn, toneCls, toneOf } from "@/components/ui";

export const RANGES: { value: RangeKind; label: string }[] = [{ value: "1", label: "24h" }, { value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "ytd", label: "Ano" }, { value: "all", label: "Tudo" }, { value: "custom", label: "Datas" }];
const NA = "Dados insuficientes";
const dmy = (t: number) => new Date(t).toLocaleDateString("pt-BR");
const iso = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

export function RangePicker({ kind, setKind, custom, setCustom }: { kind: RangeKind; setKind: (k: RangeKind) => void; custom: Custom; setCustom: (c: Custom) => void }) {
  const now = Date.now();
  const c = custom ?? { from: now - 30 * 86400e3, to: now };
  const inp = "num rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented size="sm" label="Período" value={kind} onChange={setKind} options={RANGES} />
      {kind === "custom" && (
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <input aria-label="De" type="date" className={inp} value={iso(c.from)} max={iso(c.to)} onChange={(e) => e.target.value && setCustom({ ...c, from: new Date(e.target.value + "T00:00:00").getTime() })} />
          até
          <input aria-label="Até" type="date" className={inp} value={iso(c.to)} min={iso(c.from)} onChange={(e) => e.target.value && setCustom({ ...c, to: new Date(e.target.value + "T23:59:59").getTime() })} />
        </span>
      )}
    </div>
  );
}

function Indicators({ a }: { a: Analytics }) {
  const f = useFmt();
  const { evo, wf, dd, unrealized, pv } = a;
  const hasEvo = evo != null && evo.resultUsd != null;
  const btcEq = a.evo && pv ? (() => { const p = a.snaps.filter((s) => s.btcEq != null && s.t >= (a.range.from ?? 0) && s.t <= a.range.to); return p.length >= 2 ? p.at(-1)!.btcEq! - p[0]!.btcEq! : null; })() : null;
  const cell = (l: string, v: string, t: "gain" | "loss" | null, sub?: string, i = 0) => <Kpi key={l} className={cn("border-b border-line", i % 2 === 0 && "border-r", "sm:border-r")} label={l} value={v === NA ? "—" : v} tone={v === NA ? null : t} sub={v === NA ? (sub && sub !== "fills no período" && sub !== "posições abertas agora" ? `${NA} · ${sub}` : NA) : sub} />;
  const items: [string, string, "gain" | "loss" | null, string?][] = [
    ["Patrimônio atual", pv ? f.money(pv.c.totalUsd, { compact: true }) : NA, null],
    ["Resultado", hasEvo ? f.money(evo!.resultUsd!, { signed: true, compact: true }) : NA, hasEvo ? toneOf(evo!.resultUsd) : null, hasEvo ? "sem aportes/retiradas" : "precisa de 2 retratos"],
    ["Rentabilidade (TWR)", evo?.twr != null ? f.pct(evo.twr) : NA, evo?.twr != null ? toneOf(evo.twr) : null, evo?.incomplete && evo.availableFrom ? `histórico desde ${dmy(evo.availableFrom)}` : undefined],
    ["P&L realizado", a.perps?.connected ? f.money(wf.gross, { signed: true, compact: true }) : NA, toneOf(wf.gross), "fills no período"],
    ["P&L não realizado", unrealized != null ? f.money(unrealized, { signed: true, compact: true }) : NA, toneOf(unrealized), "posições abertas agora"],
    ["Funding líquido", a.perps?.connected ? f.money(wf.funding, { signed: true, compact: true }) : NA, toneOf(wf.funding)],
    ["Taxas totais", a.perps?.connected ? f.money(wf.fees, { signed: true, compact: true }) : NA, wf.fees < 0 ? "loss" : null],
    ["Drawdown máximo", dd.max != null ? f.pct(-dd.max) : NA, dd.max ? "loss" : null, dd.incomplete ? "precisa de 2 retratos" : "índice sem aportes"],
    ["BTC equivalente", btcEq != null ? `${btcEq >= 0 ? "+" : ""}${btcEq.toFixed(4).replace(".", ",")} BTC` : NA, toneOf(btcEq), btcEq == null ? "retratos com BTC eq. a partir de agora" : "variação no período"],
    ["Res. operacional", a.perps?.connected ? f.money(wf.net, { signed: true, compact: true }) : NA, toneOf(wf.net), "realizado − taxas + funding"],
  ];
  return (
    <Panel tech className="mb-4 overflow-hidden">
      <PanelHead title="Indicadores do período" right={a.perps?.connected && !a.perps.historyComplete ? <Pill tone="gold">histórico de fills parcial</Pill> : undefined} />
      <div className="grid grid-cols-2 lg:grid-cols-5">{items.map(([l, v, t, s], i) => cell(l, v, t, s, i))}</div>
    </Panel>
  );
}

function WaterfallPanel({ a, className }: { a: Analytics; className?: string }) {
  const f = useFmt();
  const w = a.wf;
  const steps = [{ l: "Resultado bruto (realizado)", v: w.gross, total: false }, { l: "Funding líquido", v: w.funding, total: false }, { l: "Taxas", v: w.fees, total: false }, { l: "Outros custos identificados", v: 0, total: false, none: true }, { l: "Resultado operacional líquido", v: w.net, total: true }];
  const max = Math.max(1e-9, ...steps.map((s) => Math.abs(s.v)), Math.abs(w.gross) + Math.abs(w.funding) + Math.abs(w.fees));
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Decomposição do resultado" sub="perpétuos · realizado − taxas + funding" />
      {!a.perps?.connected ? <p className="px-4 py-6 text-[13px] text-muted">Hyperliquid não conectada.</p> : (
        <ul className="space-y-2.5 px-4 py-4">
          {steps.map((s) => {
            return (
              <li key={s.l} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className={cn(s.total ? "font-semibold text-ink" : "text-ink-2")}>{s.l}</span>
                <span className={cn("num", toneCls(toneOf(s.v)), s.total && "font-semibold")}>{(s as { none?: boolean }).none ? "nenhum" : f.money(s.v, { signed: true })}</span>
                <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className={cn("h-full rounded-full", s.v >= 0 ? "bg-gain" : "bg-loss")} style={{ width: `${Math.min(100, (Math.abs(s.v) / max) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">closedPnl não inclui taxas nem funding; cada um é descontado uma vez. O P&L aberto fica fora (já está na equity).</p>
    </Panel>
  );
}

function AssetTable({ a, className }: { a: Analytics; className?: string }) {
  const f = useFmt();
  const [key, setKey] = useState<SortKey>("net");
  const rows = sortPerf(a.rows, key);
  const th = (l: string, k?: SortKey) => <th className="px-2.5 py-2 text-right font-medium">{k ? <button onClick={() => setKey(k)} className={cn("underline-offset-2 [@media(hover:hover)]:hover:text-ink", key === k && "text-accent underline")}>{l}</button> : l}</th>;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Performance por ativo" sub="instrumentos encontrados nos fills, funding e posições" right={<span className="text-[11px] text-muted">{a.range.from ? `${dmy(a.range.from)} → ${dmy(a.range.to)}` : `até ${dmy(a.range.to)}`}</span>} />
      {a.rows.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted">{a.perps?.connected ? "Sem operações no período." : "Hyperliquid não conectada."}</p> : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[600px] whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-muted"><th className="px-3 py-2 text-left font-medium">Ativo</th>{th("Realizado", "net")}{th("Aberto")}{th("Funding", "funding")}{th("Taxas", "fees")}{th("Líquido", "loss")}{th("Contrib.", "contribution")}{th("Exposição")}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.coin}>
                  <td className="px-3 py-2 font-semibold">{r.coin}<span className="ml-1.5 text-[10px] font-normal text-muted">{r.dirs.join("/")}</span>{r.inherited && <span className="ml-1 text-[10px] text-warn" title="histórico começa com posição já aberta">*</span>}</td>
                  <td className={cn("px-2.5 py-2 text-right", toneCls(toneOf(r.realized)))}>{f.money(r.realized, { signed: true })}</td>
                  <td className={cn("px-2.5 py-2 text-right", toneCls(toneOf(r.unrealized)))}>{r.unrealized != null ? f.money(r.unrealized, { signed: true }) : "—"}</td>
                  <td className={cn("px-2.5 py-2 text-right", toneCls(toneOf(r.funding)))}>{f.money(r.funding, { signed: true })}</td>
                  <td className="px-2.5 py-2 text-right text-loss">{r.fees ? f.money(-r.fees, { signed: true }) : "—"}</td>
                  <td className={cn("px-2.5 py-2 text-right font-semibold", toneCls(toneOf(r.net)))}>{f.money(r.net, { signed: true })}</td>
                  <td className="px-2.5 py-2 text-right">{r.contribution != null ? f.pct(r.contribution, false) : "—"}</td>
                  <td className="px-2.5 py-2 text-right text-muted">{r.exposureShare != null ? f.pct(r.exposureShare, false) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Líquido = realizado − taxas + funding (período). “Aberto” e “Exposição” são da posição atual. * histórico começa com posição já aberta.</p>
    </Panel>
  );
}

function OriginPanel({ a, className }: { a: Analytics; className?: string }) {
  const f = useFmt();
  const s = a.split;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Performance por origem" sub="somente fontes conectadas" />
      {a.origins.length === 0 && !s ? <p className="px-4 py-6 text-[13px] text-muted">Nenhuma fonte com histórico.</p> : (
        <ul className="divide-y divide-line">
          {a.origins.map((o) => (
            <li key={o.origin} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.origin}</span><span className="text-[11px] text-muted">{o.accounts} conta{o.accounts === 1 ? "" : "s"}{o.incomplete && o.from ? ` · histórico desde ${dmy(o.from)}` : ""}</span></span>
              <span className={cn("num text-right", toneCls(toneOf(o.resultUsd)))}>{o.resultUsd != null ? f.money(o.resultUsd, { signed: true }) : <span className="text-muted text-[11px]">{NA}</span>}<span className="block text-[11px]">{o.twr != null ? f.pct(o.twr) : ""}</span></span>
            </li>
          ))}
          {s && (
            <>
              <li className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><span className="min-w-0 flex-1"><span className="block font-medium text-gold">Estratégia BTC/USDC</span><span className="text-[11px] text-muted">só fills e funding de BTC desde o início do ciclo</span></span><span className={cn("num", toneCls(toneOf(s.strategy.net)))}>{f.money(s.strategy.net, { signed: true })}</span></li>
              <li className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><span className="min-w-0 flex-1"><span className="block font-medium">Outros perpétuos</span><span className="text-[11px] text-muted">demais ativos da mesma conta</span></span><span className={cn("num", toneCls(toneOf(s.others.net)))}>{f.money(s.others.net, { signed: true })}</span></li>
            </>
          )}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">A equity da conta compartilhada não é dividida: só o resultado das operações é atribuído. O ciclo BTC/USDC completo está no painel da Estratégia, abaixo.</p>
    </Panel>
  );
}

function EvolutionPanel({ a, className }: { a: Analytics; className?: string }) {
  const f = useFmt();
  const pts = a.evo?.points ?? [];
  const dd = a.dd.series;
  const chart = (data: { t: number; v: number }[], color: string, id: string) => (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" stroke={C.muted} fontSize={10} tickLine={false} axisLine={false} minTickGap={48} tickFormatter={(t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")} />
        <YAxis stroke={C.muted} fontSize={10} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => (id === "ddg" ? `${(v * 100).toFixed(0)}%` : f.money(v, { compact: true }))} />
        <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-[11.5px]"><div className="text-muted">{new Date(payload[0]!.payload.t).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div className="num font-semibold">{id === "ddg" ? f.pct(payload[0]!.payload.v, false) : f.money(payload[0]!.payload.v, { signed: true })}</div></div> : null} />
        <Area type="monotone" dataKey="v" stroke={color} fill={`url(#${id})`} strokeWidth={1.8} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
  const bench = (["BTC", "ETH", "SOL"] as const).map((k) => ({ k, h: a.bench[k] }));
  const mine = a.evo?.resultUsd;
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Evolução e benchmarks" sub="resultado acumulado sem aportes · queda desde o pico" />
      {pts.length < 2 ? <p className="px-4 py-6 text-[13px] text-muted">{NA}: o gráfico precisa de 2 retratos no período (um por hora).</p> : (
        <div className="grid gap-1 px-1 pt-3 sm:grid-cols-2">
          <div><p className="lbl px-3">Resultado acumulado</p>{chart(pts.map((p) => ({ t: p.t, v: p.result })), "var(--color-accent)", "resg")}</div>
          <div><p className="lbl px-3">Drawdown</p>{chart(dd.map((p) => ({ t: p.t, v: -p.dd })), "var(--color-loss)", "ddg")}</div>
        </div>
      )}
      <div className="border-t border-line">
        <p className="lbl px-4 pt-3">Se o mesmo capital e os mesmos aportes tivessem ido só para…</p>
        <ul className="divide-y divide-line">
          {bench.map(({ k, h }) => (
            <li key={k} className="flex items-center justify-between px-4 py-2 text-[13px]"><span>{k} <span className="text-[11px] text-muted">buy &amp; hold</span></span>
              {h ? <span className={cn("num text-right", toneCls(toneOf(h.resultUsd)))}>{f.money(h.resultUsd, { signed: true })}<span className="ml-2 text-[11px]">{f.pct(h.pct)}</span>{mine != null && <span className="ml-2 text-[11px] text-muted">vs você {f.money(mine - h.resultUsd, { signed: true, compact: true })}</span>}</span> : <span className="text-[12px] text-muted">{NA}{k !== "BTC" ? " (preços de ETH/SOL só são gravados a partir de agora)" : ""}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Comparação em USD, com os mesmos fluxos externos (convertidos ao preço do retrato anterior). O TWR do portfólio não é comparado diretamente com esse resultado.</p>
      </div>
    </Panel>
  );
}

function PerpsAnalysis({ a, className }: { a: Analytics; className?: string }) {
  const f = useFmt();
  const s = a.stats;
  const n = (v: number | null, d = 2) => (v != null ? v.toFixed(d).replace(".", ",") : "—");
  return (
    <Panel tech className={cn("overflow-hidden", className)}>
      <PanelHead title="Análise de perpétuos" sub="operações encerradas no período (fills agrupados)" />
      {s.closed === 0 ? <p className="px-4 py-6 text-[13px] text-muted">{a.perps?.connected ? "Nenhuma operação encerrada no período." : "Hyperliquid não conectada."}</p> : (
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {([
            ["Operações", String(s.closed), null], ["Taxa de acerto", s.winRate != null ? f.pct(s.winRate, false) : "—", null],
            ["Ganho médio", s.avgWin != null ? f.money(s.avgWin, { signed: true }) : "—", "gain"], ["Perda média", s.avgLoss != null ? f.money(-s.avgLoss, { signed: true }) : "—", s.avgLoss ? "loss" : null],
            ["Profit factor", n(s.profitFactor), null], ["Expectância", s.expectancy != null ? f.money(s.expectancy, { signed: true }) : "—", toneOf(s.expectancy)],
            ["Maior ganho", s.largestWin != null ? f.money(s.largestWin, { signed: true }) : "—", "gain"], ["Maior perda", s.largestLoss != null ? f.money(s.largestLoss, { signed: true }) : "—", s.largestLoss ? "loss" : null],
            ["LONG", `${s.byDir.LONG.n} · ${f.money(s.byDir.LONG.net, { signed: true, compact: true })}`, toneOf(s.byDir.LONG.net)], ["SHORT", `${s.byDir.SHORT.n} · ${f.money(s.byDir.SHORT.net, { signed: true, compact: true })}`, toneOf(s.byDir.SHORT.net)],
          ] as [string, string, "gain" | "loss" | null][]).map(([l, v, t], i) => <Kpi key={l} className="border-b border-line" label={l} value={v} tone={t} />)}
        </div>
      )}
      {s.inheritedClosed > 0 && <p className="border-t border-line px-4 py-2 text-[11px] text-warn">{s.inheritedClosed} operação(ões) começou(aram) antes do histórico: preço de entrada desconhecido.</p>}
    </Panel>
  );
}

export function AnalyticsSection({ strategyStart }: { strategyStart: number | null }) {
  const [kind, setKind] = useState<RangeKind>("30");
  const [custom, setCustom] = useState<Custom>(undefined);
  const a = useAnalytics(kind, custom, strategyStart);
  return (
    <section aria-label="Performance Analytics" className="mb-6">
      <div className="mb-3"><RangePicker kind={kind} setKind={setKind} custom={custom} setCustom={setCustom} /></div>
      {a.evo?.incomplete && a.evo.availableFrom != null && <div className="mb-3"><Notice tone="warn">Histórico patrimonial incompleto para este período: os retratos começam em {dmy(a.evo.availableFrom)}. Nada foi reconstruído.</Notice></div>}
      <Indicators a={a} />
      <div className="grid gap-4 lg:grid-cols-12 lg:items-stretch">
        <AssetTable a={a} className="lg:col-span-8" />
        <WaterfallPanel a={a} className="lg:col-span-4" />
        <OriginPanel a={a} className="lg:col-span-5" />
        <EvolutionPanel a={a} className="lg:col-span-7" />
        <PerpsAnalysis a={a} className="lg:col-span-12" />
      </div>
      <details className="mt-3 rounded-xl border border-line bg-surface/60 px-4 py-2 text-[12px] text-ink-2">
        <summary className="cursor-pointer text-ink">Metodologia</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
          <li>Resultado das operações = P&L realizado (closedPnl) − taxas + funding, somente dentro do período; cada parcela entra uma vez.</li>
          <li>P&L não realizado é o das posições abertas agora e não tem série histórica; a equity da Hyperliquid já o contém, então ele não é somado de novo ao patrimônio.</li>
          <li>Notional é exposição, não patrimônio. Margem não é resultado. Transferências entre contas próprias e depósitos/retiradas não são lucro.</li>
          <li>Rentabilidade = TWR (ajustada por fluxos) e drawdown sobre o índice TWR. Com menos de 2 retratos, “{NA}”. Nada é reconstruído a partir do patrimônio atual.</li>
          <li>Operação = posição aberta até zerar; execuções parciais pertencem à mesma operação. Operações encerradas entram pela data de fechamento.</li>
          <li>Benchmarks: mesmo capital e mesmos aportes aplicados ao preço gravado nos retratos. ETH/SOL só existem a partir de agora.</li>
          <li>Estratégia BTC/USDC: só BTC desde o início do ciclo; os demais ativos da conta ficam em “Outros perpétuos”.</li>
        </ul>
      </details>
    </section>
  );
}
