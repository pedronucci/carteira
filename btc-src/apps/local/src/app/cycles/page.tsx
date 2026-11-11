"use client";
/** Ciclos da estratégia: comparar, encerrar e arquivar. Nada é apagado aqui. */
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Plus, Square } from "lucide-react";
import { useDataVersion } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { backupNow, getStore, updateStore } from "@/lib/local/store";
import { compute } from "@/lib/local/engine";
import { fmtDuration, fmtZoned, type StrategyCycle } from "@/lib/local/strategy";
import { STRATEGY_TABS, SubNav } from "@/components/nav";
import { StrategySheet } from "@/components/strategy";
import { toast } from "@/components/toaster";
import { Button, Notice, Panel, PanelHead, Pill, cn, toneCls, toneOf } from "@/components/ui";

type Row = { c: StrategyCycle; r: ReturnType<typeof compute> | null; err: string | null };

export default function CyclesPage() {
  const v = useDataVersion();
  const f = useFmt();
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(false);
  const s = getStore();
  const rows = useMemo<Row[]>(() => [...s.strategies].sort((a, b) => b.startAt - a.startAt).map((c) => {
    try { return { c, r: compute(c.id), err: null }; } catch (e) { return { c, r: null, err: (e as Error).message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [v]);
  const visible = rows.filter((x) => showArchived || !x.c.archived);
  const archivedCount = rows.filter((x) => x.c.archived).length;
  const active = rows.find((x) => x.c.status === "active");

  const closeActive = () => {
    if (!active?.r) return;
    const eq = active.r.equity.toNumber();
    if (!window.confirm(`Encerrar “${active.c.name}” agora, com patrimônio de ${f.usd(eq, { reveal: true })}? Ele continua salvo e pode ser consultado.`)) return;
    backupNow("antes de encerrar o ciclo");
    updateStore((x) => {
      const c = x.strategies.find((y) => y.id === active.c.id);
      if (c) { c.status = "closed"; c.endAt = Date.now(); c.endEquityUsd = eq.toFixed(2); c.endBtcUsd = active.r!.now.btcUsd.toString(); x.view = c.id; }
    });
    toast("Ciclo encerrado. Para continuar acompanhando, inicie um novo ciclo.", "gain");
  };
  const archive = (c: StrategyCycle, on: boolean) => {
    backupNow(on ? "antes de arquivar um ciclo" : "antes de desarquivar um ciclo");
    updateStore((x) => { const y = x.strategies.find((z) => z.id === c.id); if (y) y.archived = on; if (on && x.view === c.id) x.view = "active"; });
  };

  return (
    <div className="pt-3">
      <SubNav items={STRATEGY_TABS} />
      <div className="mt-4 mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[18px] font-semibold tracking-tight">Ciclos da estratégia</h1>
        <div className="flex gap-2">
          {active && <Button size="sm" onClick={closeActive}><Square className="size-3.5" />Encerrar ciclo atual</Button>}
          <Button size="sm" variant="primary" onClick={() => setForm(true)}><Plus className="size-4" />Novo ciclo</Button>
        </div>
      </div>
      {rows.length === 0 && <Notice tone="info">Nenhum ciclo ainda. Crie o primeiro em “Novo ciclo”.</Notice>}
      {visible.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHead title="Comparação" right="cada ciclo medido a partir do próprio início" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Ciclo", "Início", "Duração", "Capital", "Resultado", "s/ capital", "TWR", "vs. só BTC", "Queda máx.", "Operações", ""].map((h) => <th key={h} className="lbl px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map(({ c, r, err }) => (
                  <tr key={c.id} className={cn(c.archived && "opacity-60")}>
                    <td className="px-3 py-2.5">
                      <span className="block font-medium">{c.name}</span>
                      <span className="mt-0.5 flex gap-1">{c.status === "active" ? <Pill tone="gold">em andamento</Pill> : <Pill>encerrado</Pill>}{c.archived && <Pill>arquivado</Pill>}</span>
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap text-ink-2">{fmtZoned(c.startAt, c.tz)}</td>
                    <td className="num px-3 py-2.5 whitespace-nowrap text-ink-2">{fmtDuration((c.endAt ?? Date.now()) - c.startAt)}</td>
                    {r ? (
                      <>
                        <td className="num px-3 py-2.5 text-right">{f.money(r.contrib, { compact: true })}</td>
                        <td className={cn("num px-3 py-2.5 text-right font-medium", toneCls(toneOf(r.result)))}>{f.money(r.result, { signed: true, compact: true })}</td>
                        <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r.roc)))}>{r.roc != null ? f.pct(r.roc) : "—"}</td>
                        <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r.twr)))}>{r.twr != null ? f.pct(r.twr) : "—"}</td>
                        <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(r.vsHodlPct)))}>{r.vsHodlPct != null ? f.pct(r.vsHodlPct) : "—"}</td>
                        <td className="num px-3 py-2.5 text-right text-loss">{f.pct(r.maxDD == null ? null : -r.maxDD)}</td>
                        <td className="num px-3 py-2.5 text-right text-ink-2">{r.stats.count + (r.current ? 1 : 0)}</td>
                      </>
                    ) : <td colSpan={7} className="px-3 py-2.5 text-[12px] text-muted">{err}</td>}
                    <td className="px-3 py-2.5 text-right">
                      {c.status === "closed" && <Button size="sm" variant="ghost" onClick={() => archive(c, !c.archived)} aria-label={c.archived ? "Desarquivar" : "Arquivar"}>{c.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {archivedCount > 0 && <button onClick={() => setShowArchived((x) => !x)} className="w-full border-t border-line px-4 py-2.5 text-left text-[12px] text-accent">{showArchived ? "Ocultar arquivados" : `Mostrar ${archivedCount} arquivado${archivedCount > 1 ? "s" : ""}`}</button>}
        </Panel>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">Arquivar só tira o ciclo da lista principal; ele continua salvo e pode ser restaurado. Encerrar fixa o patrimônio final do ciclo. Nenhum histórico da conta é apagado.</p>
      {form && <StrategySheet mode="new" onClose={() => setForm(false)} />}
    </div>
  );
}
