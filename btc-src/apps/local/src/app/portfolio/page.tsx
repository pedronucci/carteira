"use client";
/**
 * Portfólio Consolidado: todos os ativos em todas as contas, sem contagem dupla.
 * Separado da Estratégia BTC/USDC: nada daqui altera o resultado da estratégia.
 */
import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, Plus, Search, Upload } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney, returnSince, type EconLine } from "@bst/domain";
import { usePortfolio } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { portfolioError, portfolioReady } from "@/lib/portfolio/db";
import { addManualFlow, importHoldingsCsv, parseHoldingsCsv, priceBookInfo, removeManualHolding, resolvePending, saveManualHolding, type ManualInput } from "@/lib/portfolio/engine";
import { C } from "@/components/charts";
import { Sheet } from "@/components/sheet";
import { toast } from "@/components/toaster";
import { Button, Field, Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";

type Tab = "assets" | "accounts" | "dist" | "evo" | "moves";
type SortKey = "value" | "econ" | "qty" | "change" | "pnl" | "share";
const KIND_LABEL: Record<string, string> = { strategy: "estratégia", manual: "manual", csv: "CSV", hyperliquid: "Hyperliquid", okx: "OKX", evm: "EVM", bitcoin: "Bitcoin", solana: "Solana" };

export default function PortfolioPage() {
  const q = usePortfolio();
  const f = useFmt();
  const [tab, setTab] = useState<Tab>("assets");
  const [sheet, setSheet] = useState<null | { k: "add"; edit?: { key: string; init: ManualInput } } | { k: "csv" } | { k: "flow" }>(null);
  const v = q.data;
  if (!portfolioReady() || (!v && q.loading)) return <div className="space-y-4 pt-5"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  if (!v) return <div className="pt-5"><Notice tone="loss">{q.error?.message ?? "Portfólio indisponível."}</Notice></div>;
  const c = v.c;
  const r24 = returnSince(v.series, 24 * 3600e3), r30 = returnSince(v.series, 30 * 86400e3), rAll = returnSince(v.series, null);
  const pi = priceBookInfo();

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Portfólio Consolidado</h1>
          <p className="text-[12px] text-muted">Todas as contas, sem contagem dupla · separado da Estratégia BTC/USDC</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSheet({ k: "csv" })}><Upload className="size-4" />CSV</Button>
          <Button size="sm" variant="primary" onClick={() => setSheet({ k: "add" })}><Plus className="size-4" />Adicionar ativo</Button>
        </div>
      </div>
      {portfolioError() && <div className="mb-3"><Notice tone="loss">{portfolioError()}</Notice></div>}
      {pi.error && <div className="mb-3"><Notice>Cotações dos demais ativos indisponíveis agora ({pi.error}). Ativos sem preço ficam fora do total.</Notice></div>}
      {v.pending.length > 0 && <div className="mb-3"><Notice>{v.pending.length} movimentação(ões) sem classificação. Confira em Movimentações.</Notice></div>}

      <KpiGrid className="mb-4 grid-cols-2 lg:grid-cols-5">
        <Kpi big label="Patrimônio total" value={f.money(c.totalUsd)} sub={f.ccy === "BRL" ? f.usd(c.totalUsd) : undefined} />
        <Kpi label="BTC equivalente" value={c.btcEquivalent != null ? f.btc(c.btcEquivalent, 6) : "—"} sub={`BTC possuído ${f.btc(c.btcHeld.total, 6)}`} />
        <Kpi label="24 h" tone={toneOf(r24?.pct)} value={r24 ? f.pct(r24.pct) : "—"} sub={r24 ? f.money(r24.resultUsd, { signed: true }) : "sem histórico"} />
        <Kpi label="30 dias" tone={toneOf(r30?.pct)} value={r30 ? f.pct(r30.pct) : "—"} sub={r30 ? f.money(r30.resultUsd, { signed: true }) : "sem histórico"} />
        <Kpi className="col-span-2 lg:col-span-1" label="Acumulado" tone={toneOf(rAll?.pct)} value={rAll ? f.pct(rAll.pct) : "—"} sub={rAll ? `desde ${new Date(rAll.fromT).toLocaleDateString("pt-BR")}` : "a partir do 2º retrato"} />
      </KpiGrid>

      <div className="mb-3 overflow-x-auto"><Segmented label="Seção" value={tab} onChange={setTab} options={[{ value: "assets", label: "Ativos" }, { value: "accounts", label: "Contas" }, { value: "dist", label: "Distribuição" }, { value: "evo", label: "Evolução" }, { value: "moves", label: `Movimentações${v.pending.length ? ` · ${v.pending.length}` : ""}` }]} /></div>

      {tab === "assets" && <AssetsTable v={v} onEdit={(key, init) => setSheet({ k: "add", edit: { key, init } })} />}
      {tab === "accounts" && <Accounts v={v} />}
      {tab === "dist" && <Distribution v={v} />}
      {tab === "evo" && <Evolution v={v} />}
      {tab === "moves" && <Moves v={v} onAdd={() => setSheet({ k: "flow" })} />}

      {c.unpriced.length > 0 && tab === "assets" && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted">Sem preço (fora do total): {c.unpriced.map((u) => `${u.symbol} em ${u.institution}`).join(", ")}. Informe um id da CoinGecko ou um preço manual ao editar o ativo.</p>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">Cotações: CoinGecko{pi.at ? ` · ${new Date(pi.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}; BTC igual ao da Estratégia. Contas com derivativos entram pelo patrimônio líquido (margem e P&L aberto já incluídos); o valor nocional nunca é somado. Cadastrar ou alterar um saldo é ajuste, não lucro.</p>

      {sheet?.k === "add" && <HoldingSheet edit={sheet.edit} onClose={() => setSheet(null)} />}
      {sheet?.k === "csv" && <CsvSheet onClose={() => setSheet(null)} />}
      {sheet?.k === "flow" && <FlowSheet accounts={v.accounts.filter((a) => a.id !== "strategy")} onClose={() => setSheet(null)} />}
    </div>
  );
}

type View = NonNullable<ReturnType<typeof usePortfolio>["data"]>;

function AssetsTable({ v, onEdit }: { v: View; onEdit: (key: string, init: ManualInput) => void }) {
  const f = useFmt();
  const [qText, setQ] = useState("");
  const [inst, setInst] = useState("all");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "value", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const insts = [...new Set(v.c.assets.flatMap((a) => a.sources.map((s) => s.institution)))];
  const rows = useMemo(() => {
    const t = qText.trim().toLowerCase();
    const val = (a: EconLine) => ({ value: a.valueUsd ?? -1, econ: a.econ, qty: a.qty, change: a.change24h ?? -99, pnl: a.pnlUsd ?? -1e18, share: a.share ?? -1 })[sort.k];
    return v.c.assets
      .filter((a) => (!t || a.econ.toLowerCase().includes(t) || a.symbol.toLowerCase().includes(t) || a.sources.some((s) => s.institution.toLowerCase().includes(t))) && (inst === "all" || a.sources.some((s) => s.institution === inst)))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [v, qText, inst, sort]);
  const th = (k: SortKey, label: string, right = true) => (
    <th className={cn("lbl cursor-pointer px-3 py-2 font-semibold whitespace-nowrap select-none", right && "text-right")} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label}{sort.k === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );
  if (!v.c.assets.length) return (
    <Panel className="p-6">
      <p className="text-[14px] text-ink-2">Nenhum ativo ainda.</p>
      <p className="mt-1 text-[13px] text-muted">Adicione saldos à mão ou por CSV. Exchanges e carteiras (OKX, Rabby/EVM, Bitcoin, Solana) entram nas próximas fases, em <Link href="/ajustes" className="text-accent">Integrações</Link>.</p>
    </Panel>
  );
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <label className="relative flex-1 min-w-[180px]"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <input value={qText} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ativo ou instituição" className="h-9 w-full rounded-md border border-line-strong bg-bg pr-3 pl-8 text-[16px] text-ink placeholder:text-placeholder focus:border-accent focus:outline-none md:text-[13px]" /></label>
        <select value={inst} onChange={(e) => setInst(e.target.value)} aria-label="Filtrar por instituição" className="h-9 rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none">
          <option value="all">Todas as instituições</option>{insts.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((a) => (
          <li key={a.econ} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[14px] font-medium", a.econ === "BTC" && "text-btc")}>{a.symbol}{a.econ.includes(":") ? " · não reconhecido" : ""}</span>
              <span className="num block truncate text-[11px] text-muted">{f.btc(a.qty, 6)} · {[...new Set(a.sources.map((s) => s.institution))].join(", ")}</span>
            </span>
            <span className="text-right">
              <span className="num block text-[14px]">{a.valueUsd != null ? f.money(a.valueUsd) : <span className="text-warn">sem preço</span>}</span>
              <span className="num block text-[11px]"><span className={toneCls(toneOf(a.change24h))}>{a.change24h != null ? f.pct(a.change24h) : ""}</span>{a.share != null ? <span className="text-muted"> · {f.pct(a.share, false)}</span> : ""}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead><tr className="border-b border-line text-left">
            {th("econ", "Ativo", false)}{th("qty", "Quantidade")}<th className="lbl px-3 py-2 text-right font-semibold">Preço</th>{th("value", "Valor")}
            <th className="lbl px-3 py-2 text-right font-semibold">Preço médio</th><th className="lbl px-3 py-2 text-right font-semibold">Custo</th>{th("pnl", "Lucro/Prejuízo")}{th("change", "24 h")}{th("share", "Part.")}<th className="lbl px-3 py-2 font-semibold">Custódia</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => {
              const isOpen = open.has(a.econ);
              const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(a.econ)) n.delete(a.econ); else n.add(a.econ); return n; });
              return (
                <Fragment key={a.econ}>
                  <tr className="cursor-pointer [@media(hover:hover)]:hover:bg-surface-2" onClick={toggle}>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2">{isOpen ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}<span className={cn("font-medium", a.econ === "BTC" && "text-btc")}>{a.symbol}</span>{a.econ.includes(":") && <Pill>não reconhecido</Pill>}</span></td>
                    <td className="num px-3 py-2.5 text-right">{f.btc(a.qty, 8)}</td>
                    <td className="num px-3 py-2.5 text-right text-ink-2">{a.priceUsd != null ? f.money(a.priceUsd) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right font-medium">{a.valueUsd != null ? f.money(a.valueUsd) : <span className="text-warn">sem preço</span>}</td>
                    <td className="num px-3 py-2.5 text-right text-ink-2">{a.avgCostUsd != null ? f.money(a.avgCostUsd) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right text-ink-2">{a.costUsd != null ? f.money(a.costUsd) : <span className="text-muted">desconhecido</span>}</td>
                    <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(a.pnlUsd)))}>{a.pnlUsd != null ? f.money(a.pnlUsd, { signed: true }) : "—"}</td>
                    <td className={cn("num px-3 py-2.5 text-right", toneCls(toneOf(a.change24h)))}>{a.change24h != null ? f.pct(a.change24h) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{a.share != null ? f.pct(a.share, false) : "—"}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{[...new Set(a.sources.map((s) => s.institution))].join(", ")}</td>
                  </tr>
                  {isOpen && a.sources.map((s) => (
                    <tr key={`${s.accountId}|${s.assetKey}`} className="bg-bg/60 text-[12px]">
                      <td className="px-3 py-2 pl-9"><span className="text-ink-2">{s.symbol}</span>{s.wrapped && <span className="ml-2"><Pill>representação</Pill></span>}{s.kind === "equity" && <span className="ml-2"><Pill tone="accent">patrimônio da conta</Pill></span>}</td>
                      <td className="num px-3 py-2 text-right">{f.btc(s.qty, 8)}</td>
                      <td className="num px-3 py-2 text-right text-muted">{s.locked ? `bloq. ${f.btc(s.locked, 6)}` : ""}</td>
                      <td className="num px-3 py-2 text-right">{s.valueUsd != null ? f.money(s.valueUsd) : "—"}</td>
                      <td colSpan={4} className="px-3 py-2 text-muted">{s.network}</td>
                      <td className="px-3 py-2 text-right">{s.source === "manual" && s.accountId !== "strategy" ? <button className="text-accent" onClick={(e) => { e.stopPropagation(); onEdit(`${s.accountId}|${s.assetKey}`, { institution: s.institution, name: s.symbol, symbol: s.symbol, qty: String(s.qty), network: s.network === "—" ? "" : s.network }); }}>editar</button> : <span className="text-muted">{s.source === "sync" ? "sincronizado" : "estratégia"}</span>}</td>
                      <td className="px-3 py-2 text-ink-2">{s.institution}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {v.positions.length > 0 && (
        <div className="border-t border-line">
          <PanelHead title="Posições em derivativos" right="não somadas ao patrimônio" className="border-b-0" />
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[12px]"><tbody className="divide-y divide-line">
            {v.positions.map((p) => (
              <tr key={`${p.accountId}${p.instrument}`}>
                <td className="px-3 py-2 font-medium">{p.instrument} <Pill tone={p.dir === "LONG" ? "btc" : "loss"}>{p.dir}</Pill></td>
                <td className="num px-3 py-2 text-right">{f.btc(p.size, 6)}</td>
                <td className="num px-3 py-2 text-right text-ink-2">entrada {p.entry != null ? f.px(p.entry) : "—"}</td>
                <td className="num px-3 py-2 text-right text-ink-2">nocional {p.notional != null ? f.money(p.notional, { compact: true }) : "—"}</td>
                <td className={cn("num px-3 py-2 text-right", toneCls(toneOf(p.upnl)))}>P&L {p.upnl != null ? f.money(p.upnl, { signed: true }) : "—"}</td>
                <td className="num px-3 py-2 text-right text-ink-2">liq. {p.liq != null ? f.px(p.liq) : "—"}</td>
                <td className="px-3 py-2 text-muted">{v.accounts.find((a) => a.id === p.accountId)?.institution}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}
    </Panel>
  );
}

function Accounts({ v }: { v: View }) {
  const f = useFmt();
  const val = new Map(v.c.byAccount.map((a) => [a.accountId, a]));
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line">
        {v.accounts.map((a) => {
          const x = val.get(a.id);
          return (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{a.name}</span><span className="mt-0.5 flex gap-1.5"><Pill tone={a.id === "strategy" ? "gold" : "neutral"}>{KIND_LABEL[a.kind] ?? a.kind}</Pill>{a.network && <span className="text-[11px] text-muted">{a.network}</span>}</span></span>
              <span className="text-right"><span className="num block text-[14px] font-medium">{x ? f.money(x.valueUsd) : "—"}</span><span className="num block text-[11px] text-muted">{x ? f.pct(x.share, false) : ""}</span></span>
            </li>
          );
        })}
      </ul>
      {v.accounts.length === 0 && <p className="px-4 py-6 text-[13px] text-muted">Nenhuma conta ainda.</p>}
    </Panel>
  );
}

const PALETTE = [C.btc, C.accent, C.gold, "#7f8cff", "#36c995", "#e879a8", "#5fb4f0", "#c9a0ff", "#91a2b8"];
function BarList({ title, rows }: { title: string; rows: { key: string; valueUsd: number; share: number }[] }) {
  const f = useFmt();
  return (
    <Panel className="overflow-hidden">
      <PanelHead title={title} />
      {rows.length ? (
        <div className="px-4 py-3">
          <div className="flex h-2 gap-px overflow-hidden rounded-[2px] bg-surface-3">{rows.map((r, i) => <span key={r.key} style={{ width: `${r.share * 100}%`, background: PALETTE[i % PALETTE.length] }} />)}</div>
          <ul className="mt-3 space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-center gap-2 text-[12.5px]">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink-2">{r.key}</span>
                <span className="num text-ink-2">{f.money(r.valueUsd)}</span><span className="num w-14 text-right text-muted">{f.pct(r.share, false)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="px-4 py-5 text-[13px] text-muted">Sem dados.</p>}
    </Panel>
  );
}
function Distribution({ v }: { v: View }) {
  const byAsset = v.c.assets.filter((a) => a.valueUsd != null).map((a) => ({ key: a.symbol, valueUsd: a.valueUsd!, share: a.share ?? 0 }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <BarList title="Por ativo" rows={byAsset} />
      <BarList title="Por instituição" rows={v.c.byInstitution} />
      <BarList title="Por rede" rows={v.c.byNetwork.map((x) => ({ ...x, key: x.key === "—" || !x.key ? "rede não informada" : x.key }))} />
      <Panel className="min-w-0 overflow-hidden lg:col-span-3">
        <PanelHead title="Bitcoin possuído por custódia" right="spot e representações; perpétuo não conta" />
        <BtcHeld v={v} />
      </Panel>
    </div>
  );
}
function BtcHeld({ v }: { v: View }) {
  const f = useFmt();
  if (!v.c.btcHeld.total) return <p className="px-4 py-5 text-[13px] text-muted">Nenhum BTC spot registrado.</p>;
  return <ul className="divide-y divide-line">{v.c.btcHeld.byInstitution.map((x) => <li key={x.key} className="flex justify-between px-4 py-2.5 text-[13px]"><span className="text-ink-2">{x.key}</span><span className="num">{f.btc(x.qty, 8)} BTC</span></li>)}
    <li className="flex justify-between px-4 py-2.5 text-[13px] font-semibold"><span>Total</span><span className="num">{f.btc(v.c.btcHeld.total, 8)} BTC</span></li></ul>;
}

function Evolution({ v }: { v: View }) {
  const f = useFmt();
  const { hidden } = { hidden: f.hidden };
  const pts = v.series.map((p) => ({ ts: p.t / 1000, value: p.valueUsd * f.fx, result: p.resultUsd * f.fx }));
  if (pts.length < 2) return <Panel className="p-6"><p className="text-[14px] text-ink-2">A evolução aparece a partir do segundo retrato.</p><p className="mt-1 text-[13px] text-muted">O app guarda um retrato do portfólio por hora enquanto está aberto. Com o gateway (Fase 4b), os retratos passam a ser feitos também com o app fechado.</p></Panel>;
  const fmt = (x: number) => (hidden ? "•••" : fmtMoney(x, f.ccy, { compact: true }).replace(/^R\$\s?|^US\$\s?/, ""));
  return (
    <Panel className="overflow-hidden">
      <PanelHead title="Evolução patrimonial" right="valor total e resultado sem aportes" />
      <div className="px-1 pt-3 pb-2">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={pts} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
            <defs><linearGradient id="pv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.18} /><stop offset="100%" stopColor={C.accent} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(t) => new Date(t * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} minTickGap={48} />
            <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-strong)", borderRadius: 6, fontSize: 12 }} labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleString("pt-BR")} formatter={(x, n) => [hidden ? "•••" : fmtMoney(Number(x ?? 0), f.ccy), n === "value" ? "Patrimônio" : "Resultado"]} />
            <Area type="linear" dataKey="value" stroke={C.accent} fill="url(#pv)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function Moves({ v, onAdd }: { v: View; onAdd: () => void }) {
  const f = useFmt();
  const rows = [...v.classified].sort((a, b) => b.t - a.t);
  const CLS: Record<string, { t: string; tone: "neutral" | "accent" | "gold" | "loss" | "gain" }> = { external: { t: "aporte/retirada", tone: "gold" }, internal: { t: "interna", tone: "neutral" }, pending: { t: "pendente", tone: "loss" }, result: { t: "resultado", tone: "accent" } };
  return (
    <Panel className="overflow-hidden">
      <PanelHead title="Movimentações" right={<Button size="sm" variant="ghost" onClick={onAdd}><Plus className="size-4" />Aporte ou retirada</Button>} />
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="num w-[92px] shrink-0 text-[11px] text-muted">{new Date(e.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="min-w-0 flex-1"><span className="block">{e.note ?? e.kind}</span><span className="block text-[11px] text-muted">{v.accounts.find((a) => a.id === e.accountId)?.name} · {e.reason}</span></span>
              <Pill tone={CLS[e.cls]!.tone}>{CLS[e.cls]!.t}</Pill>
              <span className="num w-28 text-right">{e.usd != null ? f.money(e.usd, { signed: true }) : `${e.qty} ${e.econ}`}</span>
              {e.cls === "pending" && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => resolvePending(e.id, "internal")}>É interna</Button><Button size="sm" variant="ghost" onClick={() => resolvePending(e.id, e.kind === "transfer_in" ? "deposit" : "withdraw")}>É externa</Button></span>}
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-6 text-[13px] text-muted">Nenhuma movimentação registrada. Aportes e retiradas da Estratégia são contados na conta dela automaticamente.</p>}
    </Panel>
  );
}

function HoldingSheet({ edit, onClose }: { edit?: { key: string; init: ManualInput }; onClose: () => void }) {
  const [m, setM] = useState<ManualInput>(edit?.init ?? { institution: "", name: "", symbol: "", qty: "", network: "", date: new Date().toISOString().slice(0, 10), costUsd: "", note: "", cgId: "", manualPrice: "" });
  const set = (k: keyof ManualInput) => (e: { target: { value: string } }) => setM((x) => ({ ...x, [k]: e.target.value }));
  const num = (s?: string) => (s ?? "").replace(/\s/g, "").replace(",", ".");
  const save = async () => {
    if (!m.symbol.trim()) return toast("Informe o símbolo do ativo.", "loss");
    if (!(Number(num(m.qty)) >= 0) || m.qty === "") return toast("Quantidade inválida.", "loss");
    await saveManualHolding({ ...m, qty: num(m.qty), costUsd: num(m.costUsd) || undefined, manualPrice: num(m.manualPrice) || undefined });
    toast(edit ? "Saldo atualizado." : "Ativo adicionado ao portfólio.", "gain"); onClose();
  };
  const remove = async () => { if (!edit || !window.confirm("Remover este saldo manual do portfólio?")) return; await removeManualHolding(edit.key); toast("Saldo removido.", "gain"); onClose(); };
  return (
    <Sheet title={edit ? "Editar saldo manual" : "Adicionar ativo (manual)"} onClose={onClose}
      footer={<div className="flex gap-2">{edit && <Button variant="danger" onClick={remove}>Remover</Button>}<Button variant="primary" className="flex-1" onClick={save}>Salvar</Button></div>}>
      <div className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Símbolo" placeholder="BTC, ETH, SOL…" value={m.symbol} onChange={set("symbol")} />
        <Field label="Nome" placeholder="opcional" value={m.name} onChange={set("name")} />
        <Field label="Quantidade" inputMode="decimal" value={m.qty} onChange={set("qty")} />
        <Field label="Instituição / custódia" placeholder="ex.: Ledger, Binance" value={m.institution} onChange={set("institution")} />
        <Field label="Rede" placeholder="opcional" value={m.network} onChange={set("network")} />
        <Field label="Data de referência" type="date" value={m.date} onChange={set("date")} />
        <Field label="Custo total (US$)" inputMode="decimal" placeholder="opcional" value={m.costUsd} onChange={set("costUsd")} hint="Em branco = custo desconhecido (não é zero)." />
        <Field label="Id CoinGecko" placeholder="só para ativos fora da lista" value={m.cgId} onChange={set("cgId")} />
        <Field label="Preço manual (US$)" inputMode="decimal" placeholder="se não houver cotação" value={m.manualPrice} onChange={set("manualPrice")} />
        <Field label="Observações" value={m.note} onChange={set("note")} />
      </div>
      <p className="pb-2 text-[11px] text-muted">Saldos manuais aparecem como “manual” e nunca são misturados aos sincronizados. Cadastrar um saldo é ajuste de cadastro: não conta como lucro.</p>
    </Sheet>
  );
}

function CsvSheet({ onClose }: { onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseHoldingsCsv(text) : null), [text]);
  const run = async () => { if (!parsed?.rows.length) return; await importHoldingsCsv(parsed.rows); toast(`${parsed.rows.length} saldo(s) importado(s).`, "gain"); onClose(); };
  const example = "instituicao;ativo;quantidade;rede;custo_usd;observacao\nLedger;BTC;0,25;bitcoin;15000;cold wallet\nBinance;ETH;1,5;;;";
  const dl = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + example], { type: "text/csv" })); a.download = "modelo-portfolio.csv"; a.click(); };
  return (
    <Sheet title="Importar saldos (CSV)" onClose={onClose} footer={<Button variant="primary" className="w-full" disabled={!parsed?.rows.length} onClick={run}>Importar {parsed?.rows.length ? `${parsed.rows.length} linha(s)` : ""}</Button>}>
      <p className="text-[13px] leading-relaxed text-ink-2">Colunas: <span className="num">instituicao; ativo; quantidade</span> (obrigatórias) e, opcionais, <span className="num">nome; rede; data; custo_usd; observacao</span>. Separador ; ou ,.</p>
      <div className="mt-3 flex gap-2">
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setText(await fl.text()); e.target.value = ""; }} />
        <Button size="sm" onClick={() => file.current?.click()}><Upload className="size-4" />Escolher arquivo</Button>
        <Button size="sm" variant="ghost" onClick={dl}><Download className="size-4" />Modelo</Button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={example} className="num mt-3 w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[13px] text-ink placeholder:text-placeholder focus:border-accent focus:outline-none" />
      {parsed && <p className="mt-2 text-[12px] text-muted">{parsed.rows.length} linha(s) válida(s){parsed.errors.length ? ` · ${parsed.errors.length} com erro` : ""}.</p>}
      {parsed?.errors.slice(0, 5).map((e) => <p key={e} className="text-[12px] text-loss">{e}</p>)}
    </Sheet>
  );
}

function FlowSheet({ accounts, onClose }: { accounts: { id: string; name: string }[]; onClose: () => void }) {
  const [acc, setAcc] = useState(accounts[0]?.id ?? "");
  const [kind, setKind] = useState<"deposit" | "withdraw">("deposit");
  const [usd, setUsd] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const save = async () => {
    const v = Number(usd.replace(",", "."));
    if (!acc) return toast("Cadastre uma conta antes (adicione um ativo).", "loss");
    if (!(v > 0)) return toast("Valor inválido.", "loss");
    await addManualFlow(acc, kind, v, new Date(date).getTime(), kind === "deposit" ? "aporte manual" : "retirada manual");
    toast("Movimentação registrada.", "gain"); onClose();
  };
  return (
    <Sheet title="Aporte ou retirada" onClose={onClose} footer={<Button variant="primary" className="w-full" onClick={save}>Registrar</Button>}>
      <div className="space-y-3 pb-2">
        <Segmented full value={kind} onChange={setKind} options={[{ value: "deposit", label: "Aporte" }, { value: "withdraw", label: "Retirada" }]} />
        <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-muted">Conta</span>
          <select value={acc} onChange={(e) => setAcc(e.target.value)} className="h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-ink focus:border-accent focus:outline-none">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <Field label="Valor (US$)" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
        <Field label="Data e hora" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="text-[11px] text-muted">Aportes e retiradas da Estratégia BTC/USDC já são contados automaticamente. Use isto para dinheiro que entrou ou saiu das outras contas.</p>
      </div>
    </Sheet>
  );
}
