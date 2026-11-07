"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, Link2, Menu, Settings, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { fmtRelative } from "@bst/domain";
import { useSnapshot } from "@/lib/api";
import { useAppState, useFmt } from "@/lib/state";
import { inCcy, periodReturn } from "@/lib/local/engine";
import { ScopeButton } from "./strategy";
import { cn, toneCls, toneOf } from "./ui";

export const NAV = [
  { href: "/", label: "Alocação" },
  { href: "/performance", label: "Performance" },
  { href: "/operations", label: "Transações" },
  { href: "/market", label: "Mercado" },
] as const;

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8 shrink-0", className)} aria-hidden>
      <defs><linearGradient id="mk" x1="0.2" y1="0.05" x2="0.8" y2="0.95"><stop offset="0" stopColor="#ffb648" /><stop offset="0.55" stopColor="#f7931a" /><stop offset="1" stopColor="#d4650a" /></linearGradient></defs>
      <rect width="512" height="512" rx="114" fill="#17191e" />
      <circle cx="256" cy="256" r="196" fill="url(#mk)" />
      <g fill="#fff" transform="translate(256 256) rotate(14) scale(1.6) translate(-101 -100)">
        <path fillRule="evenodd" d="M60 40 H112 C128 40 136 52 136 68 C136 80 130 88 122 92 C134 96 142 106 142 120 C142 142 128 160 108 160 H60 Z M82 59 H107 C113 59 116 64 116 70.5 C116 77 112 82 106 82 H82 Z M82 101 H110 C117 101 121 107 121 120.5 C121 134 116 141 108 141 H82 Z" />
        {[66, 90].flatMap((x) => [24, 158].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="12" height="18" rx="2" />))}
      </g>
    </svg>
  );
}

/** Patrimônio no topo das telas, como no app de referência. */
export function Hero() {
  const q = useSnapshot();
  const f = useFmt();
  const { hidden, toggleHidden } = useAppState();
  const s = q.data;
  const day = useMemo(() => (s ? periodReturn(inCcy(s.points.slice(-3), f.ccy, f.fx), 1) : null), [s, f.ccy, f.fx]);
  if (!s) return <div className="pt-2 pb-6"><ScopeButton /></div>;
  const at = s.closed ? null : s.live?.at ?? s.now.at;
  const hl = s.acc.kind === "hl";
  return (
    <section aria-label="Patrimônio" className="pt-2 pb-6">
      <div className="mb-4"><ScopeButton /></div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] text-muted">{s.closed ? "Patrimônio no encerramento" : "Patrimônio"}</p>
          <p className="num mt-1 text-[40px] font-bold leading-[1.05] tracking-tight">{f.money(s.equity)}</p>
          <p className="num mt-2 text-[17px] text-muted">≈ {f.btc(s.equity.toNumber() / (s.points.at(-1)?.price || s.now.btcUsd.toNumber()), 8)} BTC</p>
          {s.closed ? <p className="num mt-1.5 text-[17px] text-muted">Resultado do ciclo: <span className={toneCls(toneOf(s.result))}>{f.money(s.result, { signed: true })}</span></p>
          : <p className="num mt-1.5 text-[17px] text-muted">24H:{" "}
            {day ? <span className={toneCls(toneOf(day.money))}>{f.cash(day.money, { signed: true })} {day.money >= 0 ? "▴" : "▾"} {f.pct(day.pct)}</span> : <span>—</span>}
          </p>}
        </div>
        <button onClick={toggleHidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="mt-8 grid size-12 shrink-0 place-items-center rounded-full text-accent">
          {hidden ? <EyeOff className="size-7" strokeWidth={2.2} /> : <Eye className="size-7" strokeWidth={2.2} />}
        </button>
      </div>
      <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <span className={cn("size-2 rounded-full", s.closed ? "bg-muted" : hl ? (s.acc.liveFresh ? "bg-gain" : "bg-warn") : "bg-muted")} aria-hidden />
        {s.closed ? "Ciclo encerrado" : hl ? "Hyperliquid ao vivo" : "Lançamento manual"}{at ? ` · atualizado ${fmtRelative(at / 1000)}` : ""}
      </p>
    </section>
  );
}

function CcyToggle() {
  const { ccy, setCcy } = useAppState();
  return (
    <div role="radiogroup" aria-label="Moeda" className="flex rounded-full bg-surface p-1">
      {(["BRL", "USD"] as const).map((c) => (
        <button key={c} role="radio" aria-checked={ccy === c} onClick={() => setCcy(c)}
          className={cn("h-10 min-w-[64px] rounded-full px-4 text-[16px] font-bold transition-colors", ccy === c ? "bg-accent text-[#1f1a00]" : "text-muted")}>{c}</button>
      ))}
    </div>
  );
}

function MenuSheet({ onClose }: { onClose: () => void }) {
  const items = [
    { href: "/settings", label: "Conectar Hyperliquid / Rabby", icon: Link2 },
    { href: "/settings", label: "Ajustes e backup", icon: Settings },
  ];
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className="fade-in pt-safe fixed inset-y-0 left-0 z-50 w-[82%] max-w-[340px] bg-[#252526] shadow-2xl">
          <div className="flex h-16 items-center justify-between px-5">
            <Dialog.Title className="flex items-center gap-2.5 text-[17px] font-semibold"><Mark className="size-8" />BTC Terminal</Dialog.Title>
            <Dialog.Close aria-label="Fechar menu" className="-mr-2 grid size-11 place-items-center rounded-full text-muted"><X className="size-6" /></Dialog.Close>
          </div>
          <nav className="px-3">
            {items.map((i) => (
              <Link key={i.label} href={i.href} onClick={onClose} className="flex h-14 items-center gap-3 rounded-xl px-3 text-[16px] font-medium [@media(hover:hover)]:hover:bg-surface-3">
                <i.icon className="size-5 text-accent" aria-hidden /><span className="flex-1">{i.label}</span><ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            ))}
          </nav>
          <p className="absolute inset-x-0 bottom-0 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] text-[12px] leading-relaxed text-muted">Somente acompanhamento. O app não pede chave privada e não envia ordens.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 bg-bg/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-3xl items-center justify-between px-5">
          <button onClick={() => setMenu(true)} aria-label="Abrir menu" className="-ml-2 grid size-12 place-items-center rounded-full"><Menu className="size-8" strokeWidth={2} /></button>
          <CcyToggle />
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-3xl justify-between overflow-x-auto border-b border-line px-3 sm:justify-start sm:gap-2" aria-label="Principal">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={cn("relative shrink-0 px-2.5 pt-2 pb-3.5 text-[16px] font-medium whitespace-nowrap", active(n.href) ? "text-accent" : "text-ink")}>
              {n.label}
              {active(n.href) && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-accent" aria-hidden />}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+40px)]">{children}</main>
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
    </div>
  );
}
