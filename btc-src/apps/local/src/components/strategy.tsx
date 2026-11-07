"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, History, Layers, Plus, RefreshCw } from "lucide-react";
import { fmtMoney } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { backupNow, getStore, localTz, uid, updateStore } from "@/lib/local/store";
import { activeStrategy, account, compute, resolveScope } from "@/lib/local/engine";
import { buildSnapshot, type SnapResult } from "@/lib/local/snapshot";
import { localIso } from "@/lib/local/hl";
import { fmtZoned, utcToZoned, zonedToUtc, type StartSnapshot, type StrategyCycle } from "@/lib/local/strategy";
import { prices } from "@/lib/local/prices";
import { useFmt } from "@/lib/state";
import { Button, Field, Notice, Segmented, cn, toneCls } from "./ui";
import { Sheet } from "./sheet";
import { toast } from "./toaster";
import { num } from "./forms";

const TZS = ["America/Sao_Paulo", "UTC", "America/New_York", "Europe/Lisbon", "Europe/London", "Asia/Tokyo"];
const SRC_LABEL: Record<StartSnapshot["source"], string> = { live: "Oficial ao vivo", reconstructed: "Reconstruído", manual: "Referência manual" };
const shortDate = (ms: number, tz: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(ms));

/** Resultado resumido de um ciclo (para listas). */
function cycleResult(id: string): { result: number; pct: number | null } | null {
  try { const r = compute(id); return { result: r.result, pct: r.twr }; } catch { return null; }
}

