# Inventário de não-regressão (base: versão 4, commit 7339ebf)

Tudo o que está aqui precisa continuar funcionando no Terminal 5.0. A coluna "Teste" indica onde o
comportamento está fixado automaticamente; "manual" significa conferência visual a cada fase.

| # | Funcionalidade | Teste |
|---|---|---|
| 1 | Ciclos: nome, início com hora e fuso, retrato inicial travado, novo ciclo encerra o anterior | `strategy.test.ts`, `regressao.test.ts` |
| 2 | Janela do ciclo: nada antes do início entra no resultado | `regressao.test.ts` ("só eventos do ciclo") |
| 3 | Resultado, capital, retorno sobre o capital e TWR do ciclo de 05/11/2026 21:13 | `regressao.test.ts`, `ciclo-nov2026.test.ts` |
| 4 | Buy & Hold com o patrimônio inicial e os mesmos aportes | `regressao.test.ts`, `strategy.test.ts` |
| 5 | Posição: tamanho, preço médio, alavancagem efetiva, liquidação, tempo na posição | `regressao.test.ts` |
| 6 | Lançamentos manuais: entrar, aumentar (preço médio), sair, aportes e retiradas, editar e apagar | manual + `strategy.test.ts` |
| 7 | Hyperliquid só leitura: saldos, posição, liquidação oficial, histórico bruto sem duplicar, CSV | `strategy.test.ts` (dedupe) + manual |
| 8 | BRL/USD com o câmbio de cada data; modo privacidade | manual |
| 9 | Backup: baixar, copiar, restaurar; cópias automáticas; backup inválido não altera nada | `regressao.test.ts` |
| 10 | Migração v1 → v3 preservando a original | `regressao.test.ts` |
| 11 | Abrir o app não altera os dados salvos | `regressao.test.ts` |
| 12 | PWA offline; iPhone (área segura, campos de 16 px sem zoom) | manual |
| 13 | Mercado: gráfico com MM50 e MM200, indicadores, leitura de cenário, simulador de entrada | manual |
| 14 | Somente acompanhamento: nenhuma ordem, nenhuma chave privada, nenhuma frase de recuperação | revisão de código |

## Cópia íntegra da versão 4
- Commit `7339ebf` na `main` (app publicado em `btc/` + fonte em `btc-src/`). Para criar uma tag de
  referência no GitHub: Releases → Draft a new release → tag `v4-final` → target `7339ebf`.
- Para voltar: publicar o conteúdo de `btc/` dessa tag na `main`. Os dados no aparelho continuam compatíveis.

## Cobertura dos testes obrigatórios (seção 23 do pedido do Terminal 5.0)
| Tema | Onde |
|---|---|
| Hyperliquid (execuções, deduplicação, conta unificada, retrato) | `apps/local/test/strategy.test.ts`, `regressao.test.ts`, `portfolio-app.test.ts` |
| OKX (assinatura, permissões, credenciais inválidas, limite, revogação, normalização funding/trading/Earn) | `apps/gateway/test/gateway.test.ts` |
| Consolidação entre exchanges, transferências internas, prevenção de dupla contagem | `packages/domain/test/portfolio.test.ts` |
| Depósitos e retiradas, TWR, retorno sobre o capital | `ciclo-nov2026.test.ts`, `regressao.test.ts`, `portfolio.test.ts` |
| LONG/SHORT, parciais, reversões, funding, taxas, equity, preço médio | `motor-v2.test.ts`, `strategy.test.ts` |
| BTC equivalente, Buy & Hold, ciclos, posições herdadas | `ciclo-nov2026.test.ts`, `regressao.test.ts`, `motor-v2.test.ts` |
| Falhas de API, dados incompletos, rate limiting | `conectores.test.ts`, `bitcoin.test.ts`, `gateway.test.ts` |
| Migração de dados e backup | `regressao.test.ts`, `portfolio-app.test.ts` |
| Risco, cenários, alertas, desempenho | `packages/domain/test/intel.test.ts`, `apps/local/test/fase5.test.ts` |
| Responsividade e compatibilidade mobile | verificação automática de estouro de layout em 13 rotas × 390/768/1280 px (sem estouro, sem erro de JS) e conferência visual |

Total em 07/11/2026: 151 testes (58 núcleo + 70 app + 23 gateway).
