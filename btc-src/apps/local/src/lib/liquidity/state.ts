import { useSyncExternalStore } from "react";
import type { LPPosition } from "./types";
let positions: LPPosition[] = [];
const subs = new Set<() => void>();
export const lpPositions = () => positions;
export function setLPPositions(next: LPPosition[]) { positions = next; subs.forEach(f => f()); }
export const useLPPositions = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, lpPositions, () => positions);
