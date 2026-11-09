"use client";
import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { useFmt } from "@/lib/state";
import { MAX_EXTRA, addExtra, extraState, refreshExtra, removeExtra, renameExtra } from "@/lib/local/hl-extra";
import { Button, Field, Notice, cn } from "./ui";
import { toast } from "./toaster";

/** Contas Hyperliquid adicionais (a segunda conta, etc.). Somente leitura; fora do resultado da Estratégia BTC/USDC. */
export function HlExtraAccounts() {
  useDataVersion();
  const f = useFmt();
  const list = extraState().accounts;
  const [name, setName] = useState(""), [addr, setAddr] = useState(""), [busy, setBusy] = useState(false);
  const add = async () => {
    try {
      const id = addExtra(name, addr);
      setName(""); setAddr(""); setBusy(true);
      await refreshExtra(id, true);
      const a = extraState().accounts.find((x) => x.id === id);
      if (a?.error) toast(a.error, "loss"); else toast(`Conta adicionada: ${a?.history?.fills.length ?? 0} execuções guardadas.`, "gain");
    } catch (e) { toast((e as Error).message, "loss"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">Acompanhe outra conta da Hyperliquid pelo endereço público. Ela aparece em Posições Perpétuas, Risk Center e Portfólio, sem entrar no resultado da Estratégia BTC/USDC. Nunca informe frase de recuperação ou chave privada.</p>
      {list.map((a) => (
        <div key={a.id} className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-3">
            <span className={cn("size-2.5 shrink-0 rounded-full", a.error ? "bg-loss" : a.live ? "bg-gain" : "bg-warn")} aria-hidden />
            <div className="min-w-0 flex-1">
              <input aria-label="Apelido da conta" defaultValue={a.name} onBlur={(e) => renameExtra(a.id, e.target.value)} className="w-full bg-transparent text-[15px] font-medium outline-none focus:underline" />
              <p className="num truncate text-[12px] text-muted">{a.address.slice(0, 6)}…{a.address.slice(-4)}{a.live ? ` · equity ${f.money(a.live.total)} · ${fmtRelative(a.live.at / 1000)}` : " · ainda sem leitura"}{a.history ? ` · ${a.history.fills.length} execuções` : ""}</p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Sincronizar ${a.name}`} loading={a.syncing} onClick={() => void refreshExtra(a.id, true)}><RefreshCw className="size-4" /></Button>
            <Button size="sm" variant="ghost" className="text-loss" aria-label={`Remover ${a.name}`} onClick={() => { if (confirm(`Remover a conta "${a.name}" deste aparelho? Nada é alterado na Hyperliquid.`)) removeExtra(a.id); }}><Trash2 className="size-4" /></Button>
          </div>
          {a.error && <div className="mt-2"><Notice tone="loss">{a.error}</Notice></div>}
        </div>
      ))}
      {list.length < MAX_EXTRA && (
        <div className="space-y-3">
          <Field label="Apelido" placeholder="Hyperliquid 2" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Endereço da conta" placeholder="0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={addr} onChange={(e) => setAddr(e.target.value)} />
          <Button variant="primary" className="w-full" onClick={add} loading={busy}><Plus className="size-4" />Adicionar conta Hyperliquid</Button>
        </div>
      )}
    </div>
  );
}
