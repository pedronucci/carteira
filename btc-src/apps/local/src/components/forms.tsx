"use client";
import { useMemo, useState } from "react";
import { d, fmtMoney } from "@bst/domain";
import { getStore, uid, updateStore, type Add, type Cycle, type Flow, backupNow } from "@/lib/local/store";
import { prices } from "@/lib/local/prices";
import { compute, cycleSizeBtc, cycleValue, estimateLiq, foldAdd, simulateEntry, withAdds } from "@/lib/local/engine";
import { useFmt } from "@/lib/state";
import { Button, Field, Row, Segmented, cn, toneOf } from "./ui";
import { Sheet } from "./sheet";
import { toast } from "./toaster";

export const nowLocal = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 16); };
export const todayLocal = () => nowLocal().slice(0, 10);
/** Aceita "1.234,56", "1234,56" e "1234.56". */
export const num = (v: string) => {
  const s = v.replace(/\s|US\$|R\$/g, "");
  if (s.includes(",")) return s.replace(/\./g, "").replace(",", ".");
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return s.replace(/\./g, ""); // 10.000 = dez mil
  return s;
};
const pos = (v: string) => v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
const spotStr = () => (prices().spot?.btcUsd ? Math.round(prices().spot!.btcUsd!).toString() : "");

/** Posição inicial: onde a estratégia estava na data de início. */
export function InitialForm({ onDone }: { onDone?: () => void }) {
  const s = getStore();
  const i = s.initial;
  const openAtStart = i ? s.cycles.find((c) => c.openedAt.slice(0, 10) === i.date && c.id.startsWith("init-")) : undefined;
  const [date, setDate] = useState(i?.date ?? todayLocal());
  const [state, setState] = useState<"USDC" | "BTC">(openAtStart ? "BTC" : "USDC");
  const [amount, setAmount] = useState(i?.usdc ?? "");
  const [entry, setEntry] = useState(openAtStart?.entryPx ?? spotStr());
  const [lev, setLev] = useState(openAtStart?.leverage ?? s.settings.defaultLeverage);
  const save = () => {
    if (!date) return toast("Informe a data de início.", "loss");
    if (!pos(amount)) return toast("Informe o valor em dólar.", "loss");
    if (state === "BTC" && (!pos(entry) || !pos(lev))) return toast("Informe o preço de entrada e a alavancagem.", "loss");
    updateStore((st) => {
      st.initial = { date, usdc: d(amount).toFixed() };
      st.cycles = st.cycles.filter((c) => !c.id.startsWith("init-"));
      if (state === "BTC") st.cycles.push({ id: `init-${uid()}`, openedAt: `${date}T00:00`, entryPx: d(entry).toFixed(), leverage: d(lev).toFixed(), capital: d(amount).toFixed(), note: "Posição na data de início" });
    });
    toast("Posição inicial salva.", "gain");
    onDone?.();
  };
  return (
    <div className="space-y-4">
      <Field label="Data de início" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      <div>
        <span className="mb-1.5 block text-[13px] text-muted">Onde você estava nessa data</span>
        <Segmented full value={state} onChange={setState} options={[{ value: "USDC", label: "100% em USDC" }, { value: "BTC", label: "100% em BTC" }]} />
      </div>
      <Field label={state === "USDC" ? "Saldo em USDC" : "Capital da posição (margem em USDC)"} suffix="US$" inputMode="decimal" placeholder="10.000" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
      {state === "BTC" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço de entrada" suffix="US$" inputMode="decimal" value={entry} onChange={(e) => setEntry(num(e.target.value))} />
          <Field label="Alavancagem" suffix="x" inputMode="decimal" value={lev} onChange={(e) => setLev(num(e.target.value))} />
        </div>
      )}
      <Button variant="primary" size="lg" className="w-full" onClick={save}>Salvar posição inicial</Button>
    </div>
  );
}

