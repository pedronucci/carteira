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
import { prices } from "@/lib/local/prices";
import { fmtDuration } from "@/lib/local/strategy";
import { ScopeButton } from "./strategy";
import { cn, Kpi, KpiGrid, Segmented, toneCls, toneOf } from "./ui";

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

/** Variação do BTC no dia (UTC), pelo candle diário. */
function useBtcDay() {
  const cd = prices().usd;
  const spot = prices().spot?.btcUsd ?? null;
  const prev = cd.length >= 2 ? cd[cd.length - 2]!.c : null;
  return { px: spot, chg: spot && prev ? spot / prev - 1 : null };
}

/** Faixa de status: origem dos dados, cotação do BTC e atualização. */
function StatusBar() {
  const q = useSnapshot();
  const s = q.data;
  const btc = useBtcDay();
  const f = useFmt();
  const hl = s?.acc.kind === "hl";
  const live = hl && s?.acc.liveFresh;
  const at = s && !s.closed ? s.live?.at ?? s.now.at : null;
  const state = !s ? "—" : s.closed ? "ENCERRADO" : live ? "AO VIVO" : hl ? "SEM SINAL" : "MANUAL";
  return (
    <div className="num flex h-8 items-center gap-3 overflow-hidden border-b border-line text-[11px] text-muted">
      <span className="flex shrink-0 items-center gap-1.5 font-semibold tracking-[0.06em]">
        <span className={cn("size-1.5 rounded-full", live ? "live-dot bg-gain" : hl && !s?.closed ? "bg-warn" : "bg-muted")} aria-hidden />
        <span className={live ? "text-gain" : hl && !s?.closed ? "text-warn" : ""}>{state}</span>
      </span>
      <span className="h-3 w-px shrink-0 bg-line-strong" aria-hidden />
      <span className="flex shrink-0 items-center gap-1.5"><span className="font-semibold text-btc">BTC</span><span className="text-ink-2">{btc.px ? f.px(btc.px) : "—"}</span>
        {btc.chg != null && <span className={toneCls(toneOf(btc.chg))}>{f.pct(btc.chg)}</span>}</span>
      {at && <><span className="h-3 w-px shrink-0 bg-line-strong" aria-hidden /><span className="truncate">atualizado {fmtRelative(at / 1000)}</span></>}
    </div>
  );
}

/** Topo das telas: seletor do ciclo, patrimônio e a faixa de indicadores do ciclo. */
export function Hero() {
  const q = useSnapshot();
  const f = useFmt();
  const { hidden, toggleHidden } = useAppState();
  const s = q.data;
  const day = useMemo(() => (s ? periodReturn(inCcy(s.points.slice(-4), f.ccy, f.fx), 1, true) : null), [s, f.ccy, f.fx]);
  if (!s) return <div className="pt-3 pb-4"><ScopeButton /></div>;
  const c = s.current;
  const lev = c?.effLeverage ?? null;
  const liqTone = c?.liqDist && c.liqDist.lt(s.s.settings.minLiqDistance) ? ("loss" as const) : null;
  return (
    <section aria-label="Patrimônio" className="pt-3 pb-5">
      <div className="flex items-center justify-between gap-2">
        <ScopeButton />
        <button onClick={toggleHidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} className="grid size-10 shrink-0 place-items-center rounded-md text-muted [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-ink">
          {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <p className="lbl">{s.closed ? "Patrimônio no encerramento" : "Patrimônio"}</p>
          <p className="num mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] lg:text-[38px]">{f.money(s.equity)}</p>
        </div>
        <p className="num pb-0.5 text-[13px] text-muted">≈ {f.btc(s.equity.toNumber() / (s.points.at(-1)?.price || s.now.btcUsd.toNumber()), 8)} BTC</p>
      </div>
      <KpiGrid className="mt-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label={s.closed ? "Resultado do ciclo" : s.scope.kind === "account" ? "Resultado" : "Resultado do ciclo"} tone={toneOf(s.result)}
          value={f.money(s.result, { signed: true })} sub={s.roc != null ? `${f.pct(s.roc)} s/ capital` : undefined} />
        <Kpi label="TWR" tone={toneOf(s.twr)} value={s.twr != null ? f.pct(s.twr) : "—"} sub="ponderado no tempo" />
        {s.closed ? <Kpi label="Duração" value={fmtDuration(s.endT - s.startT)} sub={`até ${new Date(s.endT).toLocaleDateString("pt-BR")}`} />
          : <Kpi label={day?.partial ? "Desde o início" : "24 h"} tone={toneOf(day?.money)} value={day ? f.cash(day.money, { signed: true }) : "—"} sub={day ? f.pct(day.pct) : undefined} />}
        {c ? <Kpi label="Exposição" tone={liqTone} value={lev != null ? `${lev.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}
          sub={c.liqDist ? `liquidação a ${f.pct(c.liqDist, false)}` : f.money(c.notional, { compact: true })} />
          : <Kpi label="Estado" value="100% USDC" sub={s.inUsdcSince ? `desde ${new Date(s.inUsdcSince).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : undefined} />}
      </KpiGrid>
    </section>
  );
}

function CcyToggle() {
  const { ccy, setCcy } = useAppState();
  return <Segmented size="sm" label="Moeda" value={ccy} onChange={setCcy} options={[{ value: "BRL", label: "BRL" }, { value: "USD", label: "USD" }]} />;
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
              <Link key={i.label} href={i.href} onClick={onClose} className="flex h-14 items-center gap-3 rounded-md px-3 text-[16px] font-medium [@media(hover:hover)]:hover:bg-surface-3">
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
  const tabs = (
    <nav className="no-scrollbar flex overflow-x-auto" aria-label="Principal">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
          className={cn("relative flex h-11 shrink-0 items-center px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-150", active(n.href) ? "text-ink" : "text-muted [@media(hover:hover)]:hover:text-ink-2")}>
          {n.label}
          {active(n.href) && <span className="absolute inset-x-3 bottom-0 h-[2px] bg-accent" aria-hidden />}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setMenu(true)} aria-label="Abrir menu" className="-ml-1.5 grid size-10 place-items-center rounded-md text-ink-2 [@media(hover:hover)]:hover:bg-surface-2"><Menu className="size-5" /></button>
          <span className="flex items-center gap-2"><Mark className="size-6" /><span className="text-[13px] font-semibold tracking-[0.08em]">BTC TERMINAL</span></span>
          <div className="ml-4 hidden lg:block">{tabs}</div>
          <div className="ml-auto"><CcyToggle /></div>
        </div>
        <div className="mx-auto max-w-6xl border-t border-line px-2 lg:hidden">{tabs}</div>
      </header>
      <div className="mx-auto max-w-6xl px-4 lg:px-6"><StatusBar /></div>
      <main className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+40px)] lg:px-6">{children}</main>
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
    </div>
  );
}