export function ScopeButton() {
  useDataVersion();
  const [open, setOpen] = useState(false);
  const s = getStore();
  const sc = resolveScope(s);
  const text = !sc ? "Configurar ciclo" : sc.kind === "account" ? "Histórico completo da conta" : `${sc.strategy.name}${sc.active ? "" : " · encerrado"}`;
  const sub = sc?.kind === "strategy" ? `desde ${shortDate(sc.strategy.startAt, sc.strategy.tz)}` : null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-left text-[13px] [@media(hover:hover)]:hover:border-line-strong">
        <Layers className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="truncate font-semibold">{text}</span>
        {sub && <span className="shrink-0 text-muted">{sub}</span>}
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && <ScopeSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ScopeSheet({ onClose }: { onClose: () => void }) {
  const f = useFmt();
  const s = getStore();
  const active = activeStrategy(s);
  const closed = s.strategies.filter((x) => x.status === "closed" && !x.archived).sort((a, b) => b.startAt - a.startAt);
  const [form, setForm] = useState<null | "new" | "edit">(null);
  const results = useMemo(() => Object.fromEntries(s.strategies.map((x) => [x.id, cycleResult(x.id)])), [s.strategies]);
  const pick = (view: string) => { updateStore((x) => { x.view = view; }); onClose(); };
  const cur = s.view;
  if (form) return <StrategySheet mode={form} edit={form === "edit" ? active ?? undefined : undefined} onClose={onClose} />;
  const Item = ({ id, title, sub, res }: { id: string; title: string; sub: string; res?: { result: number; pct: number | null } | null }) => (
    <button onClick={() => pick(id)} className={cn("flex w-full items-center gap-3 rounded-lg border px-4 py-3.5 text-left", (cur === id || (id === "active" && cur === active?.id)) ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
      <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{title}</span><span className="block text-[13px] text-muted">{sub}</span></span>
      {res && <span className={cn("num shrink-0 text-right text-[14px] font-semibold", toneCls(res.result > 0 ? "gain" : res.result < 0 ? "loss" : null))}>{f.money(res.result, { signed: true, compact: true })}{res.pct != null && <span className="block text-[12px] font-normal">{f.pct(res.pct)}</span>}</span>}
    </button>
  );
  return (
    <Sheet title="O que acompanhar" onClose={onClose}>
      <div className="space-y-5 pb-2">
        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Ciclo atual</p>
          {active ? <Item id="active" title={active.name} sub={`desde ${fmtZoned(active.startAt, active.tz)} · ${active.snapshot ? SRC_LABEL[active.snapshot.source] : "sem patrimônio inicial"}`} res={results[active.id]} />
            : <p className="rounded-lg border border-dashed border-line px-4 py-4 text-[14px] text-muted">Nenhum ciclo em andamento.</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {active && <Button onClick={() => setForm("edit")}>Editar ciclo</Button>}
            <Button variant={active ? "secondary" : "primary"} className={active ? "" : "col-span-2"} onClick={() => setForm("new")}><Plus className="size-4" />Novo ciclo</Button>
          </div>
        </div>
        {closed.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Ciclos anteriores</p>
            <div className="space-y-2">{closed.map((c) => <Item key={c.id} id={c.id} title={c.name} sub={`${shortDate(c.startAt, c.tz)} → ${c.endAt ? shortDate(c.endAt, c.tz) : "—"}`} res={results[c.id]} />)}</div>
          </div>
        )}
        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Consolidado</p>
          <Item id="account" title="Histórico completo da conta" sub="Todas as operações, sem separar por ciclo" />
        </div>
      </div>
    </Sheet>
  );
}

/** Formulário do ciclo: nome, início (data, hora, fuso) e patrimônio inicial (oficial, reconstruído ou manual). */
export function StrategyForm({ mode, edit, onDone }: { mode: "new" | "edit"; edit?: StrategyCycle; onDone: () => void }) {
  useDataVersion();
  const f = useFmt();
  const s = getStore();
  const acc = account(s);
  const active = activeStrategy(s);
  const tz0 = edit?.tz ?? localTz();
  const start0 = edit ? utcToZoned(edit.startAt, tz0) : utcToZoned(Date.now(), tz0);
  const [name, setName] = useState(edit?.name ?? (s.strategies.length ? `Ciclo ${s.strategies.length + 1}` : "Estratégia BTC ↔ USDC"));
  const [date, setDate] = useState(start0.date);
  const [time, setTime] = useState(start0.time);
  const [tz, setTz] = useState(tz0);
  // o retrato de um ciclo existente fica travado: só é recalculado se o início mudar ou se o usuário pedir
  const [res, setRes] = useState<SnapResult | null>(edit?.snapshot ? { snap: edit.snapshot, missing: [], detail: ["Retrato guardado no início do ciclo. Ele só muda se você alterar o início ou tocar em Recalcular."] } : null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManualS] = useState(edit?.snapshot?.source === "manual");
  const [userManual, setUserManual] = useState(edit?.snapshot?.source === "manual");
  const setManual = (v: boolean, byUser = false) => { setManualS(v); if (byUser) setUserManual(v); };
  const [mEq, setMEq] = useState(edit?.snapshot?.equityUsd ?? "");
  const [mSize, setMSize] = useState(edit?.snapshot?.positions.find((p) => p.coin === "BTC")?.size ?? "");
  const [mPx, setMPx] = useState(edit?.snapshot?.btcUsd ?? (prices().spot?.btcUsd ? String(Math.round(prices().spot!.btcUsd!)) : ""));
  const [arb, setArb] = useState("");
  const [startIn, setStartIn] = useState<"USDC" | "BTC">("USDC");
  const [entry, setEntry] = useState(mPx);
  const [lev, setLev] = useState(s.settings.defaultLeverage);
  const startAt = useMemo(() => { try { return zonedToUtc(date, time, tz); } catch { return NaN; } }, [date, time, tz]);
  const firstManual = acc.kind === "manual" && !acc.firstT;

  const locked = Boolean(edit?.snapshot) && !touched && startAt === edit?.startAt;
  const recalc = async () => {
    if (!Number.isFinite(startAt)) return;
    setTouched(true);
    setBusy(true);
    const r = await buildSnapshot(startAt, { arbUsd: arb ? Number(num(arb)) : undefined });
    setRes(r); setBusy(false);
    if (r.snap) { setMEq(r.snap.equityUsd); setMSize(r.snap.positions.find((p) => p.coin === "BTC")?.size ?? ""); setMPx(r.snap.btcUsd); if (!userManual) setManual(false); }
    else setManual(true);
  };
  useEffect(() => { if (!firstManual && !locked) { const id = setTimeout(recalc, 350); return () => clearTimeout(id); } return undefined; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [startAt, arb]);

  const save = () => {
    if (!Number.isFinite(startAt)) return toast("Data ou hora inválida.", "loss");
    if (startAt > Date.now() + 60e3) return toast("O início não pode estar no futuro.", "loss");
    if (mode === "new" && active && startAt <= active.startAt) return toast(`O novo ciclo precisa começar depois de ${fmtZoned(active.startAt, active.tz)} (início do ciclo atual).`, "loss");
    let snap: StartSnapshot | null = !manual && !firstManual ? res?.snap ?? null : null;
    if (manual || firstManual) {
      const eq = Number(num(mEq));
      if (!(eq >= 0) || mEq === "") return toast("Informe o patrimônio inicial em dólar.", "loss");
      const size = Number(num(mSize || "0")), px = Number(num(mPx || "0"));
      if (size > 0 && !(px > 0)) return toast("Informe o preço de referência do BTC no início.", "loss");
      snap = { at: startAt, source: "manual", equityUsd: String(eq), btcUsd: String(px || prices().spot?.btcUsd || 0), balances: [], positions: size > 0 ? [{ coin: "BTC", size: String(size), mark: String(px) }] : [], note: "Valores informados pelo usuário." };
    }
    if (!snap) return toast("Ainda não há patrimônio inicial. Aguarde o cálculo ou informe à mão.", "loss");
    const accounts: StrategyCycle["accounts"] = acc.kind === "hl" && s.settings.hl ? [{ kind: "hyperliquid", address: s.settings.hl.address, includeArb: s.settings.hl.includeArb }] : [{ kind: "manual" }];
    backupNow(mode === "edit" ? "antes de editar o ciclo" : "antes de iniciar um novo ciclo");
    updateStore((x) => {
      if (mode === "edit" && edit) {
        const c = x.strategies.find((y) => y.id === edit.id);
        if (!c) return;
        const prev = x.strategies.find((y) => y.endAt === c.startAt);
        if (prev) { prev.endAt = startAt; prev.endEquityUsd = snap!.equityUsd; }
        Object.assign(c, { name: name.trim() || c.name, startAt, tz, snapshot: snap, accounts });
      } else {
        const cur = x.strategies.find((y) => y.status === "active");
        if (cur) { cur.status = "closed"; cur.endAt = startAt; cur.endEquityUsd = snap!.equityUsd; }
        x.strategies.push({ id: "s-" + uid(), name: name.trim() || "Ciclo", startAt, tz, status: "active", accounts, snapshot: snap, createdAt: Date.now() });
      }
      x.view = "active";
      // primeiro ciclo manual: guarda também o ponto de partida da conta e, se começou em BTC, a entrada
      if (firstManual) {
        if (!x.initial) x.initial = { date: utcToZoned(startAt, tz).date, usdc: snap!.equityUsd };
        if (startIn === "BTC" && Number(num(entry)) > 0) x.cycles.push({ id: "init-" + uid(), openedAt: localIso(startAt), entryPx: num(entry), leverage: num(lev) || "1", capital: snap!.equityUsd, platform: "Hyperliquid" });
      }
    });
    toast(mode === "new" ? (active ? `“${active.name}” encerrado. Novo ciclo iniciado.` : "Ciclo da estratégia criado.") : "Ciclo atualizado.", "gain");
    onDone();
  };

  const snap = res?.snap;
  const btcPos = snap?.positions.find((p) => p.coin === "BTC");
  return (
    <div className="space-y-4">
      <Field label="Nome do ciclo" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data de início" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-muted">Fuso horário</span>
        <select value={tz} onChange={(e) => setTz(e.target.value)} className="h-12 w-full rounded-md border border-line bg-surface-2 px-3.5 text-[16px] text-ink focus:border-accent focus:outline-none">
          {[...new Set([localTz(), ...TZS])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
        </select>
      </label>
      {Number.isFinite(startAt) && <p className="text-[13px] text-muted">Início: {fmtZoned(startAt, tz)} ({tz.replace("_", " ")}) · {new Date(startAt).toISOString().slice(0, 16).replace("T", " ")} UTC</p>}
      {mode === "new" && active && <Notice tone="info">O ciclo “{active.name}” será encerrado nesse instante. Ele continua salvo em Ciclos anteriores.</Notice>}

      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[15px] font-semibold">Patrimônio inicial</p>
          {!firstManual && <button type="button" onClick={() => { if (!locked || window.confirm("Recalcular o patrimônio inicial deste ciclo? O retrato guardado será substituído.")) void recalc(); }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent"><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />Recalcular</button>}
        </div>
        {!firstManual && !manual && (busy && !snap ? <p className="mt-3 text-[14px] text-muted">Calculando pelo histórico…</p> : snap ? (
          <div className="mt-3 space-y-1.5 text-[14px]">
            <span className="inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-semibold text-accent">{SRC_LABEL[snap.source]}</span>
            <p className="num text-[26px] font-bold">{f.usd(snap.equityUsd, { reveal: true })}</p>
            {btcPos ? <p className="text-ink-2">Posição herdada: {Number(btcPos.size).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} BTC · referência {fmtMoney(btcPos.mark, "USD")}{btcPos.officialEntry ? ` · entrada oficial ${fmtMoney(btcPos.officialEntry, "USD")}` : ""}</p> : <p className="text-ink-2">Sem posição em BTC no início · 100% em USDC</p>}
            {snap.accountPnlUsd && <p className="text-muted">PnL acumulado da conta até ali: {f.usd(snap.accountPnlUsd, { signed: true, reveal: true })} (não entra no ciclo)</p>}
            {res?.detail.map((x) => <p key={x} className="text-[12px] text-muted">{x}</p>)}
          </div>
        ) : null)}
        {res && !res.snap && !manual && <p className="mt-3 text-[14px] text-warn">Não há dados suficientes para reconstruir. Informe os valores abaixo.</p>}
        {acc.kind === "hl" && acc.includeArb && Math.abs(Date.now() - startAt) > 5 * 60e3 && (
          <Field className="mt-3" label="USDC na carteira (Arbitrum) no início" suffix="US$" inputMode="decimal" value={arb} onChange={(e) => setArb(num(e.target.value))} hint="Não há histórico público confiável desse saldo." />
        )}
        {(manual || firstManual) && (
          <div className="mt-3 space-y-3">
            <Field label="Patrimônio no início" suffix="US$" inputMode="decimal" value={mEq} onChange={(e) => setMEq(num(e.target.value))} />
            {firstManual ? (
              <>
                <Segmented full value={startIn} onChange={setStartIn} options={[{ value: "USDC", label: "100% em USDC" }, { value: "BTC", label: "100% em BTC" }]} />
                {startIn === "BTC" && <div className="grid grid-cols-2 gap-3"><Field label="Preço de entrada" suffix="US$" inputMode="decimal" value={entry} onChange={(e) => setEntry(num(e.target.value))} /><Field label="Alavancagem" suffix="x" inputMode="decimal" value={lev} onChange={(e) => setLev(num(e.target.value))} /></div>}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="BTC aberto no início" suffix="BTC" inputMode="decimal" placeholder="0" value={mSize} onChange={(e) => setMSize(num(e.target.value))} />
                <Field label="Preço de referência" suffix="US$" inputMode="decimal" value={mPx} onChange={(e) => setMPx(num(e.target.value))} />
              </div>
            )}
          </div>
        )}
        {!firstManual && <label className="mt-3 flex items-center gap-3 text-[14px] text-ink-2"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked, true)} className="size-5 accent-[#42d9d0]" />Informar os valores à mão (referência manual)</label>}
      </div>
      <Button variant="primary" size="lg" className="w-full" onClick={save} disabled={busy && !manual}>{mode === "new" ? "Iniciar ciclo" : "Salvar ciclo"}</Button>
    </div>
  );
}

export function StrategySheet({ mode, edit, onClose }: { mode: "new" | "edit"; edit?: StrategyCycle; onClose: () => void }) {
  return <Sheet title={mode === "new" ? "Novo ciclo da estratégia" : "Editar ciclo"} onClose={onClose}><div className="pb-3"><StrategyForm mode={mode} edit={edit} onDone={onClose} /></div></Sheet>;
}

/** Aparece quando a conta está conectada mas ainda não há ciclo. */
export function StrategySetup() {
  return (
    <div className="space-y-5 pt-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">Quando começou a estratégia?</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">O histórico antigo da conta fica guardado, mas só o que acontecer a partir do início entra no resultado, nos gráficos e na comparação com Buy & Hold.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-5"><StrategyForm mode="new" onDone={() => undefined} /></div>
      <p className="flex items-center gap-2 text-[13px] text-muted"><History className="size-4" />Quer ver tudo sem separar? Depois de criar, escolha “Histórico completo da conta” no topo.</p>
    </div>
  );
}
