"use client";
import { useEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Número que desliza até o novo valor (some com "reduzir movimento"). */
export function useCountUp(target: number | null, ms = 650): number | null {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target == null || from.current == null || reduced() || from.current === target) { from.current = target; setV(target); return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3), cur = a + (target - a) * e;
      from.current = cur; setV(cur);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** "up" ou "down" por 700 ms depois de o valor mudar (para piscar o preço). */
export function useFlash(value: number | null | undefined): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value == null || prev.current == null || value === prev.current) { prev.current = value; return; }
    setDir(value > prev.current ? "up" : "down");
    prev.current = value;
    const id = setTimeout(() => setDir(null), 700);
    return () => clearTimeout(id);
  }, [value]);
  return dir;
}
