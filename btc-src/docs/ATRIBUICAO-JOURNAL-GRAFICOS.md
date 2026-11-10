# Attribution, Trading Journal e gráficos de posição

Três funcionalidades ligadas entre si, todas **somente leitura** (nenhuma ordem é enviada, movida ou cancelada; nenhuma chave privada ou seed é pedida).

## Peças
- **Registro financeiro único** (`lib/attribution/ledger.ts`): cada resultado realizado, taxa, funding e recompensa é uma linha (`Rec`) com o id da operação (`tradeUid = conta|primeira execução`). Journal e Attribution somam as mesmas linhas, por isso os números batem e nada é contado duas vezes. Aportes, retiradas e transferências internas ficam em `FlowRec`, fora do resultado.
- **Portfolio Attribution** (`lib/attribution/engine.ts`, UI em `app/intel/attribution.tsx`, aba Performance Analytics): contribuição por ativo, spot × perp, realizado × não realizado, funding recebido/pago, taxas, cascata, evolução, por período, fluxos separados, filtros (ativo, exchange, conta, estratégia, mercado, período) na URL.
- **Trading Journal** (`app/journal/page.tsx`, `lib/journal/*`): operações agrupadas automaticamente (posição de 0 a 0), anotações (estratégia, tese, stop e TPs planejados, notas, nota pessoal, tags) em `portfolio().tradeNotes`, calendário, estatísticas, padrões (mín. 4 operações). O registro manual antigo continua na aba "Registro manual".
- **Gráfico da posição** (`/posicao?coin=&acc=[&trade=]`, `app/posicao/page.tsx`, `components/position-chart.tsx`): Lightweight Charts, velas + volume, MA/EMA/Bollinger/RSI/MACD, 1m a 1W, WebSocket da Hyperliquid com reconexão automática e consulta periódica de reserva, histórico para trás ao rolar, linhas de entrada/liquidação/TP/SL reais/mark, níveis **planejados** (tracejados, rotulados "planejado", só no app), marcadores das execuções reais (clicáveis), painel da posição, modo expandido e paisagem.

## Integrações
- Attribution → Journal: clicar num ativo abre `/diario?coin=…&from=…&to=…` (mesmo ativo e período) com a lista de operações; clicar numa operação abre a ficha.
- Journal → Attribution e gráfico: botões "Ver no Attribution" e "Ver gráfico"; a ficha mostra a contribuição da operação.
- Dashboard e Perpétuos: linhas/cartões de posição abrem `/posicao`; o cartão Performance Analytics ganhou resumo de contribuição (30 dias) e atalho para o Journal. A aba BTC/USDC não foi alterada.

## Dados e compatibilidade
- Novos campos opcionais em `PortfolioData` (`plans`, `tradeNotes`, `levelHistory`); chaves `bst.*` existentes preservadas. Histórico de fills é complementado uma vez (backfill sem descartar nada) para obter `oid` das execuções e tipos de ordem (`historicalOrders`).
- TP/SL reais vistos nas posições abertas são guardados por operação (`levelHistory`) e continuam no gráfico depois do fechamento.

## Limitações
- OKX: só saldo; sem histórico de operações não há atribuição por ativo (aviso na tela).
- Spot: custo médio por execuções reais de pares USDC; vendas acima do estoque conhecido ficam marcadas como parciais. Carteiras sem custo informado não têm P&L não realizado.
- Se a Hyperliquid limitar o histórico, operações antigas podem ter "entrada herdada" (avisado).
- Stop/TP executados só são identificados quando o `oid` da execução consta no histórico de ordens.
- Ordens/TP/SL reais dependem de a conta estar sincronizada; sem leitura, a tela avisa.
