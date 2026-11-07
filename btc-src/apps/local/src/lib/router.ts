/** Roteamento por hash (#/operacoes): funciona no GitHub Pages, com voltar do navegador e favoritos. */
import { useSyncExternalStore } from "react";
const read = () => { const h = location.hash.replace(/^#/, "") || "/"; return h.startsWith("/") ? h : `/${h}`; };
export function navigate(to: string) {
  const next = `#${to.startsWith("/") ? to : `/${to}`}`;
  if (location.hash !== next) location.hash = next;
  try { window.scrollTo({ top: 0 }); } catch { /* ignore */ }
}
export const replaceUrl = (to: string) => { history.replaceState(null, "", `#${to}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
export function useUrl() {
  return useSyncExternalStore((f) => { window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, read, () => "/");
}
export const splitUrl = (u: string) => { const [p, q = ""] = u.split("?"); return { path: p!.split("#")[0]!.replace(/\/+$/, "") || "/", search: q.split("#")[0]! }; };
