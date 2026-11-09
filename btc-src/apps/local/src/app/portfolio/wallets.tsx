"use client";
/** MINHAS CARTEIRAS: vários endereços públicos (EVM, Solana, Bitcoin), somente leitura. Nunca peça frase de recuperação ou chave privada. */
import { useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useFmt } from "@/lib/state";
import { portfolio } from "@/lib/portfolio/db";
import { addConnectedAccount, removeConnectedAccount, syncAccount } from "@/lib/connectors";
import { CATEGORIES, isWallet, updateWallet, walletAddr, walletMeta } from "@/lib/wallets";
import { Sheet } from "@/components/sheet";
import { toast } from "@/components/toaster";
import { Button, Field, Notice, Panel, PanelHead, Pill, Segmented, cn } from "@/components/ui";
import type { usePortfolio } from "@/lib/api";

type View = NonNullable<ReturnType<typeof usePortfolio>["data"]>;
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function WalletsTab({ v }: { v: View }) {
  const f = useFmt();
  const [sheet, setSheet] = useState<null | "add" | string>(null);
  const list = v.accounts.filter(isWallet);
  const value = (id: string) => v.c.byAccount.find((x) => x.accountId === id)?.valueUsd ?? 0;
  const nets = (id: string) => {
    const m = new Map<string, number>();
    for (const a of v.c.assets) for (const s of a.sources) if (s.accountId === id && s.valueUsd != null) m.set(s.network, (m.get(s.network) ?? 0) + s.valueUsd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const sync = portfolio().sync;
  const edit = list.find((a) => a.id === sheet) ?? null;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-[12px] text-muted">Apenas endereços públicos. Leitura de saldo; nenhuma assinatura.</p><Button size="sm" variant="primary" onClick={() => setSheet("add")}><Plus className="size-4" />Adicionar carteira</Button></div>
      {list.length === 0 && <Panel className="px-4 py-6 text-[14px] text-muted">Nenhuma carteira cadastrada ainda.</Panel>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((a) => {
          const m = walletMeta(a); const st = sync[a.id]; const n = nets(a.id);
          return (
            <Panel key={a.id} className={cn("p-4", !m.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{a.name}</p><p className="num text-[11px] text-muted">{short(walletAddr(a))} · {a.kind === "evm" ? "EVM" : a.kind === "solana" ? "Solana" : "Bitcoin"}</p></div>
                <div className="flex items-center gap-1"><Button size="sm" variant="ghost" aria-label={`Sincronizar ${a.name}`} onClick={() => void syncAccount(a.id)}><RefreshCw className="size-3.5" /></Button><Button size="sm" variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => setSheet(a.id)}><Pencil className="size-3.5" /></Button></div>
              </div>
              <p className="num mt-2 text-[22px] font-semibold">{f.money(value(a.id))}</p>
              <p className="mt-1 flex flex-wrap gap-1.5"><Pill>{m.category}</Pill>{m.own ? <Pill tone="accent">própria</Pill> : <Pill>de terceiros</Pill>}{!m.enabled && <Pill tone="gold">monitoramento pausado</Pill>}</p>
              {n.length > 0 && <ul className="mt-2 text-[12px] text-muted">{n.slice(0, 5).map(([k, x]) => <li key={k} className="flex justify-between py-0.5"><span>{k}</span><span className="num">{f.money(x)}</span></li>)}</ul>}
              <p className="mt-2 text-[11px] text-muted">{st ? `${st.state === "error" ? "erro" : "última sincronização"} ${st.at ? new Date(st.at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}${st.error ? ` · ${st.error}` : st.info ? ` · ${st.info}` : ""}` : "ainda não sincronizada"}</p>
            </Panel>
          );
        })}
      </div>
      {sheet === "add" && <AddWallet onClose={() => setSheet(null)} />}
      {edit && <EditWallet id={edit.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

function AddWallet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(""), [addr, setAddr] = useState(""), [kind, setKind] = useState<"evm" | "solana" | "bitcoin">("evm"), [cat, setCat] = useState<string>("Principal");
  const go = () => {
    try {
      const id = addConnectedAccount(kind, name, addr);
      if (cat !== "Principal") void updateWallet(id, { category: cat });
      void syncAccount(id); toast("Carteira adicionada. Sincronizando…", "gain"); onClose();
    } catch (e) { toast((e as Error).message, "loss"); }
  };
  return (
    <Sheet title="Adicionar carteira" onClose={onClose} footer={<Button variant="primary" size="lg" className="w-full" onClick={go}>Adicionar</Button>}>
      <div className="space-y-3 pt-1">
        <Segmented full label="Tipo" value={kind} onChange={setKind} options={[{ value: "evm", label: "EVM" }, { value: "solana", label: "Solana" }, { value: "bitcoin", label: "Bitcoin" }]} />
        <Field label="Apelido" placeholder="Rabby Secundária" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Endereço público" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <label className="block text-[12px] text-muted">Categoria<select value={cat} onChange={(e) => setCat(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-surface-2 px-2 text-[14px] text-ink">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <Notice tone="info">Nunca informe frase de recuperação ou chave privada. O app só lê saldos pelo endereço público. EVM: Ethereum, Arbitrum, Base, Optimism, Polygon e BNB Chain; o mesmo endereço vale para todas as redes e é contado uma vez.</Notice>
      </div>
    </Sheet>
  );
}

function EditWallet({ id, onClose }: { id: string; onClose: () => void }) {
  const a = portfolio().accounts.find((x) => x.id === id)!;
  const m = walletMeta(a);
  const [name, setName] = useState(a.name), [cat, setCat] = useState(m.category), [en, setEn] = useState(m.enabled), [own, setOwn] = useState(m.own), [rm, setRm] = useState(false);
  return (
    <Sheet title="Editar carteira" onClose={onClose} footer={<div className="flex gap-2"><Button variant="danger" onClick={() => (rm ? (void removeConnectedAccount(id), onClose()) : setRm(true))}><Trash2 className="size-4" />{rm ? "Confirmar remoção" : "Remover"}</Button><Button variant="primary" className="flex-1" onClick={() => { void updateWallet(id, { name, category: cat, enabled: en, own }); onClose(); }}>Salvar</Button></div>}>
      <div className="space-y-3 pt-1">
        <Field label="Apelido" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="num text-[12px] text-muted">{walletAddr(a)}</p>
        <label className="block text-[12px] text-muted">Categoria<select value={cat} onChange={(e) => setCat(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-surface-2 px-2 text-[14px] text-ink">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={en} onChange={(e) => setEn(e.target.checked)} className="size-5" />Monitoramento ativo</label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="size-5" />Carteira própria (transferências entre próprias não são lucro)</label>
        {rm && <Notice tone="loss">Remove a carteira e os saldos lidos dela deste aparelho. Nada é apagado na blockchain.</Notice>}
      </div>
    </Sheet>
  );
}
