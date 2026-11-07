"use client";
import { useState } from "react";
import { Link2, RefreshCw, Unplug, Wallet } from "lucide-react";
import { fmtRelative } from "@bst/domain";
import { useDataVersion } from "@/lib/api";
import { getStore, updateStore } from "@/lib/local/store";
import { askWalletAddress, clearHl, hasInjectedWallet, hlState, isAddress } from "@/lib/local/hl";
import { syncHlNow } from "@/app/providers";
import { Button, Field, Notice, cn } from "./ui";
import { toast } from "./toaster";

/** Conectar a conta da Hyperliquid pelo endereço da carteira (Rabby). Somente leitura. */
export function HlConnect() {
  useDataVersion();
  const cfg = getStore().settings.hl;
  const hl = hlState();
  const [addr, setAddr] = useState(cfg?.address ?? "");
  const [arb, setArb] = useState(Boolean(cfg?.includeArb));
  const [busy, setBusy] = useState(false);

  const connect = async (a = addr) => {
    const v = a.trim();
    if (!isAddress(v)) return toast("Endereço inválido. Ele começa com 0x e tem 42 caracteres.", "loss");
    setBusy(true);
    updateStore((s) => { s.settings.hl = { address: v.toLowerCase(), includeArb: arb }; });
    await syncHlNow(true);
    setBusy(false);
    const st = hlState();
    if (st.error) toast(st.error, "loss");
    else toast(`Conta conectada: ${st.history?.fills.length ?? 0} execuções e ${st.history?.ledger.length ?? 0} movimentações guardadas.`, "gain");
  };
  const fromWallet = async () => {
    try { const a = await askWalletAddress(); setAddr(a); await connect(a); }
    catch (e) { toast((e as Error).message, "loss"); }
  };
  const disconnect = () => {
    if (!confirm("Desconectar a Hyperliquid? Os lançamentos manuais voltam a valer.")) return;
    updateStore((s) => { delete s.settings.hl; });
    clearHl();
    setAddr("");
  };
  const toggleArb = async (v: boolean) => {
    setArb(v);
    if (!cfg) return;
    updateStore((s) => { if (s.settings.hl) s.settings.hl.includeArb = v; });
    setBusy(true); await syncHlNow(true); setBusy(false);
  };

  if (cfg?.address) {
    const live = hl.live;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className={cn("size-2.5 shrink-0 rounded-full", hl.error ? "bg-loss" : live ? "bg-gain" : "bg-warn")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">Hyperliquid conectada</p>
            <p className="num truncate text-[13px] text-muted">{cfg.address.slice(0, 6)}…{cfg.address.slice(-4)}{live ? ` · ${fmtRelative(live.at / 1000)}` : ""}{hl.history ? ` · ${hl.history.fills.length} execuções` : ""}</p>
          </div>
        </div>
        {hl.error && <Notice tone="loss">{hl.error}</Notice>}
        {hl.history?.truncated && <Notice>A conta tem mais histórico do que a API devolve de uma vez. Os ciclos mais antigos podem faltar.</Notice>}
        <label className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-2">
          <input type="checkbox" checked={arb} onChange={(e) => toggleArb(e.target.checked)} className="mt-1 size-5 accent-[#ebcd2f]" />
          <span>Somar o USDC/USDT parado na carteira na Arbitrum. Com a posição inicial definida, sacar da Hyperliquid para a carteira não conta como retirada.</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={async () => { setBusy(true); await syncHlNow(true); setBusy(false); }} loading={busy}><RefreshCw className="size-4" />Sincronizar</Button>
          <Button variant="ghost" className="text-loss" onClick={disconnect}><Unplug className="size-4" />Desconectar</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-ink-2">Use o endereço público da carteira (o mesmo da Rabby na Hyperliquid). O app só lê saldo, posição e histórico: não pede chave, assinatura nem permissão para operar.</p>
      {hasInjectedWallet() && <Button className="w-full" size="lg" onClick={fromWallet} loading={busy}><Wallet className="size-5" />Usar endereço da Rabby</Button>}
      <Field label="Endereço da carteira" placeholder="0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={addr} onChange={(e) => setAddr(e.target.value)} hint="Na Rabby: toque no nome da conta e copie o endereço." />
      <label className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-2">
        <input type="checkbox" checked={arb} onChange={(e) => setArb(e.target.checked)} className="mt-1 size-5 accent-[#ebcd2f]" />
        <span>Somar também o USDC/USDT da carteira na Arbitrum</span>
      </label>
      <Button variant="primary" size="lg" className="w-full" onClick={() => connect()} loading={busy}><Link2 className="size-5" />Conectar</Button>
    </div>
  );
}