/** Entrar em BTC (abre um ciclo). Também serve de simulador: nada é salvo até tocar em Registrar. */
export function EntrySheet({ edit: editIn, onClose }: { edit?: Cycle | null; onClose: () => void }) {
  const f = useFmt();
  const st = getStore();
  const edit = editIn ? st.cycles.find((x) => x.id === editIn.id) ?? editIn : null; // sempre o lançamento original, sem os aumentos somados
  const free = useMemo(() => {
    try {
      // caixa livre = patrimônio sem ciclo aberto (o ciclo em edição volta para o caixa)
      let cash = d(st.initial?.usdc ?? 0);
      for (const fl of st.flows) cash = cash.plus(d(fl.amount).mul(fl.kind === "IN" ? 1 : -1));
      for (const c of st.cycles) {
        if (edit && c.id === edit.id) continue;
        const w = withAdds(c);
        cash = cash.minus(w.capital);
        if (c.closedAt && c.exitPx) cash = cash.plus(cycleValue(w, d(c.exitPx))).minus(c.feesClose || 0);
      }
      return cash;
    } catch { return d(0); }
  }, [st, edit]);
  const [date, setDate] = useState(edit?.openedAt ?? nowLocal());
  const [entry, setEntry] = useState(edit?.entryPx ?? spotStr());
  const [lev, setLev] = useState(edit?.leverage ?? st.settings.defaultLeverage);
  const [capital, setCapital] = useState(edit?.capital ?? (free.gt(0) ? free.toDecimalPlaces(2).toFixed() : ""));
  const [fees, setFees] = useState(edit?.feesOpen ?? "");
  const [liq, setLiq] = useState(edit?.liqPx ?? "");
  const [stop, setStop] = useState(edit?.stopPx ?? "");
  const [target, setTarget] = useState(edit?.targetPx ?? "");
  const [platform, setPlatform] = useState(edit?.platform ?? "Hyperliquid");
  const [more, setMore] = useState(Boolean(edit?.feesOpen || edit?.liqPx || edit?.stopPx || edit?.targetPx));
  const sim = pos(entry) && pos(lev) && pos(capital) ? simulateEntry({ capital, leverage: lev, entryPx: entry, feesOpen: fees || undefined, stopPx: stop || undefined, targetPx: target || undefined, liqPx: liq || undefined }, st.settings.maintenanceRate) : null;
  const save = () => {
    if (!sim) return toast("Preencha preço de entrada, alavancagem e capital.", "loss");
    const c: Cycle = { ...(edit ?? {}), id: edit?.id ?? uid(), openedAt: date, entryPx: d(entry).toFixed(), leverage: d(lev).toFixed(), capital: d(capital).toFixed(), feesOpen: fees ? d(fees).toFixed() : undefined, liqPx: liq ? d(liq).toFixed() : undefined, stopPx: stop ? d(stop).toFixed() : undefined, targetPx: target ? d(target).toFixed() : undefined, platform: platform || undefined };
    backupNow("antes de salvar uma posição");
    updateStore((s) => { const i = s.cycles.findIndex((x) => x.id === c.id); if (i >= 0) s.cycles[i] = c; else s.cycles.push(c); });
    toast(edit ? "Entrada atualizada." : "Entrada registrada. Você está em BTC.", "gain");
    onClose();
  };
  const remove = () => {
    if (!edit || !confirm("Apagar este ciclo (e os aumentos dele)?")) return;
    const deps = new Set((edit.adds ?? []).map((a) => `add-${a.id}`));
    backupNow("antes de apagar uma posição");
    updateStore((s) => { s.cycles = s.cycles.filter((x) => x.id !== edit.id); s.flows = s.flows.filter((x) => !deps.has(x.id)); });
    onClose();
  };
  const removeAdd = (a: Add) => {
    if (!edit || !confirm("Apagar este aumento de posição?")) return;
    backupNow("antes de apagar um aumento");
    updateStore((s) => { const c = s.cycles.find((x) => x.id === edit.id); if (c) c.adds = (c.adds ?? []).filter((x) => x.id !== a.id); s.flows = s.flows.filter((x) => x.id !== `add-${a.id}`); });
    toast("Aumento apagado.", "gain");
  };
  const adds = getStore().cycles.find((x) => x.id === edit?.id)?.adds ?? [];
  return (
    <Sheet title={edit ? "Editar entrada" : "Entrar em BTC"} onClose={onClose} footer={
      <div className="flex gap-2"><Button variant="primary" size="lg" className="flex-1" onClick={save} disabled={!sim}>{edit ? "Salvar" : "Registrar entrada"}</Button>{edit && <Button variant="danger" size="lg" onClick={remove}>Apagar</Button>}</div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço de entrada" suffix="US$" inputMode="decimal" value={entry} onChange={(e) => setEntry(num(e.target.value))} />
          <Field label="Alavancagem" suffix="x" inputMode="decimal" value={lev} onChange={(e) => setLev(num(e.target.value))} />
        </div>
        <Field label="Capital (margem em USDC)" suffix="US$" inputMode="decimal" value={capital} onChange={(e) => setCapital(num(e.target.value))} hint={free.gt(0) ? <>Disponível: {f.usd(free.toFixed(), { reveal: true })}. <button type="button" className="text-accent" onClick={() => setCapital(free.toDecimalPlaces(2).toFixed())}>Usar tudo</button></> : undefined} />
        <Field label="Data e hora" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        {sim && (
          <div className="rounded-lg bg-surface-2 px-4 py-1">
            <Row label="Exposição">{f.btc(sim.sizeBtc.toFixed())} BTC · {f.usd(sim.notional.toFixed(), { compact: true })}</Row>
            <Row label="Liquidação" tone={sim.liq ? "loss" : null}>{sim.liq ? `${fmtMoney(sim.liq, "USD")} (${f.pct(sim.liqDist?.neg(), false)})` : "não há em 1x"}</Row>
            <div className="flex justify-between gap-2 border-t border-line/70 py-2.5 text-[12px] text-muted">
              {sim.shocks.map((s) => <span key={s.shock} className="num text-center">BTC {Math.round(s.shock * 100)}%<b className={cn("block text-[13px]", s.liquidated ? "text-loss" : "text-ink-2")}>{s.liquidated ? "liquida" : f.pct(s.value.div(capital).minus(1))}</b></span>)}
            </div>
            {sim.lossAtStop && <Row label="No stop" tone="loss">{f.usd(sim.lossAtStop.toFixed(), { signed: true })}</Row>}
            {sim.gainAtTarget && <Row label="No alvo" tone={toneOf(sim.gainAtTarget)}>{f.usd(sim.gainAtTarget.toFixed(), { signed: true })}{sim.rr ? ` · ${sim.rr.toFixed(1).replace(".", ",")} : 1` : ""}</Row>}
          </div>
        )}
        {adds.length > 0 && (
          <div className="rounded-lg border border-line px-4 py-2">
            <p className="py-1.5 text-[14px] font-semibold">Aumentos desta posição</p>
            {adds.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-t border-line py-2.5 text-[14px]">
                <span className="num min-w-0 flex-1 text-ink-2">{new Date(a.at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} · +{f.usd(a.capital, { reveal: true })} a {fmtMoney(a.px, "USD")} · {Number(a.leverage).toLocaleString("pt-BR")}x</span>
                <button type="button" className="text-[13px] font-medium text-loss" onClick={() => removeAdd(a)}>Apagar</button>
              </div>
            ))}
            <p className="pb-1.5 text-[12px] text-muted">Os campos acima são da entrada original. O preço médio já considera os aumentos.</p>
          </div>
        )}
        {!more ? <button type="button" className="text-[14px] font-medium text-accent" onClick={() => setMore(true)}>Stop, alvo, taxas e liquidação da corretora</button> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stop (simulação)" suffix="US$" inputMode="decimal" value={stop} onChange={(e) => setStop(num(e.target.value))} />
              <Field label="Alvo (simulação)" suffix="US$" inputMode="decimal" value={target} onChange={(e) => setTarget(num(e.target.value))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Taxa de entrada" suffix="US$" inputMode="decimal" value={fees} onChange={(e) => setFees(num(e.target.value))} />
              <Field label="Liquidação (da corretora)" suffix="US$" inputMode="decimal" placeholder="opcional" value={liq} onChange={(e) => setLiq(num(e.target.value))} />
            </div>
            <Field label="Plataforma" value={platform} maxLength={30} onChange={(e) => setPlatform(e.target.value)} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Sair para USDC (fecha o ciclo aberto). */
export function ExitSheet({ cycle: cycleIn, onClose }: { cycle: Cycle; onClose: () => void }) {
  const f = useFmt();
  const raw = getStore().cycles.find((x) => x.id === cycleIn.id) ?? cycleIn;
  const cycle = withAdds(raw);
  const [date, setDate] = useState(cycle.closedAt ?? nowLocal());
  const [px, setPx] = useState(cycle.exitPx ?? spotStr());
  const [fees, setFees] = useState(cycle.feesClose ?? "");
  const [funding, setFunding] = useState(cycle.funding ?? "");
  const preview = pos(px) ? (() => { const c = { ...cycle, funding: funding || undefined, adds: undefined }; const out = cycleValue(c, d(px)).minus(fees || 0); return { out, pnl: out.minus(cycle.capital), pct: out.div(cycle.capital).minus(1) }; })() : null;
  const save = () => {
    if (!pos(px)) return toast("Informe o preço de saída.", "loss");
    backupNow("antes de registrar uma saída");
    updateStore((s) => { const c = s.cycles.find((x) => x.id === cycle.id); if (c) Object.assign(c, { closedAt: date, exitPx: d(px).toFixed(), feesClose: fees ? d(fees).toFixed() : undefined, funding: funding ? d(funding).toFixed() : undefined }); });
    toast("Saída registrada. Você está em USDC.", "gain");
    onClose();
  };
  const reopen = () => { backupNow("antes de reabrir uma posição"); updateStore((s) => { const c = s.cycles.find((x) => x.id === cycle.id); if (c) { delete c.closedAt; delete c.exitPx; delete c.feesClose; } }); onClose(); };
  return (
    <Sheet title={cycle.closedAt ? "Editar saída" : "Sair para USDC"} onClose={onClose} footer={
      <div className="flex gap-2"><Button variant="primary" size="lg" className="flex-1" onClick={save} disabled={!preview}>{cycle.closedAt ? "Salvar" : "Registrar saída"}</Button>{cycle.closedAt && <Button size="lg" onClick={reopen}>Reabrir</Button>}</div>}>
      <div className="space-y-4">
        <Field label="Preço de saída" suffix="US$" inputMode="decimal" value={px} onChange={(e) => setPx(num(e.target.value))} hint={`Preço médio ${fmtMoney(cycle.entryPx, "USD")} · ${f.btc(cycleSizeBtc(cycle).toFixed(), 6)} BTC${raw.adds?.length ? ` · ${raw.adds.length} aumento${raw.adds.length > 1 ? "s" : ""}` : ""}`} />
        <Field label="Data e hora" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taxa de saída" suffix="US$" inputMode="decimal" value={fees} onChange={(e) => setFees(num(e.target.value))} />
          <Field label="Funding no ciclo" suffix="US$" inputMode="decimal" placeholder="− pago, + recebido" value={funding} onChange={(e) => setFunding(e.target.value.replace(",", "."))} />
        </div>
        {preview && (
          <div className="rounded-lg bg-surface-2 px-4 py-1">
            <Row label="Volta para USDC">{f.usd(preview.out.toFixed())}</Row>
            <Row label="Resultado do ciclo" tone={toneOf(preview.pnl)}>{f.usd(preview.pnl.toFixed(), { signed: true })} · {f.pct(preview.pct)}</Row>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function FlowSheet({ edit, onClose }: { edit?: Flow | null; onClose: () => void }) {
  const [kind, setKind] = useState<"IN" | "OUT">(edit?.kind ?? "IN");
  const [date, setDate] = useState(edit?.date ?? nowLocal());
  const [amount, setAmount] = useState(edit?.amount ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const save = () => {
    if (!pos(amount)) return toast("Informe o valor.", "loss");
    const fl: Flow = { id: edit?.id ?? uid(), kind, date, amount: d(amount).toFixed(), note: note || undefined };
    updateStore((s) => { const i = s.flows.findIndex((x) => x.id === fl.id); if (i >= 0) s.flows[i] = fl; else s.flows.push(fl); });
    toast(kind === "IN" ? "Aporte registrado." : "Retirada registrada.", "gain");
    onClose();
  };
  const remove = () => { if (!edit || !confirm("Apagar este lançamento?")) return; backupNow("antes de apagar um lançamento"); updateStore((s) => { s.flows = s.flows.filter((x) => x.id !== edit.id); }); onClose(); };
  return (
    <Sheet title={edit ? "Editar lançamento" : "Aporte ou retirada"} onClose={onClose} footer={
      <div className="flex gap-2"><Button variant="primary" size="lg" className="flex-1" onClick={save}>Salvar</Button>{edit && <Button variant="danger" size="lg" onClick={remove}>Apagar</Button>}</div>}>
      <div className="space-y-4">
        <Segmented full value={kind} onChange={setKind} options={[{ value: "IN", label: "Aporte" }, { value: "OUT", label: "Retirada" }]} />
        <Field label="Valor em USDC" suffix="US$" inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
        <Field label="Data e hora" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Nota (opcional)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
        <p className="text-[13px] text-muted">Aportes e retiradas mudam o capital, não a rentabilidade.</p>
      </div>
    </Sheet>
  );
}

/** Aumentar uma posição aberta: mais USDC de margem, mais BTC e novo preço médio (como na Hyperliquid). */
export function AddSheet({ cycle: cycleIn, onClose }: { cycle: Cycle; onClose: () => void }) {
  const f = useFmt();
  const st = getStore();
  const raw = st.cycles.find((x) => x.id === cycleIn.id) ?? cycleIn;
  const cur = withAdds(raw);
  const free = useMemo(() => { try { return d(Math.max(0, compute().free ?? 0)); } catch { return d(0); } }, []);
  const [date, setDate] = useState(nowLocal());
  const [px, setPx] = useState(spotStr());
  const [capital, setCapital] = useState("");
  const [lev, setLev] = useState(Number(cur.leverage) ? String(Math.round(Number(cur.leverage) * 100) / 100) : st.settings.defaultLeverage);
  const [fees, setFees] = useState("");
  const [liq, setLiq] = useState("");
  const [deposit, setDeposit] = useState<boolean | null>(null);
  const isDeposit = deposit ?? (pos(capital) && d(capital).gt(free.gt(0) ? free : 0));
  const ok = pos(px) && pos(capital) && pos(lev);
  const next = ok ? foldAdd({ ...cur, adds: undefined }, { id: "sim", at: date, px, capital, leverage: lev, fees: fees || undefined, liqPx: liq || undefined }) : null;
  const liqNext = next ? estimateLiq(next, st.settings.maintenanceRate) : null;
  const liqNow = estimateLiq(cur, st.settings.maintenanceRate);
  const spot = prices().spot?.btcUsd ?? (pos(px) ? Number(px) : null);
  const save = () => {
    if (!ok) return toast("Preencha preço, valor e alavancagem.", "loss");
    const a: Add = { id: uid(), at: date, px: d(px).toFixed(), capital: d(capital).toFixed(), leverage: d(lev).toFixed(), fees: fees ? d(fees).toFixed() : undefined, liqPx: liq ? d(liq).toFixed() : undefined, deposit: isDeposit || undefined };
    updateStore((s) => {
      const c = s.cycles.find((x) => x.id === raw.id);
      if (!c) return;
      c.adds = [...(c.adds ?? []), a];
      if (isDeposit) s.flows.push({ id: `add-${a.id}`, kind: "IN", date, amount: a.capital, note: "Aporte para aumentar a posição" });
    });
    toast(`Posição aumentada. Novo preço médio: ${fmtMoney(next!.entryPx, "USD")}.`, "gain");
    onClose();
  };
  return (
    <Sheet title="Aumentar posição" onClose={onClose} footer={<Button variant="primary" size="lg" className="w-full" onClick={save} disabled={!ok}>Adicionar à posição</Button>}>
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-2 px-4 py-1">
          <Row label="Posição atual">{f.btc(cycleSizeBtc(cur).toFixed(), 6)} BTC</Row>
          <Row label="Preço médio">{fmtMoney(cur.entryPx, "USD")}</Row>
          <Row label="Margem">{f.usd(cur.capital)}</Row>
        </div>
        <Field label="Valor a adicionar (margem em USDC)" suffix="US$" inputMode="decimal" value={capital} onChange={(e) => setCapital(num(e.target.value))}
          hint={free.gt(0.5) ? <>Livre na carteira: {f.usd(free.toFixed(), { reveal: true })}. <button type="button" className="text-accent" onClick={() => setCapital(free.toDecimalPlaces(2).toFixed())}>Usar tudo</button></> : "Sem USDC livre: o valor entra como aporte novo."} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço do BTC" suffix="US$" inputMode="decimal" value={px} onChange={(e) => setPx(num(e.target.value))} />
          <Field label="Alavancagem" suffix="x" inputMode="decimal" value={lev} onChange={(e) => setLev(num(e.target.value))} />
        </div>
        <Field label="Data e hora" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-2">
          <input type="checkbox" checked={isDeposit} onChange={(e) => setDeposit(e.target.checked)} className="mt-1 size-5 accent-[#42d9d0]" />
          <span>É dinheiro novo (registrar também um aporte). Desmarque se o USDC já estava livre na conta.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taxa" suffix="US$" inputMode="decimal" placeholder="opcional" value={fees} onChange={(e) => setFees(num(e.target.value))} />
          <Field label="Nova liquidação" suffix="US$" inputMode="decimal" placeholder="da corretora" value={liq} onChange={(e) => setLiq(num(e.target.value))} />
        </div>
        {next && (
          <div className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-1">
            <Row label="Nova posição">{f.btc(cycleSizeBtc(next).toFixed(), 6)} BTC</Row>
            <Row label="Novo preço médio" tone={d(next.entryPx).lt(cur.entryPx) ? "gain" : d(next.entryPx).gt(cur.entryPx) ? "loss" : null}>{fmtMoney(next.entryPx, "USD")} <span className="text-muted">(era {fmtMoney(cur.entryPx, "USD")})</span></Row>
            <Row label="Margem total">{f.usd(next.capital, { reveal: true })} · {Number(next.leverage).toLocaleString("pt-BR")}x</Row>
            <Row label="Exposição">{spot ? f.usd(cycleSizeBtc(next).mul(spot).toFixed(), { compact: true, reveal: true }) : "—"}</Row>
            <Row label="Liquidação" tone={liqNext && liqNow && liqNext.gt(liqNow) ? "loss" : null}>{liqNext ? fmtMoney(liqNext, "USD") : "sem risco"}{liqNow ? <span className="text-muted"> (era {fmtMoney(liqNow, "USD")})</span> : null}</Row>
          </div>
        )}
      </div>
    </Sheet>
  );
}
