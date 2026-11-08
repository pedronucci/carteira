"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "./ui";

type Tone = "btc" | "gain" | "loss" | "neutral";
type T = { id: number; msg: string; tone: Tone };
let push: ((t: T) => void) | null = null;
let seq = 0;
const recent = new Map<string, number>();

/** Notificação na tela, com supressão de mensagens repetidas em 30 s. */
export function toast(msg: string, tone: Tone = "neutral") {
  const now = Date.now();
  if ((recent.get(msg) ?? 0) > now - 3_000) return;
  recent.set(msg, now);
  push?.({ id: ++seq, msg, tone });
}

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems([t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 3500);
    };
    return () => { push = null; };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
      {items.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border bg-surface-2 px-4 py-3 text-[14px] shadow-[0_8px_24px_var(--shadow-pop)]",
          t.tone === "loss" ? "border-loss/40" : t.tone === "gain" ? "border-gain/40" : t.tone === "btc" ? "border-btc/40" : "border-line-strong")}>
          <span className="flex-1">{t.msg}</span>
          <button aria-label="Fechar" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-muted hover:text-ink"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
