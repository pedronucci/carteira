import { createRoot } from "react-dom/client";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell";
import Overview from "@/app/page";
import Operations from "@/app/operations/page";
import Performance from "@/app/performance/page";
import Market from "@/app/market/page";
import Settings from "@/app/settings/page";
import { splitUrl, useUrl } from "@/lib/router";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": Overview, "/operations": Operations, "/performance": Performance, "/market": Market, "/settings": Settings,
};
function App() {
  const { path } = splitUrl(useUrl());
  const P = PAGES[path] ?? Overview;
  return <AppShell><P key={path} /></AppShell>;
}
createRoot(document.getElementById("root")!).render(<Providers><App /></Providers>);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
