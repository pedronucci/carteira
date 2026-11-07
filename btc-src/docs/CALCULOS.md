# Cálculos do Bitcoin Strategy Terminal

Motor puro em `apps/local/src/lib/local/strategy.ts` (sem rede nem armazenamento), testado em
`apps/local/test/strategy.test.ts` e `apps/local/test/ciclo-nov2026.test.ts`.

## Janela do ciclo
- Entram só os eventos com `t > início` e `t ≤ fim` (Hyperliquid). Em lançamentos manuais, `t ≥ início`:
  a primeira transação feita no instante exato do início pertence ao ciclo.
- Posição já aberta no início (herdada): entra com base = preço do início. Só a variação posterior conta.
- Funding da posição, na visão do ciclo: só o pago ou recebido depois do início.

## Conta perpétua
```
patrimônio = colateral + tamanho × (preço − base)
colateral  += resultado realizado − taxas + funding + aportes − retiradas
```

## Resultado e retornos
| Medida | Fórmula | Para que serve |
|---|---|---|
| Capital | patrimônio inicial + aportes − retiradas | quanto dinheiro a estratégia recebeu |
| Resultado | patrimônio − capital | ganho ou perda em dinheiro; aporte nunca vira lucro |
| Retorno sobre o capital | resultado ÷ (patrimônio inicial + aportes) | "quanto rendeu o dinheiro que coloquei" |
| TWR (ponderado no tempo) | Π (1 + rᵢ) − 1 | mede a estratégia sem o peso do tamanho e da hora de cada aporte |

Os dois percentuais são corretos e respondem a perguntas diferentes. Exemplo do ciclo de 05/11/2026:
a posição perdeu cerca de 3,3% sobre US$ 8.006 **antes** do depósito de US$ 5.103,58. Depois, rendeu +0,4%
sobre o capital maior. Resultado: retorno sobre o capital de −1,62% e TWR de −2,92%.

### Subperíodos do TWR
A série tem um ponto em cada um destes instantes: início do ciclo, cada aporte ou retirada, fechamento de cada dia
(23:59:59 UTC) e agora (ou fim do ciclo). Em cada aporte, a carteira é avaliada **antes** do fluxo, pelo preço da
execução mais próxima (até 2 h); sem execução próxima, pelo fechamento do dia. Cada subperíodo usa o Dietz modificado:

```
rᵢ = (E₁ − E₀ − F) / (E₀ + W),   W = Σ Fⱼ × (tempo aplicado ÷ duração do subperíodo)
```

Como cada fluxo abre um subperíodo novo, W ≈ F e rᵢ é o retorno exato (padrão GIPS).

### Períodos (7 dias, 30 dias, 24 h)
TWR encadeado a partir do primeiro ponto dentro da janela. Se o ciclo for mais novo que a janela, o topo mostra
"Desde o início", e não "24 h".

### Queda desde o pico
Índice de TWR acumulado; queda = 1 − índice ÷ máximo anterior.

## Buy & Hold ("Só BTC")
Compra BTC com o patrimônio inicial pelo preço do início e com cada aporte pelo preço daquele instante. Nunca vende.

## Percentual de uma operação (entrada → saída)
resultado da operação ÷ (patrimônio na abertura + aportes feitos com a posição aberta).

## Moeda
Em reais, cada ponto é convertido pelo dólar daquela data (implícito BTCBRL ÷ BTCUSDT). Os aportes são somados no câmbio
da data.
