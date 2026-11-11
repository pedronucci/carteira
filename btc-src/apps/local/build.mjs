// Gera dist/: index.html (arquivo único) + manifest, service worker e ícones para o GitHub Pages.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, process.env.BST_OUT ?? "dist"), tmp = resolve(here, ".tmp");
mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });

const globals = readFileSync(resolve(here, "src/app/globals.css"), "utf8").replace(/^@import .*$/gm, "");
writeFileSync(resolve(tmp, "tw.full.css"), readFileSync(resolve(here, "tw.css"), "utf8").replace("./src", "../src") + "\n" + globals);
const require = createRequire(import.meta.url);
const twCli = resolve(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist/index.mjs");
execFileSync(process.execPath, [twCli,"-i", resolve(tmp, "tw.full.css"), "-o", resolve(tmp, "tw.css"), "--minify"], { stdio: "inherit" });

await build({
  entryPoints: { app: resolve(here, "src/entry.tsx"), fonts: resolve(here, "fonts.css") },
  bundle: true, minify: !process.env.NOMIN, format: "esm", platform: "browser", target: "es2022", outdir: tmp,
  jsx: "automatic", tsconfig: resolve(here, "tsconfig.json"),
  alias: { "next/link": resolve(here, "src/lib/next-link.tsx"), "next/navigation": resolve(here, "src/lib/next-navigation.ts") },
  define: { "process.env.NODE_ENV": '"production"', "process.env.BST_DEMO": JSON.stringify(process.env.BST_DEMO ?? "") },
  loader: { ".webp": "dataurl", ".woff2": "dataurl", ".woff": "dataurl" },
  logLevel: "warning", legalComments: "none",
});


const esc = (s) => s.replace(/<\/script/gi, "<\\/script");
const css = readFileSync(resolve(tmp, "fonts.css"), "utf8") + readFileSync(resolve(tmp, "tw.css"), "utf8") + (() => { try { return readFileSync(resolve(tmp, "app.css"), "utf8"); } catch { return ""; } })();
const js = readFileSync(resolve(tmp, "app.js"), "utf8");
const VERSION = createHash("sha256").update(css).update(js).update(readFileSync(resolve(here, "public/sw.js"))).digest("hex").slice(0, 16);
const html = `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#090e16">
<script>try{var p=JSON.parse(localStorage.getItem("bst.prefs.v1")||"{}"),t=p.theme==="light"?"light":"dark";document.documentElement.dataset.theme=t;if(t==="light")document.querySelector('meta[name="theme-color"]').setAttribute("content","#f3f6fa")}catch(e){}</script>
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BTC Terminal">
<meta name="description" content="Bitcoin Strategy Terminal — acompanhamento da estratégia USDC ↔ BTC. Dados salvos só no aparelho.">
<meta name="robots" content="noindex">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-180.png">
<link rel="icon" type="image/png" href="./favicon.png">
<link rel="icon" type="image/svg+xml" href="./icon.svg">
<title>Bitcoin Strategy Terminal</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript>Ative o JavaScript para usar o terminal.</noscript>
<!-- versão ${VERSION} -->
<script type="module">${esc(js)}</script>
</body>
</html>`;
writeFileSync(resolve(out, "index.html"), html);
writeFileSync(resolve(out, "sw.js"), readFileSync(resolve(here, "public/sw.js"), "utf8").replace("__VERSION__", VERSION));
for (const f of ["manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "favicon.png", "icon.svg"]) copyFileSync(resolve(here, "public", f), resolve(out, f));
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB · versão ${VERSION}`);
