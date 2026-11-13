import "@/lib/demo-seed";
import { createRoot } from "react-dom/client";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/nav";
import Simulator from "@/app/simulador/page";
import Dashboard from "@/app/dashboard/page";
import Market from "@/app/market/page";
import Settings from "@/app/settings/page";
import Risk from "@/app/risk/page";
import Intel from "@/app/intel/page";
import MercadoIntel from "@/app/mercado-intel/page";
import Journal from "@/app/journal/page";
import Alerts from "@/app/alerts/page";
import Portfolio from "@/app/portfolio/page";
import Perps from "@/app/perps/page";
import Position from "@/app/posicao/page";
import { splitUrl, useUrl } from "@/lib/router";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": Dashboard, "/simulador": Simulator,
  "/mercado": Market, "/ajustes": Settings,
  "/portfolio": Portfolio, "/perpetuos": Perps, "/posicao": Position, "/trading": Perps, "/risco": Risk, "/inteligencia": Intel, "/performance-analytics": Intel, "/mercado-intel": MercadoIntel, "/diario": Journal, "/alertas": Alerts,
};
/** Endereços da versão 4 (favoritos e atalhos antigos continuam funcionando). */
const ALIAS: Record<string, string> = { "/performance": "/inteligencia", "/operations": "/diario", "/market": "/mercado", "/settings": "/ajustes" };

function App() {
  const raw = splitUrl(useUrl()).path;
  const path = raw.startsWith("/estrategia") ? "/perpetuos" : ALIAS[raw] ?? raw;
  const P = PAGES[path] ?? Dashboard;
  return <AppShell><P key={path} /></AppShell>;
}
createRoot(document.getElementById("root")!).render(<Providers><App /></Providers>);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
