"use client";
/** Risk Center: exposição, liquidação, concentração, contraparte, quedas e simulador de cenários do BTC. */
import { DEFAULT_SCENARIO_RULES } from "@bst/domain";
import { useRisk } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { getStore } from "@/lib/local/store";
import { PerpRisk } from "./perp-risk";
import { Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, RiskMeter, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

export default function RiskPage() {
  const q = useRisk();
  const f = useFmt();
  const r = q.data;
  if (q.loading || !r) return q.error ? <div className="pt-5"><Notice tone="loss">{q.error.message}</Notice></div> : <div className="space-y-4 pt-5"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  const e = r.exposure;
  const st = getStore().settings;
  const rules = { ...DEFAULT_SCENARIO_RULES, ...(st.scenarioRules ?? {}) };
  const minLiq = Number(st.minLiqDistance);
  const cp = r.counterparty, cpTotal = cp.onExchange + cp.selfCustody + cp.unknown || 1;
  return (
    <div className="pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">Risk Center</h1>
      <p className="mb-4 text-[12px] text-muted">Todas as contas do Portfólio · estimativas a partir das posições reais</p>

      <KpiGrid className="mb-4 grid-cols-2 lg:grid-cols-6">
        <Kpi label="Exposição bruta" value={f.money(e.grossUsd, { compact: true })} sub={`long ${f.money(e.longUsd, { compact: true })} · short ${f.money(e.shortUsd, { compact: true })}`} />
        <Kpi label="Exposição líquida" value={f.money(e.netUsd, { compact: true, signed: true })} sub="long − short" />
        <Kpi label="BTC líquido" value={`${e.btcNet >= 0 ? "+" : "−"}${f.btc(Math.abs(e.btcNet), 6)}`} sub={`spot ${f.btc(e.btcSpot, 4)} · sintético ${e.btcSynthetic >= 0 ? "+" : "−"}${f.btc(Math.abs(e.btcSynthetic), 4)}`} />
        <Kpi label="Alavancagem efetiva" tone={e.effLeverage != null && e.effLeverage > rules.leverageMax ? "loss" : null} value={e.effLeverage != null ? `${e.effLeverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"} sub="bruta ÷ patrimônio total" />
        <Kpi label="Dist. da liquidação" tone={e.minLiqDistance != null && e.minLiqDistance < minLiq ? "loss" : null} value={e.minLiqDistance != null ? f.pct(e.minLiqDistance, false) : "sem posição"} sub={`seu limite ${f.pct(minLiq, false)}`} />
        <Kpi label="Margem usada · livre" value={f.money(r.marginUsed, { compact: true })} sub={r.marginAvailable != null ? `livre ${f.money(r.marginAvailable, { compact: true })}` : "livre: —"} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-7">
          <Panel className="overflow-hidden">
            <PanelHead title="Simulador de cenários do BTC" right="sobre as posições reais" />
            {r.shocks.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-[13px]">
                  <thead><tr className="border-b border-line text-left">{["BTC", "Preço", "Spot", "Derivativos", "Patrimônio", "BTC eq.", "Liquidação"].map((h) => <th key={h} className="lbl px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {r.shocks.map((x) => (
                      <tr key={x.shock} className={cn(x.liquidated.length && "bg-loss-soft")}>
                        <td className={cn("num px-3 py-2 font-semibold", toneCls(toneOf(x.shock)))}>{f.pct(x.shock)}</td>
                        <td className="num px-3 py-2 text-ink-2">{f.px(x.btcPx)}</td>
                        <td className={cn("num px-3 py-2", toneCls(toneOf(x.spotUsd)))}>{f.money(x.spotUsd, { signed: true, compact: true })}</td>
                        <td className={cn("num px-3 py-2", toneCls(toneOf(x.derivUsd)))}>{f.money(x.derivUsd, { signed: true, compact: true })}</td>
                        <td className="num px-3 py-2">{f.money(x.totalUsd, { compact: true })} <span className={cn("text-[11px]", toneCls(toneOf(x.totalUsd - r.total)))}>{r.total ? f.pct(x.totalUsd / r.total - 1) : ""}</span></td>
                        <td className="num px-3 py-2 text-ink-2">{f.btc(x.btcEquivalent, 4)}</td>
                        <td className="px-3 py-2" title={[...x.liquidated, ...x.nearLiq].join(", ")}>{x.liquidated.length ? <Pill tone="loss">liquida ({x.liquidated.length})</Pill> : x.nearLiq.length ? <Pill tone="neutral">perto</Pill> : <span className="text-[12px] text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="px-4 py-5 text-[13px] text-muted">Sem cotação do BTC agora.</p>}
            <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">Estimativa: o BTC spot (e representações) e os derivativos em BTC variam com o choque; os demais ativos ficam constantes; quem cruza o preço de liquidação perde até esse preço. Não considera taxas de liquidação, funding nem a correlação de outros ativos com o BTC.</p>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHead title="Posições em derivativos" right={`${r.positions.length} aberta(s)`} />
            {r.positions.length ? <ul className="divide-y divide-line">{r.positions.map((p) => {
              const d = p.liq && p.mark ? (p.dir === "LONG" ? (p.mark - p.liq) / p.mark : (p.liq - p.mark) / p.mark) : null;
              return (
                <li key={`${p.accountId}${p.instrument}`} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{p.instrument}</span><Pill tone={p.dir === "LONG" ? "btc" : "loss"}>{p.dir}</Pill><span className="text-muted">{r.accounts.find((a) => a.id === p.accountId)?.institution}</span>
                    <span className="num ml-auto">{f.money(p.notional ?? 0, { compact: true })} · {p.leverage != null ? `${p.leverage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</span></div>
                  {d != null && <RiskMeter label="Distância da liquidação" value={d} display={`${f.pct(d, false)} · liq. ${f.px(p.liq)}`} max={0.6} zones={[minLiq, minLiq * 2]} limit={minLiq} invert />}
                </li>
              );
            })}</ul> : <p className="px-4 py-5 text-[13px] text-muted">Nenhuma posição em derivativos.</p>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-5">
          <Panel className="overflow-hidden">
            <PanelHead title="Concentração" right="pelo saldo contábil" />
            <div className="grid grid-cols-2">
              <Kpi className="border-r border-line" label="Maior saldo" value={r.topAsset ? `${r.topAsset.symbol} ${f.pct(r.topAsset.share ?? 0, false)}` : "—"} sub={r.concentrationAsset.hhi != null ? `índice ${r.concentrationAsset.hhi.toFixed(2).replace(".", ",")} (0–1)` : undefined} />
              <Kpi label="Maior instituição" value={r.topInst ? `${f.pct(r.topInst.share, false)}` : "—"} sub={r.topInst?.key} />
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">Conta com derivativos entra pelo patrimônio (em USDC). A exposição econômica ao BTC é a de “BTC líquido”: {e.btcNet >= 0 ? "+" : "−"}{f.btc(Math.abs(e.btcNet), 4)} BTC ≈ {f.money(Math.abs(e.btcNet) * r.px, { compact: true })} ({r.total ? f.pct((Math.abs(e.btcNet) * r.px) / r.total, false) : "—"} do patrimônio).</p>
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHead title="Risco de contraparte" right="onde o patrimônio está" />
            <div className="space-y-2 px-4 py-3 text-[13px]">
              {[["Em exchanges (OKX, Hyperliquid)", cp.onExchange, "var(--color-warn)"], ["Autocustódia (carteiras próprias)", cp.selfCustody, "var(--color-gain)"], ["Cadastro manual (custódia informada)", cp.unknown, "var(--color-muted)"]].map(([l, v, c]) => (
                <div key={l as string}><div className="flex justify-between"><span className="text-ink-2">{l as string}</span><span className="num">{f.money(v as number, { compact: true })} · {f.pct((v as number) / cpTotal, false)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-[2px] bg-surface-3"><span className="block h-full" style={{ width: `${((v as number) / cpTotal) * 100}%`, background: c as string }} /></div></div>
              ))}
            </div>
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHead title="Quedas" />
            <div className="grid grid-cols-2">
              <Kpi className="border-r border-line" label="Estratégia: atual · máx." tone={(r.strategyDD.current ?? 0) > 0 ? "loss" : null} value={r.strategyDD.current != null ? f.pct(-r.strategyDD.current) : "—"} sub={r.strategyDD.max != null ? `máx. ${f.pct(-r.strategyDD.max)}` : undefined} />
              <Kpi label="Portfólio: máx." tone={(r.portfolioDD.max ?? 0) > 0 ? "loss" : null} value={r.portfolioDD.max != null ? f.pct(-r.portfolioDD.max) : "—"} sub={r.portfolioDD.max == null ? "a partir do 2º retrato" : "pelos retratos"} />
            </div>
          </Panel>
        </div>
      </div>
      <PerpRisk />
    </div>
  );
}
