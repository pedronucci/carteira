# Auditoria — Bitcoin Strategy Terminal (07/11/2026)

Base auditada: `btc/index.html`, commit `d92791c` (bundle compilado; o código-fonte não estava no repositório).

## Achados críticos
- **Código-fonte fora do controle de versão.** Só o bundle compilado é publicado. Os testes vitest citados no commit não estão no repositório. Solução: trazer o fonte para `btc-src/`.

## Ciclos: mistura com o histórico anterior ao início
1. O card da posição herdada usa `cumFunding.sinceOpen` da Hyperliquid, que inclui funding anterior ao ciclo.
2. O resultado do ciclo é "saldo oficial da conta − aportes". P&L de outras moedas, tokens spot e erros do retrato inicial entram na estratégia.
3. O último ponto da série é trocado pelo saldo oficial, e essa diferença contamina o TWR e a variação do dia.
4. Editar um ciclo (até só renomear) recalcula e substitui o retrato inicial: um retrato "ao vivo" pode virar "reconstruído".

## Cálculos
5. A série diária começa no fechamento UTC do dia de início, não no instante do início. O TWR e o drawdown ignoram o primeiro dia parcial, e os aportes desse dia ficam com fluxo zero.
   - **Confirmado nas capturas:** 24H e "Total" mostram −2,65%, enquanto o resultado real é −1,62%. A perda (US$ 211,93) foi dividida pelo patrimônio antes do depósito de US$ 5.103,58.
6. O preço inicial vem do fechamento do candle de 1 h (até 59 min depois do início) e mistura o spot da Binance com o mark da Hyperliquid.
7. O início é arredondado para o minuto, mas o retrato ao vivo pode ter até 10 min de atraso. Execuções nesse intervalo podem ser duplicadas ou ficar de fora.
8. Ciclo encerrado é avaliado pelo fechamento diário, não pelo preço no momento do encerramento.
9. A reconstrução do patrimônio interpola o valor da conta em linha reta, mesmo com posição aberta.
10. O motor usa `Number` (ponto flutuante). Os dias são cortados em UTC, e não no fuso do ciclo.
    - **Confirmado nas capturas:** o gráfico começa em "04 de nov" para um ciclo iniciado em 05/11 às 21:13 (BRT), que já é 06/11 em UTC.
11. "Dias no ciclo" mostra 0 para uma posição aberta há mais de 19 h, por arredondamento para baixo de dias inteiros.

## Hyperliquid e persistência
12. Tipos do livro-razão ignorados: `rewardsClaim`, `liquidation`, taxa de saque.
13. A chave de deduplicação depende de `px/sz` agregados (`aggregateByTime`), que podem mudar quando uma ordem é parcialmente preenchida.
14. O histórico bruto vai para o `localStorage` (cerca de 5 MB). Quando estoura, o salvamento falha em silêncio.
15. Restaurar um backup ou zerar os dados sobrescreve tudo sem backup automático antes.

## Plano (aprovado)
0. Preservação: `main` intacta e desenvolvimento em `claude/friendly-hopper-ocnkxv`.
1. Fonte em `btc-src/`, com build reproduzível (o mesmo `btc/index.html`).
2. Segurança de dados: schema v4, backup automático e retrato inicial imutável.
3. Motor de ciclos: itens 1 a 11.
4. Hyperliquid: itens 12 a 14, mark price e candle de 1 min.
5. Documentação: ARQUITETURA.md e CALCULOS.md.
6. Visual de terminal profissional (ver DESIGN-BRIEF.md).
