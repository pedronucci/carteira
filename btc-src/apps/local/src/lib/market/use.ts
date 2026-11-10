"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePerps, usePortfolio } from "../api";
import { toast } from "@/components/toaster";
import { miState, markAlertsSeen, refreshMi, subscribeMi } from "./feed";
import { classify, impactCards, NO_HELD, relevance, type Held, type ImpactCard, type Tagged } from "./radar";

export type Scored = Tagged & { score: number; level: "alta" | "media" | "baixa" };
/** Estado do Market Intelligence + cálculos por regras com o portfólio local. Atualiza a cada 5 min enquanto o app está aberto. */
export function useMarketIntel(opts: { poll?: boolean } = {}) {
  const st = useSyncExternalStore(subscribeMi, miState, miState);
  const pv = usePortfolio().data ?? null;
  const perps = usePerps().data ?? null;
  useEffect(() => {
    void refreshMi();
    if (!opts.poll) return;
    const t = setInterval(() => void refreshMi(), 5 * 60e3);
    return () => clearInterval(t);
  }, [opts.poll, st.proxyUrl]);
  const held = useMemo<Held>(() => {
    if (!pv) return NO_HELD;
    const spot: Record<string, number> = {};
    for (const a of pv.c.assets) if (a.valueUsd != null) spot[a.symbol] = (spot[a.symbol] ?? 0) + a.valueUsd;
    return { equity: pv.c.totalUsd, effLeverage: perps?.summary?.effLeverage ?? null, spot, perps: (perps?.positions ?? []).map((p) => ({ coin: p.coin, dir: p.dir, notional: p.notional, leverage: p.leverage, liqDistance: p.liqDistance })) };
  }, [pv, perps]);
  const out = useMemo(() => {
    const now = Date.now();
    const news: Scored[] = st.news.map(classify).map((n) => ({ ...n, ...relevance(n, held, now) })).filter((n) => n.score > 0).sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
    const cards: ImpactCard[] = impactCards(held, st.events, news, now).filter((c) => !st.dismissed.includes(c.id));
    return { now, news, cards, upcoming: st.events.filter((e) => e.start >= now - 3600e3).slice(0, 40) };
  }, [st.news, st.events, st.dismissed, held]);
  const alerts = out.cards.filter((c) => c.severity === "alta");
  const unseen = alerts.filter((c) => !st.seenAlerts.includes(c.id));
  // toast só quando há alerta novo e o usuário não desligou os alertas (apenas dentro do app)
  const key = unseen.map((c) => c.id).join("|");
  useEffect(() => {
    if (!opts.poll || !st.alertsOn || !unseen.length) return;
    toast(unseen.length === 1 ? `Radar de Mercado: ${unseen[0]!.title}` : `Radar de Mercado: ${unseen.length} alertas novos`, "neutral");
    markAlertsSeen(unseen.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.poll, st.alertsOn]);
  return { st, held, ...out, alerts, unseen };
}
export type MarketIntel = ReturnType<typeof useMarketIntel>;
