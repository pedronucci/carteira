"use client";
/**
 * Trading Journal inteligente: operações dos perpétuos da Hyperliquid agrupadas automaticamente (entrada → aumentos →
 * reduções → fechamento), com anotações, calendário, estatísticas e padrões. Compartilha o MESMO registro financeiro e os
 * mesmos ids do Portfolio Attribution. O registro manual antigo continua na aba "Registro manual".
 */
import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, ListChecks, NotebookPen, PieChart, RefreshCw } from "lucide-react";
import { Area, Bar, BarChart, Cell, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFmt } from "@/lib/state";
import { navigate } from "@/lib/router";
import { portfolio, updatePortfolio } from "@/lib/portfolio/db";
import { useDataVersion } from "@/lib/api";
import { useAttrData } from "@/lib/journal/use";
import { rangeOf, useUrlFilters } from "@/lib/journal/filters";
import { calendarDays, dayKey, equityCurve, filterJournal, findPatterns, journalMetrics } from "@/lib/journal/analytics";
import { STRAT_BTC, STRAT_OTHER, type JTrade } from "@/lib/journal/trades";
import { emptyNote, type TradeNote } from "@/lib/journal/types";
import { attribute, attributionHref, matchRec, tradeContribution } from "@/lib/attribution/engine";
import { fmtQty } from "@/lib/perps/chart-lines";
import { refreshAllExtras } from "@/lib/local/hl-extra";
import { hlState } from "@/lib/local/hl";
import { syncHlNow } from "@/app/providers";
import { FilterSelect, PeriodPicker } from "@/components/filter-bar";
import { CoinLogo } from "@/components/coin-logo";
import { Sheet } from "@/components/sheet";
import { C } from "@/components/charts";
import { toast } from "@/components/toaster";
import { Button, Kpi, KpiGrid, Notice, Panel, PanelHead, Pill, Row, Segmented, Skeleton, cn, toneCls, toneOf } from "@/components/ui";
import { DirBadge } from "@/app/perps/page";
import { ManualJournal } from "./manual";

