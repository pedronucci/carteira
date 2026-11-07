import type { AnchorHTMLAttributes } from "react";
import { navigate } from "./router";
export default function Link({ href, onClick, ...p }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; scroll?: boolean }) {
  const internal = href.startsWith("/");
  return <a {...p} href={internal ? `#${href}` : href} onClick={(e) => { onClick?.(e); if (internal && !e.defaultPrevented) { e.preventDefault(); navigate(href); } }} />;
}
