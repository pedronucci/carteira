# Visão Geral 5.1 — Perpétuos e evolução patrimonial

Somente leitura. Nada publicado: tudo está na branch `claude/btc-visao-geral`. Backup do estado anterior: branch `backup/btc-pre-visao-geral`.

## O que mudou
- **Visão Geral** (`apps/local/src/app/dashboard/`): 4 indicadores (Patrimônio, P&L dos perpétuos, Equivalente em BTC, Rentabilidade TWR), tabela de posições perpétuas (cartões no iPhone), evolução do patrimônio com período 24h/7d/30d/90d/1a/Tudo e moeda USD/BRL/BTC, margem e alavancagem, LONG vs SHORT, funding e taxas, alocação, desempenho por ativo, resumo Hyperliquid por conta, cartão da Estratégia BTC/USDC (inalterado) e integrações com estado real. Widgets antigos (risco, buy & hold, mercado, movimentações, alertas, conexões) continuam abaixo.
- **Snapshots v2** (`packages/domain/src/snapshots.ts`, `lib/portfolio/engine.ts#buildSnapshot`): total, por conta, por ativo, BTC equivalente, preço do BTC e câmbio, perpétuos (P&L aberto, notional, margem, posições) e status de conciliação. Um por hora, sem duplicar; `force` substitui o da mesma hora.
- **Migração**: ao carregar, retratos v1 (só `byAccount`) viram v2 (`total` calculado, campos novos ausentes) e duplicatas da mesma hora são removidas. Nenhum valor é inventado: períodos sem retrato aparecem como "incompleto"/"Não disponível".
- **Rentabilidade**: TWR sem aportes/retiradas (pendentes contam como aporte). Variação bruta, fluxos e resultado são mostrados separados.
- **Portfólio → Evolução**: tabela por período (bruta, fluxos, resultado, TWR, só BTC) e histórico dos retratos.
- **Navegação**: ordem Início / Perpétuos / Portfólio / Estratégia BTC / Mais; paleta Institutional Future (#090E16, #111A27, #172334, #42D9D0, #D7B36A).

## Regras contábeis mantidas
Equity da Hyperliquid entra uma vez; notional nunca entra no patrimônio nem na alocação; Estratégia BTC/USDC independente dos demais perpétuos; app "Carteira no Bolso" intocado.

## Testes
`packages/domain/test/snapshots.test.ts` (migração, duplicatas, histórico incompleto, fluxos, BRL/BTC) e `apps/local/src/lib/dashboard/hub.test.ts` (LONG/SHORT, alocação, margem, ROI). Rodar: `pnpm test` e `pnpm typecheck` em `btc-src`.

## Publicar / reverter
Publicar só com autorização: build (`node build.mjs`) copiado para `btc/` no main. Reverter: restaurar `btc/` a partir de `backup/btc-pre-visao-geral`. Os retratos v2 são compatíveis com versões anteriores (campos opcionais).
