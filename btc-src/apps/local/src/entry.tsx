import { createRoot } from "react-dom/client";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/nav";
import Dashboard from "@/app/dashboard/page";
import StrategyMonitor from "@/app/page";
import Operations from "@/app/operations/page";
import Performance from "@/app/performance/page";
import Market from "@/app/market/page";
import Settings from "@/app/settings/page";
import { Pending } from "@/app/pending";
import Cycles from "@/app/cycles/page";
import { splitUrl, useUrl } from "@/lib/router";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": Dashboard,
  "/estrategia": StrategyMonitor, "/estrategia/performance": Performance, "/estrategia/transacoes": Operations, "/estrategia/ciclos": Cycles,
  "/mercado": Market, "/ajustes": Settings,
  "/portfolio": () => <Pending path="/portfolio" />, "/trading": () => <Pending path="/trading" />, "/risco": () => <Pending path="/risco" />,
  "/inteligencia": () => <Pending path="/inteligencia" />, "/diario": () => <Pending path="/diario" />,
};
/** Endereços da versão 4 (favoritos e atalhos antigos continuam funcionando). */
const ALIAS: Record<string, string> = { "/performance": "/estrategia/performance", "/operations": "/estrategia/transacoes", "/market": "/mercado", "/settings": "/ajustes" };

function App() {
  const raw = splitUrl(useUrl()).path;
  const path = ALIAS[raw] ?? raw;
  const P = PAGES[path] ?? Dashboard;
  return <AppShell><P key={path} /></AppShell>;
}
createRoot(document.getElementById("root")!).render(<Providers><App /></Providers>);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
