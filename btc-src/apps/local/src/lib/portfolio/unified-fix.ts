/**
 * Correção única dos retratos antigos do portfólio: nas contas Hyperliquid unificadas o P&L aberto era somado ao saldo
 * spot, que já o inclui (dupla contagem). Cada retrato guarda o P&L aberto por posição, então dá para desfazer com
 * exatidão: valor certo = valor gravado − P&L aberto da conta. Retratos corrigidos (ou novos) levam `uf: 1`.
 */
import type { PSnapshot } from "@bst/domain";

/** conta do portfólio → { prefixo do id das posições perpétuas, modo da conta agora } */
export interface UnifiedAccountRef { portfolioId: string; perpAccountId: string; unified: boolean }

const r2 = (x: number) => Math.round(x * 100) / 100;

export function fixUnifiedSnapshots(snaps: PSnapshot[], accounts: UnifiedAccountRef[]): { snapshots: PSnapshot[]; changed: number } {
  let changed = 0;
  const out = snaps.map((s) => {
    if (s.uf === 1) return s;
    let adj = 0;
    const byAccount = { ...s.byAccount };
    for (const a of accounts) {
      if (!a.unified || byAccount[a.portfolioId] == null) continue;
      const upnl = (s.perps?.positions ?? []).filter((p) => p.id.startsWith(`${a.perpAccountId}|`)).reduce((x, p) => x + p.upnl, 0);
      if (!upnl) continue;
      byAccount[a.portfolioId] = r2(byAccount[a.portfolioId]! - upnl);
      adj -= upnl;
    }
    changed++;
    if (!adj) return { ...s, uf: 1 as const };
    const byAsset = s.byAsset ? { ...s.byAsset, USDC: r2((s.byAsset.USDC ?? 0) + adj) } : s.byAsset;
    return {
      ...s, uf: 1 as const, byAccount, byAsset, total: s.total != null ? r2(s.total + adj) : s.total,
      btcEq: s.btcEq != null && s.btcUsd ? s.btcEq + adj / s.btcUsd : s.btcEq,
    };
  });
  return { snapshots: out, changed };
}
