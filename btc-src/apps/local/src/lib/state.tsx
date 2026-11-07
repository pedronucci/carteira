"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { d, fmtMoney, fmtPct } from "@bst/domain";
import { prices } from "@/lib/local/prices";
import { getStore } from "@/lib/local/store";
import type { Ccy } from "@/lib/local/engine";

interface Prefs { hidden?: boolean; ccy?: Ccy }
const Ctx = createContext<{ hidden: boolean; toggleHidden: () => void; ccy: Ccy; setCcy: (c: Ccy) => void } | null>(null);
const KEY = "bst.prefs.v1";
const load = (): Prefs => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const save = (p: Prefs) => { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...p })); } catch { /* sem armazenamento */ } };

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => Boolean(load().hidden));
  const [ccy, setCcyS] = useState<Ccy>(() => load().ccy ?? "BRL");
  const value = useMemo(() => ({
    hidden, ccy,
    toggleHidden: () => setHidden((h) => { save({ hidden: !h }); return !h; }),
    setCcy: (c: Ccy) => { save({ ccy: c }); setCcyS(c); },
  }), [hidden, ccy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() { const c = useContext(Ctx); if (!c) throw new Error("AppStateProvider ausente"); return c; }

/** Câmbio atual (ao vivo ou manual). */
export const fxNow = (): number | null => prices().spot?.usdBrl ?? (getStore().settings.manualUsdBrl ? Number(getStore().settings.manualUsdBrl) : null);

type V = { toString(): string } | string | number | null | undefined;
type MO = { signed?: boolean; compact?: boolean; reveal?: boolean };
/** Formatadores que respeitam o modo privado e a moeda escolhida (BRL/USD). */
export function useFmt() {
  const { hidden, ccy } = useAppState();
  const fx = fxNow();
  const eff: Ccy = ccy === "BRL" && fx ? "BRL" : "USD";
  const sym = eff === "BRL" ? "R$" : "US$";
  /** Valor já na moeda de exibição. */
  const cash = useCallback((v: V, o: MO = {}) => (v == null ? "—" : hidden && !o.reveal ? `${sym} •••••` : fmtMoney(d(v.toString()), eff, o)), [hidden, eff, sym]);
  /** Valor em dólar, convertido para a moeda de exibição. */
  const money = useCallback((v: V, o: MO = {}) => (v == null ? "—" : cash(eff === "BRL" ? d(v.toString()).mul(fx!) : v, o)), [cash, eff, fx]);
  const usd = useCallback((v: V, o: MO = {}) => (v == null ? "—" : hidden && !o.reveal ? "US$ •••••" : fmtMoney(d(v.toString()), "USD", o)), [hidden]);
  const brl = useCallback((v: V, fxv: V, o: { compact?: boolean } = {}) => (v == null || fxv == null ? null : hidden ? "R$ •••••" : fmtMoney(d(v.toString()).mul(fxv.toString()), "BRL", o)), [hidden]);
  const px = useCallback((v: V) => (v == null ? "—" : fmtMoney(d(v.toString()), "USD")), []);
  const pct = useCallback((v: V, signed = true) => (v == null ? "—" : fmtPct(d(v.toString()), { signed })), []);
  const btc = useCallback((v: V, digits = 6) => (v == null ? "—" : hidden ? "•••" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: Math.min(4, digits), maximumFractionDigits: digits }).format(Number(v))), [hidden]);
  return { usd, brl, px, pct, btc, money, cash, hidden, ccy: eff, fx: eff === "BRL" ? fx! : 1, sym };
}
