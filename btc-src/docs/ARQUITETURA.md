# Arquitetura

```
btc-src/
├─ packages/domain        @bst/domain: indicadores, formatação e risco (decimal.js), testado
└─ apps/local             o app (React 19 + Tailwind 4, empacotado por esbuild em um único index.html)
   ├─ build.mjs           gera dist/ (index.html, sw.js, manifest, ícones)
   ├─ src/lib/local
   │  ├─ strategy.ts      motor puro dos ciclos (replay, TWR, quedas, fuso)
   │  ├─ engine.ts        junta conta (manual ou Hyperliquid), ciclo e preços → compute()
   │  ├─ store.ts         dados no localStorage + cópias automáticas
   │  ├─ snapshot.ts      retrato inicial do ciclo (ao vivo, reconstruído ou manual)
   │  ├─ hl.ts            leitura pública da Hyperliquid (somente leitura)
   │  └─ prices.ts        cotações (Binance, CoinGecko, AwesomeAPI, alternative.me)
   ├─ src/app             telas: Alocação, Performance, Transações, Mercado, Ajustes
   └─ src/components      UI: ui.tsx (painéis, KPIs, régua de risco), charts, formulários
```

## Publicação
`pnpm build` → copiar `apps/local/dist/*` para `../btc/`. O GitHub Pages publica `btc/` a partir da branch `main`.

## Dados (só no aparelho)
| Chave | Conteúdo |
|---|---|
| `bst.local.v2` | lançamentos, ciclos e ajustes (schema v3) |
| `bst.local.v2.bak` | cópia intacta feita antes da migração v2 → v3 |
| `bst.local.v2.auto` | até 12 cópias automáticas: antes de editar, apagar, restaurar ou migrar, e a cada 6 h de uso |
| `bst.hl.v2` | histórico bruto da Hyperliquid (sem duplicatas) |
| `bst.prices.v1`, `bst.prefs.v1` | cotações em cache e preferências |

Esta versão **não muda o formato dos dados**: não há migração. Os campos novos são calculados na hora.

## Visual
Tema escuro, amarelo de destaque e laranja do BTC, como antes. Números em JetBrains Mono (só o subconjunto latino,
embutido), textos em Inter. Painéis com borda fina e cantos de 8 px. Faixa de status no topo. Indicadores em grade.
Régua de risco no lugar do semicírculo. Em telas largas, painel em colunas. Direção registrada em `docs/DESIGN-BRIEF.md`.
