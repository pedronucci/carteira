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

## Motor v2 (Terminal 5.0)

### Posições compradas e vendidas
O tamanho tem sinal: compra soma e venda subtrai.
- **Aumentar** na mesma direção recalcula o preço médio (média ponderada pelo tamanho).
- **Reduzir** realiza `(preço − base) × quantidade × direção`.
- **Cruzar o zero** (reversão) fecha a operação e abre outra na direção oposta, com base no preço da execução. A taxa
  dessa execução é dividida na proporção do que fechou e do que abriu.
- Uma posição herdada no início pode ser comprada ou vendida; nos dois casos, só a variação depois do início conta.
- Distância da liquidação: comprado = (preço − liquidação) ÷ preço; vendido = (liquidação − preço) ÷ preço.

### Três medidas de Bitcoin (nunca somadas entre si)
| Medida | Definição |
|---|---|
| BTC equivalente | patrimônio ÷ preço do BTC |
| BTC spot | BTC efetivamente em custódia (saldo spot UBTC/BTC na Hyperliquid; lançamento manual não tem spot) |
| Exposição sintética | tamanho do perpétuo, com sinal (exposição econômica, não posse) |

"vs. só BTC" = BTC equivalente − unidades do Buy & Hold (patrimônio inicial e cada aporte convertidos em BTC no
preço do instante). Positivo = a estratégia acumulou mais BTC do que só segurar.

### Receitas que não são aporte
Recompensas resgatadas na Hyperliquid (`rewardsClaim`) entram no colateral e no resultado, mas não no capital.

### Hyperliquid
- Execuções individuais (sem agregação por tempo), com chave pelo id do negócio (`tid`). Um histórico salvo no
  formato anterior é buscado de novo do zero (a Hyperliquid devolve as execuções mais recentes, até o limite dela).
- Preço do BTC no início do ciclo: vela de 1 minuto da Hyperliquid que contém o instante.
- Retrato reconstruído com posição aberta: parte do ponto oficial de valor da conta mais próximo e corrige por
  `tamanho × (preço no início − preço naquele ponto)`, em vez de interpolar em linha reta.
- Pendente de verificação na documentação oficial (o acesso a ela está bloqueado neste ambiente): o campo de
  valor de `rewardsClaim` e a taxa de saque (`withdraw.fee`).

## Portfólio Consolidado (motor em `packages/domain/src/portfolio.ts`)
- **Um saldo por (conta, ativo exato):** a leitura mais recente vence; sincronizações repetidas não duplicam.
- **Contas com derivativos** (Hyperliquid, futuros da OKX) entram pelo **patrimônio líquido** oficial (margem e P&L
  aberto já incluídos). As posições aparecem em "Posições em derivativos" e **nunca** são somadas; o nocional também não.
  Na conta unificada da Hyperliquid, o colateral está no saldo spot e o P&L aberto entra como linha própria.
- **Identidade dos ativos:** agrupa pelo ativo econômico só quando a identidade é conhecida (símbolos de exchange do
  registro e contratos verificados em `assets.ts`). Representações (WBTC, cbBTC, UBTC, USDT0) aparecem marcadas;
  token desconhecido fica no próprio grupo ("não reconhecido"), nunca somado a outro pelo símbolo.
- **Sem preço:** fica fora do total e listado como "sem preço", nunca vale zero em silêncio. Preço: CoinGecko (id
  conhecido ou informado), BTC igual ao da Estratégia, ou preço manual (marcado).
- **Custo:** total informado por saldo; preço médio = custo ÷ quantidade. Se algum saldo do grupo não tem custo, o
  custo do grupo é "desconhecido" (não zero) e o P&L não é calculado.
- **BTC possuído:** soma do BTC spot e das representações conhecidas, por custódia. Perpétuo não conta.
- **Movimentações** (`classifyFlows`): interna = contraparte própria, mesmo txid, ou par saída → entrada do mesmo
  ativo com quantidade compatível (taxa ≤ 1%) em até 6 h. Depósito/saque sem par = aporte/retirada externa.
  Transferência sem par = **pendente** (o usuário classifica). Compra, venda, swap, taxa, funding e recompensa = resultado.
- **Rentabilidade** (`portfolioReturns`): retratos por hora com o valor de cada conta. Em cada intervalo só entram as
  contas presentes nos dois retratos (conta nova não vira lucro) e os fluxos externos e **ajustes de cadastro** de cada
  conta saem do resultado (Dietz modificado por intervalo, encadeado).
- **Cadastrar, alterar ou remover um saldo manual** registra um ajuste com a diferença de valor: não é lucro nem aporte.
- A conta da Estratégia entra pelo patrimônio real dela (Hyperliquid ao vivo, ou modelo dos lançamentos manuais), e os
  aportes da Estratégia contam como fluxos dessa conta. O portfólio nunca altera os dados da Estratégia.

## Conectores públicos (somente leitura)
| Fonte | O que lê | De onde | Limite conhecido |
|---|---|---|---|
| Bitcoin | saldo (confirmado e não confirmado), UTXOs, transações recentes por endereço | mempool.space (CORS liberado) | xpub/ypub/zpub e descritores pkh/sh(wpkh)/wpkh: derivação local, limite de 20 endereços sem uso por cadeia; taproot (tr) ainda não |
| EVM / Rabby | saldo nativo e tokens do registro verificado em Ethereum, Arbitrum, Base, Optimism e BNB Chain | RPC público PublicNode (lote JSON-RPC) | descoberta de outros tokens e histórico exigem explorador com chave → gateway |
| Solana | saldo de SOL | RPC PublicNode (o RPC oficial recusa páginas web: 403) | tokens SPL exigem RPC indexado com chave → gateway |

- Transação Bitcoin: líquido = saídas para endereços próprios − entradas de endereços próprios (o troco para um
  endereço próprio não é saída). Valor em USD pelo fechamento diário do BTC na data.
- Movimentação sem par fica **pendente** e conta como aporte/retirada até você classificar: entrada não
  classificada nunca vira lucro.
- O app recusa frase de recuperação, chave privada (EVM) e chave privada estendida (xprv) com mensagem clara.
- Verificado em 07/11/2026 contra as APIs reais, a partir do navegador, com endereços públicos de teste.