type Tab = "ops" | "cal" | "stats" | "manual";
const dt = (t: number) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };
const pctS = (x: number | null, d = 0) => (x == null ? "—" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: d })}%`);

export default function JournalPage() {
  useDataVersion();
  const { f: flt, set, clear } = useUrlFilters();
  const { data, loading, error } = useAttrData();
  const fmt = useFmt();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const tab = (flt.tab as Tab) || "ops";
  const range = rangeOf(flt);

  const all = data?.trades ?? [];
  const perpOnly = flt.market === "spot" ? [] : all;
  const filtered = useMemo(() => filterJournal(perpOnly, { coin: flt.coin, acc: flt.acc, strategy: flt.strat, dir: flt.dir, result: flt.res, from: range.from, to: range.from == null && flt.p === "all" ? null : range.to, q: flt.q }), [perpOnly, flt, range.from, range.to]);
  const m = useMemo(() => journalMetrics(filtered), [filtered]);
  const sync = async () => { setBusy(true); try { if (hlState().address) await syncHlNow(true); await refreshAllExtras(true); toast("Operações sincronizadas."); } catch { toast("Não foi possível sincronizar agora."); } finally { setBusy(false); } };

  if (!data && loading) return <div className="space-y-4 pt-5"><Skeleton className="h-12" /><Skeleton className="h-64" /></div>;
  if (!data) return <div className="pt-5"><Notice tone="loss">{error ?? "Journal indisponível."}</Notice></div>;

  const coins = [...new Set(all.map((t) => t.coin))].sort();
  const strats = [...new Set([STRAT_BTC, STRAT_OTHER, ...all.map((t) => t.strategy)])];
  const accs = data.perps.accounts.map((a) => ({ value: a.id, label: a.name }));
  const sel = sheet ? all.find((t) => t.uid === sheet) ?? null : flt.trade && tab === "ops" ? all.find((t) => t.uid === flt.trade) ?? null : null;
  const hasFilter = Boolean(flt.coin || flt.acc || flt.strat || flt.dir || flt.res || flt.q || flt.p !== "all" || flt.market);

  const attr = attribute(data.ledger, { range, coin: flt.coin, accountId: flt.acc, strategy: flt.strat, market: "perp" });
  const fromAttribution = Boolean(flt.coin && (flt.from != null || flt.p !== "all"));

  return (
    <div className="space-y-4 pt-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[20px] font-semibold">Trading Journal</h1>
        <Pill>Hyperliquid · perpétuos</Pill>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={sync} loading={busy}><RefreshCw className="mr-1 size-4" />Sincronizar</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={(v) => set({ tab: v === "ops" ? null : v })} label="Seções" options={[
          { value: "ops", label: <span className="flex items-center gap-1.5"><ListChecks className="size-4" />Operações</span> },
          { value: "cal", label: <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />Calendário</span> },
          { value: "stats", label: <span className="flex items-center gap-1.5"><BarChart3 className="size-4" />Estatísticas</span> },
          { value: "manual", label: <span className="flex items-center gap-1.5"><NotebookPen className="size-4" />Registro manual</span> },
        ]} />
      </div>

      {tab === "manual" ? <ManualJournal /> : (
        <>
          <Panel className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <FilterSelect label="Ativo" value={flt.coin} onChange={(v) => set({ coin: v })} options={coins.map((c) => ({ value: c, label: c }))} />
              <FilterSelect label="Conta" value={flt.acc} onChange={(v) => set({ acc: v })} options={accs} />
              <FilterSelect label="Estratégia" value={flt.strat} onChange={(v) => set({ strat: v })} options={strats.map((s) => ({ value: s, label: s }))} />
              <FilterSelect label="Resultado" value={flt.res} onChange={(v) => set({ res: v as never })} options={[{ value: "win", label: "Ganhos" }, { value: "loss", label: "Perdas" }, { value: "open", label: "Abertas" }]} />
              <FilterSelect label="Direção" value={flt.dir} onChange={(v) => set({ dir: v as never })} options={[{ value: "LONG", label: "LONG" }, { value: "SHORT", label: "SHORT" }]} />
              <label className="flex flex-col gap-1 text-[11px] text-muted">Busca<input value={flt.q} onChange={(e) => set({ q: e.target.value })} placeholder="tese, nota, tag…" className="min-h-10 rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink" /></label>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <PeriodPicker p={flt.p} from={flt.p === "custom" ? flt.from : null} to={flt.p === "custom" ? flt.to : null} onPreset={(k) => set({ p: k })} onCustom={(a, b) => set({ p: "custom", from: a, to: b })} />
              {hasFilter && <Button size="sm" onClick={clear}>Limpar filtros</Button>}
            </div>
          </Panel>

          {flt.market === "spot" && <Notice tone="info">O Journal registra operações de perpétuos. Compras e vendas spot aparecem apenas no Attribution.</Notice>}
          {fromAttribution && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[13px]">
              <span>Operações de <b>{flt.coin}</b> {flt.p === "custom" ? "no período selecionado" : "no período"}: resultado no Attribution <b className={toneCls(toneOf(attr.total.net))}>{fmt.money(attr.total.net, { signed: true })}</b> ({m.total} operações)</span>
              <Button size="sm" onClick={() => navigate(attributionHref({ coin: flt.coin ?? undefined, acc: flt.acc, from: flt.from, to: flt.to, strategy: flt.strat }))}><PieChart className="mr-1 size-4" />Ver no Attribution</Button>
            </div>
          )}
          {!data.perps.connected && <Notice tone="info">Conecte uma conta Hyperliquid em Ajustes para importar as operações automaticamente.</Notice>}
          {data.perps.connected && !data.perps.historyComplete && <Notice tone="warn">Histórico da Hyperliquid incompleto: operações antigas podem faltar e algumas abertas aparecem com entrada herdada.</Notice>}

          {tab === "ops" && <OpsTab trades={filtered} m={m} onOpen={(uid) => setSheet(uid)} attrNet={attr.perp.net} fmt={fmt} />}
          {tab === "cal" && <CalTab data={data} flt={flt} range={range} trades={filtered} fmt={fmt} onDay={(from, to) => set({ p: "custom", from, to, tab: null })} />}
          {tab === "stats" && <StatsTab trades={filtered} m={m} fmt={fmt} />}
        </>
      )}
      {sel && <TradeSheet t={sel} data={data} range={range} fmt={fmt} onClose={() => { setSheet(null); if (flt.trade) set({ trade: null }); }} />}
    </div>
  );
}

type Fmt = ReturnType<typeof useFmt>;

function OpsTab({ trades, m, onOpen, attrNet, fmt }: { trades: JTrade[]; m: ReturnType<typeof journalMetrics>; onOpen: (uid: string) => void; attrNet: number; fmt: Fmt }) {
  const shown = trades.slice(0, 200);
  return (
    <>
      <KpiGrid>
        <Kpi label="Operações" value={String(m.total)} sub={`${m.closed} encerradas · ${m.open} abertas`} />
        <Kpi label="Resultado líquido" value={fmt.money(m.net, { signed: true })} tone={toneOf(m.net)} sub={`realizado ${fmt.money(m.realized, { signed: true })} · taxas ${fmt.money(-m.fees, { signed: true })} · funding ${fmt.money(m.funding, { signed: true })}`} />
        <Kpi label="Taxa de acerto" value={pctS(m.winRate)} sub={`${m.wins} ganhos · ${m.losses} perdas`} />
        <Kpi label="Fator de lucro" value={m.profitFactor != null ? m.profitFactor.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} sub={m.profitFactor == null ? "Dados insuficientes" : undefined} />
      </KpiGrid>
      <Panel>
        <PanelHead title="Operações" sub="Agrupadas automaticamente a partir das execuções reais (da posição zero até voltar a zero)" />
        <ul className="divide-y divide-line">
          {shown.map((t) => (
            <li key={t.uid}>
              <button onClick={() => onOpen(t.uid)} className="flex w-full items-center gap-3 px-4 py-3 text-left [@media(hover:hover)]:hover:bg-surface-2">
                <CoinLogo symbol={t.coin} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><b className="text-[14px]">{t.coin}</b><DirBadge dir={t.dir} />{t.open && <Pill tone="gold">Aberta</Pill>}{t.inherited && <Pill>entrada herdada</Pill>}</div>
                  <div className="truncate text-[11.5px] text-muted">{dt(t.openedAt)} · {dur(t.durationMs)} · {t.strategy}{t.note?.rating ? ` · ${"★".repeat(t.note.rating)}` : ""}</div>
                </div>
                <div className="num text-right">
                  <div className={cn("text-[14px] font-semibold", toneCls(toneOf(t.netPnl)))}>{fmt.money(t.netPnl, { signed: true })}</div>
                  <div className="text-[11px] text-muted">{t.avgEntry != null ? fmt.px(t.avgEntry) : "—"} → {t.avgExit != null ? fmt.px(t.avgExit) : t.open ? "aberta" : "—"}</div>
                </div>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-4 py-6 text-center text-[13px] text-muted">Nenhuma operação neste recorte.</li>}
        </ul>
        {trades.length > shown.length && <p className="px-4 pb-3 text-[12px] text-muted">Mostrando as {shown.length} mais recentes de {trades.length}. Use os filtros para refinar.</p>}
        <p className="border-t border-line px-4 py-3 text-[11.5px] text-muted">Conferência com o Attribution (perpétuos, mesmo recorte): {fmt.money(attrNet, { signed: true })}. O Attribution soma os eventos financeiros que caem no período; o Journal soma operações inteiras que tocam o período. Funding sem operação associada só aparece no Attribution. O P&L não realizado das abertas não entra no resultado realizado.</p>
      </Panel>
    </>
  );
}

function TradeSheet({ t, data, range, fmt, onClose }: { t: JTrade; data: NonNullable<ReturnType<typeof useAttrData>["data"]>; range: ReturnType<typeof rangeOf>; fmt: Fmt; onClose: () => void }) {
  const saved = portfolio().tradeNotes?.[t.uid] ?? null;
  const [n, setN] = useState<TradeNote>(() => saved ?? emptyNote(t.uid));
  const [stop, setStop] = useState(n.plannedStop != null ? String(n.plannedStop) : "");
  const [tps, setTps] = useState(n.plannedTps.join(", "));
  const [tags, setTags] = useState(n.tags.join(", "));
  const c = tradeContribution(data.ledger, t.uid, t.coin, { range });
  const call = tradeContribution(data.ledger, t.uid, t.coin, { range: { from: null, to: Date.now() } });
  const toN = (s: string) => { const x = Number(s.replace(",", ".")); return s.trim() && Number.isFinite(x) && x > 0 ? x : null; };
  const save = () => {
    const note: TradeNote = { ...n, strategy: n.strategy.trim(), plannedStop: toN(stop), plannedTps: tps.split(/[;,\s]+/).map(toN).filter((x): x is number => x != null), tags: tags.split(",").map((x) => x.trim()).filter(Boolean), updatedAt: Date.now() };
    void updatePortfolio((d) => { d.tradeNotes = { ...(d.tradeNotes ?? {}), [t.uid]: note }; });
    toast("Anotação salva.");
  };
  return (
    <Sheet title={`${t.coin} · ${t.dir}`} onClose={onClose} footer={<div className="flex gap-2"><Button variant="primary" className="flex-1" onClick={save}>Salvar anotação</Button></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(`/posicao?acc=${encodeURIComponent(t.accountId)}&coin=${encodeURIComponent(t.coin)}&trade=${encodeURIComponent(t.uid)}`)}>Ver gráfico</Button>
          <Button size="sm" onClick={() => navigate(attributionHref({ coin: t.coin, acc: t.accountId, from: t.openedAt, to: t.closedAt }))}><PieChart className="mr-1 size-4" />Ver no Attribution</Button>
        </div>
        <div>
          <Row label="Conta">{t.accountName}</Row>
          <Row label="Abertura">{dt(t.openedAt)}</Row>
          <Row label="Encerramento">{t.closedAt ? dt(t.closedAt) : "Em aberto"}</Row>
          <Row label="Duração">{dur(t.durationMs)}</Row>
          <Row label="Entrada média">{t.avgEntry != null ? fmt.px(t.avgEntry) : "Dados insuficientes"}</Row>
          <Row label="Saída média">{t.avgExit != null ? fmt.px(t.avgExit) : "—"}</Row>
          <Row label="Tamanho máximo"><span className="num">{fmtQty(t.maxSize)} {t.coin}</span></Row>
          <Row label="Realizado" tone={toneOf(t.realizedPnl)}>{fmt.money(t.realizedPnl, { signed: true })}</Row>
          <Row label="Taxas">{fmt.money(-t.fees, { signed: true })}</Row>
          <Row label="Funding" tone={toneOf(t.funding)}>{fmt.money(t.funding, { signed: true })}</Row>
          <Row label="Resultado líquido" tone={toneOf(t.netPnl)}><b>{fmt.money(t.netPnl, { signed: true })}</b></Row>
        </div>
        {t.inherited && <Notice tone="warn">O histórico já começa com a posição aberta: entrada e parte das execuções são desconhecidas.</Notice>}
        <div>
          <h3 className="mb-1 text-[13px] font-semibold">Contribuição para o portfólio</h3>
          <Row label="No período selecionado" tone={toneOf(c.net)}>{c.inRange ? fmt.money(c.net, { signed: true }) : "Fora do período"}</Row>
          <Row label={`Parcela do resultado de ${t.coin}`}>{pctS(call.shareOfAsset)}</Row>
          <Row label="Parcela do resultado total">{pctS(call.shareOfTotal)}</Row>
          {t.open && <p className="mt-1 text-[11.5px] text-muted">Aberta: o P&L não realizado não entra aqui.</p>}
        </div>
        <div>
          <h3 className="mb-1 text-[13px] font-semibold">Execuções</h3>
          <ul className="divide-y divide-line text-[13px]">
            {t.execs.map((e) => (
              <li key={e.fill.key} className="flex items-center justify-between py-2"><span>{e.label}<span className="block text-[11px] text-muted">{dt(e.fill.time)}</span></span><span className="num text-right">{fmt.px(e.fill.px)}<span className="block text-[11px] text-muted">{fmtQty(e.fill.sz)}{e.fill.closedPnl ? ` · ${fmt.money(e.fill.closedPnl, { signed: true })}` : ""}</span></span></li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold">Anotações</h3>
          <label className="block text-[11px] text-muted">Estratégia<input list="strats" value={n.strategy} onChange={(e) => setN({ ...n, strategy: e.target.value })} placeholder={t.strategy} className="mt-1 min-h-10 w-full rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink" /><datalist id="strats"><option value={STRAT_BTC} /><option value={STRAT_OTHER} /></datalist></label>
          <label className="block text-[11px] text-muted">Tese<textarea value={n.thesis} onChange={(e) => setN({ ...n, thesis: e.target.value })} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[13px] text-ink" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-muted">Stop planejado<input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className="num mt-1 min-h-10 w-full rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink" /></label>
            <label className="block text-[11px] text-muted">Take profit (vários, vírgula)<input value={tps} onChange={(e) => setTps(e.target.value)} className="num mt-1 min-h-10 w-full rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink" /></label>
          </div>
          <label className="block text-[11px] text-muted">Notas<textarea value={n.notes} onChange={(e) => setN({ ...n, notes: e.target.value })} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[13px] text-ink" /></label>
          <label className="block text-[11px] text-muted">Tags (vírgula)<input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink" /></label>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Nota pessoal">
            <span className="mr-2 text-[11px] text-muted">Nota pessoal</span>
            {[1, 2, 3, 4, 5].map((i) => <button key={i} role="radio" aria-checked={n.rating === i} onClick={() => setN({ ...n, rating: n.rating === i ? null : i })} className={cn("grid size-9 place-items-center text-[20px]", (n.rating ?? 0) >= i ? "text-gold" : "text-muted/50")} aria-label={`${i} estrelas`}>★</button>)}
          </div>
          <p className="text-[11px] text-muted">Stop e TP planejados são anotações suas, nunca ordens na exchange.</p>
        </div>
      </div>
    </Sheet>
  );
}

function CalTab({ data, flt, range, trades, fmt, onDay }: { data: NonNullable<ReturnType<typeof useAttrData>["data"]>; flt: ReturnType<typeof useUrlFilters>["f"]; range: ReturnType<typeof rangeOf>; trades: JTrade[]; fmt: Fmt; onDay: (from: number, to: number) => void }) {
  const [ref, setRef] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const recs = useMemo(() => data.ledger.recs.filter((r) => matchRec(r, { range: { from: null, to: Date.now() }, coin: flt.coin, accountId: flt.acc, strategy: flt.strat, market: "perp" })), [data, flt.coin, flt.acc, flt.strat]);
  const days = useMemo(() => calendarDays(recs, trades), [recs, trades]);
  const y = ref.getFullYear(), mo = ref.getMonth();
  const first = new Date(y, mo, 1).getDay(), n = new Date(y, mo + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  const monthNet = [...days.values()].filter((c) => c.key.startsWith(`${y}-${String(mo + 1).padStart(2, "0")}`)).reduce((a, c) => a + c.net, 0);
  const maxAbs = Math.max(1, ...cells.filter((x): x is number => x != null).map((d) => Math.abs(days.get(dayKey(new Date(y, mo, d).getTime()))?.net ?? 0)));
  void range;
  return (
    <Panel>
      <div className="flex items-center justify-between px-4 py-3">
        <button aria-label="Mês anterior" onClick={() => setRef(new Date(y, mo - 1, 1))} className="grid size-10 place-items-center text-muted"><ChevronLeft className="size-5" /></button>
        <div className="text-center"><div className="text-[15px] font-semibold capitalize">{ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</div><div className={cn("num text-[12px]", toneCls(toneOf(monthNet)))}>{fmt.money(monthNet, { signed: true })} no mês</div></div>
        <button aria-label="Próximo mês" onClick={() => setRef(new Date(y, mo + 1, 1))} className="grid size-10 place-items-center text-muted"><ChevronRight className="size-5" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 px-3 pb-1 text-center text-[10.5px] text-muted">{["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1 px-3 pb-4">
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const ts = new Date(y, mo, d).getTime(), c = days.get(dayKey(ts));
          const a = c ? Math.min(1, Math.abs(c.net) / maxAbs) : 0;
          return (
            <button key={i} disabled={!c} onClick={() => onDay(ts, ts + 86400e3 - 1)} aria-label={`${d}: ${c ? fmt.money(c.net, { signed: true }) : "sem operações"}`}
              style={c && Math.abs(c.net) > 0 ? { backgroundColor: `color-mix(in srgb, ${c.net >= 0 ? "var(--color-gain)" : "var(--color-loss)"} ${Math.round(18 + a * 45)}%, transparent)` } : undefined}
              className={cn("flex aspect-square min-h-11 flex-col items-center justify-center rounded-md border border-line text-[11px]", !c && "opacity-50")}>
              <span className="text-muted">{d}</span>{c && <span className="num text-[10px] font-semibold leading-tight">{Math.abs(c.net) >= 1000 ? `${(c.net / 1000).toFixed(1)}k` : Math.round(c.net)}</span>}
            </button>
          );
        })}
      </div>
      <p className="border-t border-line px-4 py-3 text-[11.5px] text-muted">Resultado do dia = realizado − taxas + funding dos perpétuos (mesmos eventos do Attribution). Toque em um dia para filtrar as operações.</p>
    </Panel>
  );
}

function StatsTab({ trades, m, fmt }: { trades: JTrade[]; m: ReturnType<typeof journalMetrics>; fmt: Fmt }) {
  const curve = useMemo(() => equityCurve(trades).map((p) => ({ ...p, neg: -p.dd })), [trades]);
  const byCoin = useMemo(() => { const o = new Map<string, number>(); for (const t of trades) o.set(t.coin, (o.get(t.coin) ?? 0) + t.netPnl); return [...o.entries()].map(([coin, net]) => ({ coin, net })).sort((a, b) => b.net - a.net); }, [trades]);
  const patterns = useMemo(() => findPatterns(trades), [trades]);
  const few = m.closed < 4;
  return (
    <>
      <KpiGrid>
        <Kpi label="Taxa de acerto" value={pctS(m.winRate)} sub={`${m.wins} ganhos · ${m.losses} perdas`} />
        <Kpi label="Fator de lucro" value={m.profitFactor != null ? m.profitFactor.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} />
        <Kpi label="Ganho médio" value={m.avgWin != null ? fmt.money(m.avgWin) : "—"} tone="gain" />
        <Kpi label="Perda média" value={m.avgLoss != null ? fmt.money(-m.avgLoss) : "—"} tone="loss" />
        <Kpi label="Expectativa por operação" value={m.expectancy != null ? fmt.money(m.expectancy, { signed: true }) : "—"} tone={toneOf(m.expectancy)} />
        <Kpi label="Drawdown máximo" value={fmt.money(-m.maxDrawdown)} sub="sobre o resultado acumulado" tone={m.maxDrawdown > 0 ? "loss" : null} />
        <Kpi label="Payoff" value={m.payoff != null ? m.payoff.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} sub="ganho médio ÷ perda média" />
        <Kpi label="Sequências" value={`${m.maxWinStreak} / ${m.maxLossStreak}`} sub="maior de ganhos / perdas" />
      </KpiGrid>
      {few && <Notice tone="info">Dados insuficientes: poucas operações encerradas neste recorte. As estatísticas ficam mais confiáveis com mais operações.</Notice>}
      <Panel>
        <PanelHead title="Resultado acumulado e drawdown" sub="Operações encerradas, na data de fechamento" />
        <div className="h-64 px-2 pb-3">
          {curve.length ? (
            <ResponsiveContainer>
              <ComposedChart data={curve} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `${Math.round(v)}`} />
                <ReferenceLine y={0} stroke="var(--chart-line)" />
                <Tooltip contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-strong)", borderRadius: 8, fontSize: 12 }} labelFormatter={(t) => new Date(Number(t)).toLocaleString("pt-BR")} formatter={(v, name) => [fmt.money(Number(v), { signed: name === "Acumulado" }), name as string]} />
                <Area dataKey="neg" name="Drawdown" type="monotone" stroke="none" fill={C.loss} fillOpacity={0.18} isAnimationActive={false} />
                <Line dataKey="cum" name="Acumulado" type="monotone" stroke={C.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <p className="px-3 py-10 text-center text-[13px] text-muted">Sem operações encerradas.</p>}
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Resultado por ativo" />
        <div className="h-56 px-2 pb-3">
          {byCoin.length ? (
            <ResponsiveContainer>
              <BarChart data={byCoin} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="coin" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} width={52} />
                <ReferenceLine y={0} stroke="var(--chart-line)" />
                <Tooltip contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-strong)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt.money(Number(v), { signed: true }), "Resultado"]} />
                <Bar dataKey="net" radius={[3, 3, 0, 0]} isAnimationActive={false}>{byCoin.map((d) => <Cell key={d.coin} fill={d.net >= 0 ? C.gain : C.loss} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Padrões recorrentes" sub="Só aparecem com pelo menos 4 operações no grupo. São observações, não conclusões." />
        <ul className="divide-y divide-line">
          {patterns.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
              <Pill tone={p.tone === "gain" ? "gain" : p.tone === "loss" ? "loss" : "neutral"}>{p.dimension}</Pill>
              <span className="flex-1">{p.text}</span>
            </li>
          ))}
          {!patterns.length && <li className="px-4 py-6 text-center text-[13px] text-muted">Dados insuficientes para identificar padrões.</li>}
        </ul>
      </Panel>
    </>
  );
}
