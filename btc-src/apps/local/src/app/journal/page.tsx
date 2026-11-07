"use client";
/** Trading Journal: registro de operações e estatísticas de execução. Independente da contabilidade patrimonial. */
import { useRef, useState } from "react";
import { ImagePlus, Plus } from "lucide-react";
import { journalResult, journalStats, type JournalEntry } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { portfolio, updatePortfolio, uidP } from "@/lib/portfolio/db";
import { Sheet } from "@/components/sheet";
import { toast } from "@/components/toaster";
import { Button, Field, Kpi, KpiGrid, Panel, PanelHead, Pill, Segmented, cn, toneCls, toneOf } from "@/components/ui";

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));

/** Reduz a imagem no aparelho (máx. 1280 px, JPEG) antes de guardar. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

export default function JournalPage() {
  useDataVersion();
  const f = useFmt();
  const [edit, setEdit] = useState<JournalEntry | "new" | null>(null);
  const list = [...portfolio().journal].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const st = journalStats(list);
  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[20px] font-semibold tracking-tight">Trading Journal</h1><p className="text-[12px] text-muted">Diário de operações · não altera o patrimônio nem a Estratégia</p></div>
        <Button size="sm" variant="primary" onClick={() => setEdit("new")}><Plus className="size-4" />Registrar operação</Button>
      </div>
      <KpiGrid className="mb-4 grid-cols-2 lg:grid-cols-5">
        <Kpi label="Operações" value={String(st.total)} sub={`${st.open} aberta(s)`} />
        <Kpi label="Acertos" value={st.winRate != null ? f.pct(st.winRate, false) : "—"} />
        <Kpi label="R médio" value={st.avgR != null ? st.avgR.toFixed(2).replace(".", ",") : "—"} sub="resultado ÷ risco até o stop" />
        <Kpi label="Expectativa" tone={toneOf(st.expectancyPct)} value={st.expectancyPct != null ? f.pct(st.expectancyPct) : "—"} />
        <Kpi label="Disciplina" value={st.total ? f.pct(st.withStop / st.total, false) : "—"} sub="com stop definido" />
      </KpiGrid>
      <Panel className="overflow-hidden">
        <PanelHead title="Registros" />
        {list.length ? <ul className="divide-y divide-line">{list.map((e) => {
          const r = journalResult(e);
          return (
            <li key={e.id}><button onClick={() => setEdit(e)} className="flex w-full items-center gap-3 px-4 py-3 text-left [@media(hover:hover)]:hover:bg-surface-2">
              <span className="num w-[78px] shrink-0 text-[11px] text-muted">{new Date(`${e.date}T12:00`).toLocaleDateString("pt-BR")}</span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px]">{e.asset}<Pill tone={e.dir === "LONG" ? "btc" : "loss"}>{e.dir}</Pill>{e.strategy && <span className="text-[11px] text-muted">{e.strategy}</span>}</span>
                <span className="num block truncate text-[11px] text-muted">entrada {f.px(e.entry)}{e.stop != null ? ` · stop ${f.px(e.stop)}` : " · sem stop"}{e.exit != null ? ` · saída ${f.px(e.exit)}` : ""}{e.rationale ? ` · ${e.rationale}` : ""}</span></span>
              <span className={cn("num text-right text-[13px]", toneCls(toneOf(r.pct)))}>{r.closed ? f.pct(r.pct) : <span className="text-muted">aberta</span>}{r.r != null && <span className="block text-[11px]">{r.r.toFixed(2).replace(".", ",")}R</span>}</span>
            </button></li>
          );
        })}</ul> : <p className="px-4 py-6 text-[13px] text-muted">Nenhum registro. Anote cada operação com o motivo, o stop e os alvos para medir a sua execução.</p>}
      </Panel>
      {edit && <EntrySheet entry={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EntrySheet({ entry, onClose }: { entry: JournalEntry | null; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [m, setM] = useState({
    asset: entry?.asset ?? "BTC", strategy: entry?.strategy ?? "BTC/USDC", date: entry?.date ?? new Date().toISOString().slice(0, 10), dir: entry?.dir ?? ("LONG" as const),
    entry: entry ? String(entry.entry) : "", exit: entry?.exit != null ? String(entry.exit) : "", stop: entry?.stop != null ? String(entry.stop) : "", targets: entry?.targets.join("; ") ?? "",
    rationale: entry?.rationale ?? "", notes: entry?.notes ?? "", image: entry?.image ?? null as string | null,
  });
  const set = (k: keyof typeof m) => (e: { target: { value: string } }) => setM((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const en = num(m.entry);
    if (!m.asset.trim() || !(en != null && en > 0)) return toast("Informe o ativo e o preço de entrada.", "loss");
    const row: JournalEntry = { id: entry?.id ?? uidP(), asset: m.asset.trim().toUpperCase(), strategy: m.strategy.trim(), date: m.date, dir: m.dir, entry: en, exit: num(m.exit), stop: num(m.stop),
      targets: m.targets.split(/[;\s]+/).map(num).filter((x): x is number => x != null && x > 0), rationale: m.rationale.trim(), notes: m.notes.trim(), image: m.image, createdAt: entry?.createdAt ?? Date.now() };
    await updatePortfolio((d) => { d.journal = [...d.journal.filter((x) => x.id !== row.id), row]; });
    toast("Registro salvo.", "gain"); onClose();
  };
  const remove = async () => { if (!entry || !window.confirm("Apagar este registro do diário?")) return; await updatePortfolio((d) => { d.journal = d.journal.filter((x) => x.id !== entry.id); }); onClose(); };
  return (
    <Sheet title={entry ? "Editar registro" : "Registrar operação"} onClose={onClose} footer={<div className="flex gap-2">{entry && <Button variant="danger" onClick={remove}>Apagar</Button>}<Button variant="primary" className="flex-1" onClick={save}>Salvar</Button></div>}>
      <div className="space-y-3 pb-2">
        <Segmented full value={m.dir} onChange={(v) => setM((x) => ({ ...x, dir: v }))} options={[{ value: "LONG", label: "Long" }, { value: "SHORT", label: "Short" }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ativo" value={m.asset} onChange={set("asset")} />
          <Field label="Estratégia" value={m.strategy} onChange={set("strategy")} />
          <Field label="Data" type="date" value={m.date} onChange={set("date")} />
          <Field label="Entrada" inputMode="decimal" value={m.entry} onChange={set("entry")} />
          <Field label="Stop" inputMode="decimal" placeholder="opcional" value={m.stop} onChange={set("stop")} />
          <Field label="Saída" inputMode="decimal" placeholder="em aberto" value={m.exit} onChange={set("exit")} />
        </div>
        <Field label="Alvos" placeholder="ex.: 82000; 90000" value={m.targets} onChange={set("targets")} />
        <Field label="Justificativa" placeholder="por que entrou" value={m.rationale} onChange={set("rationale")} />
        <Field label="Observações" value={m.notes} onChange={set("notes")} />
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) { try { setM((x) => ({ ...x, image: "" })); const d = await shrink(fl); setM((x) => ({ ...x, image: d })); } catch { toast("Não foi possível ler a imagem.", "loss"); } } e.target.value = ""; }} />
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => file.current?.click()}><ImagePlus className="size-4" />{m.image ? "Trocar captura" : "Anexar captura de tela"}</Button>
          {m.image && <button className="text-[12px] text-loss" onClick={() => setM((x) => ({ ...x, image: null }))}>remover</button>}
        </div>
        {m.image ? <img src={m.image} alt="Captura da operação" className="max-h-56 rounded-md border border-line" /> : null}
      </div>
    </Sheet>
  );
}
