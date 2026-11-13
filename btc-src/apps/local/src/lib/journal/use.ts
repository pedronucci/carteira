"use client";
/** Dados compartilhados do Trading Journal e do Portfolio Attribution: UMA montagem das operações e do registro financeiro. */
import { useEffect, useMemo } from "react";
import { usePerps, useDataVersion } from "@/lib/api";

import { getStore } from "@/lib/local/store";
import { portfolio } from "@/lib/portfolio/db";
import { buildJournalTrades, type JTrade } from "./trades";
import { buildAttrLedger, type AttrLedger } from "../attribution/ledger";
import { ensureSpotNames, spotNames, useSpotNames } from "../perps/spot-names";
import type { PerpsView } from "../perps/view";

export interface AttrData { perps: PerpsView; trades: JTrade[]; ledger: AttrLedger; strategyStart: number | null; ownAddresses: string[] }

export function useAttrData(): { data: AttrData | null; loading: boolean; error: string | null } {
  const q = usePerps();
  const ver = useDataVersion();
  const namesVer = useSpotNames();
  useEffect(() => { void ensureSpotNames(); }, []);
  const v = q.data;
  const data = useMemo<AttrData | null>(() => {
    if (!v) return null;
    let strategyStart: number | null = null;

    const notes = portfolio().tradeNotes ?? {};
    const own = new Set<string>();
    for (const a of v.accounts) if (a.address) own.add(a.address.toLowerCase());
    for (const a of portfolio().accounts) for (const x of (a as { addresses?: string[] }).addresses ?? []) own.add(x.toLowerCase());
    const addr = getStore().settings.hl?.address; if (addr) own.add(addr.toLowerCase());
    const trades = buildJournalTrades(v.accounts, notes, strategyStart);
    const ledger = buildAttrLedger({ accounts: v.accounts, trades, strategyStart, spotNames: spotNames(), ownAddresses: [...own] });
    return { perps: v, trades, ledger, strategyStart, ownAddresses: [...own] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ver, namesVer]);
  return { data, loading: q.loading, error: q.error?.message ?? null };
}
