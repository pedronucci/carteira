# Bitcoin Strategy Terminal — código-fonte

Gera o app publicado em `btc/` (arquivo único `index.html` + PWA).

## Requisitos
- Node 22+
- pnpm 10 (`corepack enable` ou `npx pnpm@10.28.0`)

## Comandos
```bash
cd btc-src
pnpm install
pnpm test        # testes (vitest): pacote @bst/domain e motor de ciclos da estratégia
pnpm typecheck   # TypeScript
pnpm build       # gera apps/local/dist/ (index.html, sw.js, manifest, ícones)
```

Para publicar, copie o conteúdo de `apps/local/dist/` para `../btc/`.

## Terminal 5.0 — documentação
- `docs/AUDITORIA.md` · `docs/INVENTARIO.md` (não-regressão e cobertura de testes) · `docs/CALCULOS.md` (fórmulas)
- `docs/ARQUITETURA.md` · `docs/DESIGN-BRIEF.md` · `docs/GATEWAY.md` (OKX) · `docs/ALERTAS.md` · `docs/PUBLICACAO.md`

## Estrutura
- `apps/local/` — o app (React 19, Tailwind 4, esbuild; `build.mjs` monta o HTML único)
  - `src/lib/local/strategy.ts` — motor puro dos ciclos da estratégia (testado em `test/strategy.test.ts`)
  - `src/lib/local/engine.ts` — liga conta (Hyperliquid ou manual), ciclo e preços
  - `src/lib/local/hl.ts` — leitura pública da Hyperliquid e histórico bruto sem duplicatas
  - `src/lib/local/snapshot.ts` — retrato inicial do ciclo (ao vivo, reconstruído ou manual)
- `packages/domain/` — núcleo financeiro (`@bst/domain`): indicadores, consolidação do portfólio, risco, desempenho, alertas
- `apps/gateway/` — gateway seguro (Cloudflare Worker): app + API privada somente leitura (OKX, Solana SPL), atrás do Cloudflare Access
- `apps/local/src/lib/connectors/` — Bitcoin (mempool.space, xpub local), EVM/Rabby (RPC público), Solana, OKX (pelo gateway)
- `apps/local/src/lib/portfolio/` — Portfólio Consolidado (IndexedDB `bst5`)
