"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Download, Plus } from "lucide-react";
import { NeedsSetup, useSnapshot } from "@/lib/api";
import { StrategySetup } from "@/components/strategy";
import { useFmt } from "@/lib/state";
import { usdBrlAt } from "@/lib/local/prices";
import type { Cycle, Flow } from "@/lib/local/store";
import { Button, CoinIcon, Notice, Segmented, Skeleton, cn, Panel } from "@/components/ui";
import { Hero } from "@/components/shell";
import { Sheet } from "@/components/sheet";
import { AddSheet, EntrySheet, ExitSheet, FlowSheet } from "@/components/forms";

type Kind = "trade" | "cash";
interface Item { key: string; ms: number; kind: Kind; icon: ReactNode; title: string; sub?: string; amount: string; tone: "gain" | "loss" | null; usd: number | null; onClick?: () => void }

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const btcAmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 });
const usdcAmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function csv(rows: (string | number)[][], name: string) {
  const text = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function TransactionsPage() {
  const q = useSnapshot();
  const f = useFmt();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [sheet, setSheet] = useState<null | { k: "menu" } | { k: "enter" } | { k: "edit"; c: Cycle } | { k: "exit"; c: Cycle } | { k: "add"; c: Cycle } | { k: "flow"; fl?: Flow }>(null);
  const s = q.data;

  const items = useMemo<Item[]>(() => {
    if (!s) return [];
    const out: Item[] = [];
    const cyc = (id?: string) => (id ? s.s.cycles.find((c) => c.id === id) : undefined);
    const flw = (id?: string) => (id ? s.s.flows.find((x) => x.id === id) : undefined);
    for (const e of s.events) {
      if (e.k === "trade") {
        const buy = e.side === "B";
        const c = e.src === "manual" ? cyc(e.ref) : undefined;
        out.push({ key: e.key, ms: e.t, kind: "trade", icon: <CoinIcon kind="btc" size={26} />, title: buy ? "Compra" : "Venda", sub: `${hhmm(e.t)} · ${e.label ?? (buy ? "compra" : "venda")} a ${f.px(e.px)}`,
          amount: `${buy ? "+" : "−"} ${btcAmt(e.sz)} BTC`, tone: buy ? "gain" : "loss", usd: e.px * e.sz,
          onClick: c ? () => setSheet(!buy || e.key.endsWith("|close") ? { k: "exit", c } : { k: "edit", c }) : undefined });
      } else if (e.k === "flow") {
        const fl = e.src === "manual" ? flw(e.ref) : undefined;
        out.push({ key: e.key, ms: e.t, kind: "cash", icon: <CoinIcon kind="cash" size={26} />, title: e.usd >= 0 ? "Depósito" : "Saque", sub: `${hhmm(e.t)} · ${e.label}`,
          amount: `${e.usd >= 0 ? "+" : "−"} ${usdcAmt(Math.abs(e.usd))} USDC`, tone: e.usd >= 0 ? "gain" : "loss", usd: null, onClick: fl ? () => setSheet({ k: "flow", fl }) : undefined });
      } else if (e.k === "income") {
        out.push({ key: e.key, ms: e.t, kind: "cash", icon: <CoinIcon kind="other" size={26} />, title: "Recompensa", sub: `${hhmm(e.t)} · ${e.label} (entra no resultado)`,
          amount: `+ ${usdcAmt(e.usd)} USDC`, tone: "gain", usd: null });
      }
    }
    // funding: um resumo por dia, para não poluir a lista
    const byDay = new Map<string, { t: number; usd: number }>();
    for (const e of s.events) if (e.k === "funding") { const k = dayLabel(e.t); const v = byDay.get(k) ?? { t: e.t, usd: 0 }; v.usd += e.usd; v.t = Math.max(v.t, e.t); byDay.set(k, v); }
    for (const [k, v] of byDay) out.push({ key: `fund-${k}`, ms: v.t, kind: "trade", icon: <CoinIcon kind="other" size={26} />, title: "Funding", sub: "soma do dia", amount: `${v.usd >= 0 ? "+" : "−"} ${usdcAmt(Math.abs(v.usd))} USDC`, tone: v.usd >= 0 ? "gain" : "loss", usd: null });
    if (s.scope.kind === "strategy") out.push({ key: "start", ms: s.startT, kind: "cash", icon: <CoinIcon kind="strategy" size={26} />, title: "Início do ciclo", sub: `patrimônio inicial · ${s.snapSource === "manual" ? "referência manual" : s.snapSource === "live" ? "oficial" : "reconstruído"}`, amount: `${usdcAmt(s.equity0)} USD`, tone: null, usd: null });
    return out.sort((x, y) => y.ms - x.ms);
  }, [s, f]);

  if (q.loading) return <div className="space-y-3 pt-4"><Skeleton className="h-28" /><Skeleton className="h-60" /></div>;
  if (q.error instanceof NeedsSetup) return <StrategySetup />;
  if (q.error || !s) return <div className="pt-4"><Notice tone="loss">{q.error?.message}</Notice></div>;

  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const groups: { day: string; rows: Item[] }[] = [];
  for (const i of shown) {
    const day = dayLabel(i.ms);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(i); else groups.push({ day, rows: [i] });
  }
  const conv = (usd: number, ms: number) => usd * (f.ccy === "BRL" ? usdBrlAt(ms / 1000) ?? f.fx : 1);
  const exportCsv = () => csv([["data", "tipo", "quantidade", "valor_usd", "detalhe"], ...items.map((i) => [new Date(i.ms).toISOString(), i.title, i.amount, i.usd?.toFixed(2) ?? "", i.sub ?? ""])], `transacoes-btc-${new Date().toISOString().slice(0, 10)}.csv`);

  return (
    <div>
      <Hero />
      <div className="mb-4 flex items-center gap-2">
        <Segmented size="sm" label="Tipo" value={filter} onChange={setFilter} options={[{ value: "all", label: "Tudo" }, { value: "trade", label: "Operações" }, { value: "cash", label: "Depósitos" }]} />
        <div className="ml-auto flex gap-1">
          {items.length > 0 && <Button variant="ghost" size="sm" className="h-9 px-2.5" aria-label="Exportar CSV" onClick={exportCsv}><Download className="size-4" /><span className="hidden sm:inline">CSV</span></Button>}
          <Button variant="primary" size="sm" className="h-9 px-3" aria-label="Lançar" onClick={() => setSheet({ k: "menu" })}><Plus className="size-4" />Lançar</Button>
        </div>
      </div>

      <p className="-mt-2 mb-4 text-[12px] text-muted">{s.scope.kind === "account" ? "Histórico completo da conta (bruto, para auditoria)." : `Só o que aconteceu dentro de “${s.label}”. Para ver tudo, escolha “Histórico completo da conta” no topo.`}</p>
      {groups.length === 0 && <p className="py-14 text-center text-[16px] text-muted">Nenhuma transação ainda.</p>}
      {groups.map((g) => (
        <section key={g.day} className="mb-4">
          <h2 className="lbl sticky top-[calc(env(safe-area-inset-top)+92px)] z-10 bg-bg/95 py-1.5 backdrop-blur lg:top-[calc(env(safe-area-inset-top)+48px)]">{g.day}</h2>
          <Panel className="overflow-hidden">
            <ul className="divide-y divide-line">
              {g.rows.map((i) => {
                const Tag = i.onClick ? "button" : "div";
                return (
                  <li key={i.key}>
                    <Tag onClick={i.onClick} className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left", i.onClick && "[@media(hover:hover)]:hover:bg-surface-2")}>
                      <span className="num w-11 shrink-0 text-[12px] text-muted">{hhmm(i.ms)}</span>
                      {i.icon}
                      <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{i.title}</span>{i.sub && <span className="block truncate text-[12px] text-muted">{i.sub.replace(/^\d{2}:\d{2} · /, "")}</span>}</span>
                      <span className="shrink-0 text-right">
                        <span className={cn("num block text-[13.5px] font-medium", i.tone === "gain" ? "text-gain" : i.tone === "loss" ? "text-loss" : "text-ink")}>{f.hidden ? "•••" : i.amount}</span>
                        {i.usd != null && <span className="num block text-[12px] text-muted">{f.cash(conv(i.usd, i.ms))}</span>}
                      </span>
                    </Tag>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </section>
      ))}

      {sheet?.k === "menu" && (
        <Sheet title="Lançar" onClose={() => setSheet(null)}>
          <div className="space-y-2 pb-2">
            {s.acc.kind === "hl" && <p className="mb-3 text-[14px] leading-relaxed text-muted">As operações e os depósitos da Hyperliquid entram sozinhos. Lance aqui só dinheiro que entrou ou saiu por fora da corretora.</p>}
            {s.acc.kind === "manual" && (s.current?.cycle
              ? <>
                  <Button variant="primary" size="lg" className="w-full" onClick={() => setSheet({ k: "add", c: s.current!.cycle! })}>Aumentar posição</Button>
                  <Button size="lg" className="w-full" onClick={() => setSheet({ k: "exit", c: s.current!.cycle! })}>Sair para USDC</Button>
                </>
              : <Button variant="primary" size="lg" className="w-full" onClick={() => setSheet({ k: "enter" })}>Entrar em BTC</Button>)}
            <Button size="lg" className="w-full" onClick={() => setSheet({ k: "flow" })}>Aporte ou retirada</Button>
          </div>
        </Sheet>
      )}
      {sheet?.k === "enter" && <EntrySheet onClose={() => setSheet(null)} />}
      {sheet?.k === "edit" && <EntrySheet edit={sheet.c} onClose={() => setSheet(null)} />}
      {sheet?.k === "exit" && <ExitSheet cycle={sheet.c} onClose={() => setSheet(null)} />}
      {sheet?.k === "add" && <AddSheet cycle={sheet.c} onClose={() => setSheet(null)} />}
      {sheet?.k === "flow" && <FlowSheet edit={sheet.fl} onClose={() => setSheet(null)} />}
    </div>
  );
}
