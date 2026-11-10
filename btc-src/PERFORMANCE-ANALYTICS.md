# Performance Analytics (fase 1)

Aba "Performance Intelligence" renomeada para **Performance Analytics** (rota `/inteligencia` mantida; alias `/performance-analytics`). Sem redesign, painéis antigos preservados.

## Arquivos
- `packages/domain/src/portfolio.ts` — `PSnapshot.px` (ETH/SOL/HYPE p/ benchmarks)
- `apps/local/src/lib/portfolio/engine.ts` — snapshots gravam `px`
- `apps/local/src/lib/perps/view.ts` — expõe `funding`
- `apps/local/src/lib/analytics/analytics.ts` (+ `.test.ts`, 20 testes) — motor puro
- `apps/local/src/lib/analytics/use.ts` — hook `useAnalytics`
- `apps/local/src/app/intel/analytics.tsx` — UI; `intel/page.tsx` — título + seção
- `apps/local/src/components/nav.tsx`, `entry.tsx` — rótulo e alias
- `apps/local/src/app/dashboard/hub.tsx`, `dashboard/page.tsx` — widget `PerfAnalyticsCard`

## Funcionalidades
Seletor 24h/7d/30d/90d/Ano/Tudo/Datas; 10 indicadores; tabela por ativo ordenável; decomposição (bruto − funding − taxas); por origem (Hyperliquid/OKX/Carteiras/Outras) e Estratégia BTC vs Outros perpétuos; evolução + drawdown + benchmarks BTC/ETH/SOL (buy&hold com os mesmos fluxos); análise de perpétuos; metodologia.

## Metodologia / limites
- Aportes e retiradas nunca contam como lucro (TWR). closedPnl não inclui taxas/funding: cada um entra uma vez. P&L aberto fica fora do resultado (já está na equity); notional nunca somado.
- Sem dados suficientes → "Dados insuficientes" (nada reconstruído). Histórico patrimonial só existe desde o primeiro retrato.
- Benchmarks ETH/SOL só a partir de retratos com `px`.
- P&L realizado depende do histórico de fills da Hyperliquid estar completo.
- Testado só com dados de exemplo (sandbox sem acesso à HL).

## Dependências / custo
Nenhuma nova. Sem API externa, sem chave, sem custo.

## Deploy
`cd btc-src/apps/local && BST_OUT=<worktree>/btc node build.mjs`, commit em `main/btc/`. Só com autorização.

## Rollback
Branch de backup `backup/btc-pre-analytics`. Reverter o commit na main e rebuildar. Dados locais (snapshots) são retrocompatíveis (campo `px` opcional).

## Fase 2 (pendente)
Market Intelligence (`/mercado-intel`), Worker Cloudflare, Radar de Mercado.
