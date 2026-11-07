"use client";
import { useEffect, type ReactNode } from "react";
import { AppStateProvider } from "@/lib/state";
import { Toaster, toast } from "@/components/toaster";
import { ensureHistory, refreshSpot } from "@/lib/local/prices";
import { getStore, subscribeStore } from "@/lib/local/store";
import { hlState, refreshHistory, refreshLive } from "@/lib/local/hl";
import { tsOf } from "@/lib/local/engine";
import { setPricesLoading } from "@/lib/api";
import { loadPortfolio } from "@/lib/portfolio/db";
import { recordSnapshot, refreshPortfolioPrices } from "@/lib/portfolio/engine";
import { syncAllAccounts } from "@/lib/connectors";

/** Cotação a cada 60 s e sempre que o app volta para a tela. */
function PriceLoop() {
  useEffect(() => {
    let alive = true;
    const s = getStore();
    const first = Math.min(...[s.initial?.date, ...s.cycles.map((c) => c.openedAt), ...s.flows.map((f) => f.date)].filter(Boolean).map((x) => tsOf(x!)), ...s.strategies.map((x) => x.startAt / 1000), Date.now() / 1000);
    const tick = async () => {
      try {
        const sp = await refreshSpot();
        if (alive && sp.stale && sp.error) toast("Sem conexão: usando a última cotação salva.", "neutral");
      } finally { setPricesLoading(false); }
    };
    tick();
    ensureHistory(first).catch(() => toast("Não deu para baixar o histórico de preços agora. Tento de novo depois.", "neutral"));
    const id = setInterval(tick, 60_000);
    const vis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return null;
}

/** Conta da Hyperliquid: saldo e posição a cada 20 s; histórico a cada 5 min. */
export function syncHlNow(full = true) {
  const st = getStore().settings.hl;
  if (!st?.address) return Promise.resolve();
  const btc = () => import("@/lib/local/prices").then((m) => m.prices().spot?.btcUsd ?? null);
  return btc().then(async (btcUsd) => {
    await refreshLive(st.address, { includeArb: st.includeArb, btcUsd });
    if (full) {
      await refreshHistory(st.address, { includeArb: st.includeArb });
      const h = hlState().history;
      const t = Math.min(...[...(h?.fills ?? []).map((f) => f.time), ...(h?.ledger ?? []).map((l) => l.time)].filter(Boolean), Date.now());
      await ensureHistory(Math.floor(t / 1000)).catch(() => undefined);
    }
  });
}
function HlLoop() {
  useEffect(() => {
    let addr = getStore().settings.hl?.address ?? null;
    let lastFull = 0;
    const tick = () => {
      if (!getStore().settings.hl?.address || document.visibilityState !== "visible") return;
      const full = Date.now() - lastFull > 5 * 60e3;
      if (full) lastFull = Date.now();
      syncHlNow(full).catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 20_000);
    const vis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", vis);
    const un = subscribeStore(() => { const a = getStore().settings.hl?.address ?? null; if (a !== addr) { addr = a; lastFull = 0; tick(); } });
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); un(); };
  }, []);
  return null;
}

/** Portfólio: carrega o banco local, atualiza cotações a cada 5 min e guarda um retrato por hora. */
function PortfolioLoop() {
  useEffect(() => {
    let alive = true;
    const tick = async () => { await refreshPortfolioPrices(); if (alive) recordSnapshot(); };
    let lastSync = 0;
    const syncTick = async () => { if (document.visibilityState !== "visible" || Date.now() - lastSync < 10 * 60e3) return; lastSync = Date.now(); await syncAllAccounts(); if (alive) recordSnapshot(); };
    loadPortfolio().then(async () => { await tick(); await syncTick(); });
    const id = setInterval(() => { void tick(); void syncTick(); }, 5 * 60e3);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return <AppStateProvider><PriceLoop /><HlLoop /><PortfolioLoop />{children}<Toaster /></AppStateProvider>;
}
