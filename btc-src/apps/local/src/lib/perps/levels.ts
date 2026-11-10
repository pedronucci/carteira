/** Memória dos TP/SL reais vistos durante uma operação (puro). */
import type { HistoricLevel } from "./chart-lines";
import type { LevelOrder } from "./orders";

/** Atualiza o histórico com as ordens atuais: as presentes ficam ativas; as que sumiram ficam inativas (e guardadas). */
export function mergeLevelHistory(prev: HistoricLevel[], current: LevelOrder[], now: number): HistoricLevel[] {
  const byOid = new Map(prev.map((h) => [h.oid, h]));
  const seen = new Set<number>();
  for (const o of current) {
    seen.add(o.oid);
    const old = byOid.get(o.oid);
    byOid.set(o.oid, { oid: o.oid, kind: o.kind, price: o.price, qty: o.qty, firstSeen: old?.firstSeen ?? now, lastSeen: now, active: true });
  }
  for (const [oid, h] of byOid) if (!seen.has(oid) && h.active) byOid.set(oid, { ...h, active: false });
  return [...byOid.values()].sort((a, b) => a.firstSeen - b.firstSeen || a.oid - b.oid);
}
export const sameLevels = (a: HistoricLevel[], b: HistoricLevel[]) =>
  a.length === b.length && a.every((x, i) => { const y = b[i]!; return x.oid === y.oid && x.price === y.price && x.qty === y.qty && x.active === y.active && x.firstSeen === y.firstSeen; });
