# Simulador de posições perpétuas

Acesso: menu **Simulador de posições** / `#/simulador`. BTC, SOL e HYPE; nenhuma carteira, assinatura ou envio de ordens. O módulo não grava no patrimônio, nos aportes ou no histórico de contas reais.

## Convenções e fórmulas

Contratos lineares denominados em USDC, exibidos em dólares sem conversão de USDC/USD. Margem isolada fictícia M inclui o orçamento das taxas; alavancagem L; entrada E; direção s=+1 LONG, -1 SHORT. N=M×L; quantidade teórica Q=N/E, sem arredondamento de lote/tick. Cálculos financeiros usam Decimal de 50 dígitos; apresentação arredonda.

- PnL bruto por encerramento: s×q×(P−E).
- Taxas: Q×E×taxaEntrada + soma(q×P×taxaSaída). São hipóteses editáveis, sem assumir tier pessoal, descontos ou execução maker.
- Funding: soma(Qremanescente×oracle×taxaHorária×s) a cada hora completa. Oracle e taxa constantes, obtidos da API ou definidos pelo usuário para taxa. Abertura imediatamente após um pagamento; encerramentos na hora exata ocorrem após o pagamento. Frações de hora não são rateadas. Funding positivo é custo para LONG e crédito para SHORT. Não se trata de previsão da taxa futura.
- PnL líquido = bruto − taxas − funding; ROE = líquido / margem inicial.
- Cada TP encerra o percentual da **quantidade original**, com preços favoráveis e horários crescentes. A soma não pode superar 100%. O saldo encerra no preço final, ou no stop se o preço final o ultrapassa; supõe execução sem gaps/slippage. O usuário informa a cronologia hipotética, não inferida dos candles.
- Lucro realizado e colateral ficam integralmente alocados na posição isolada após as parciais; não se simula liberação automática de margem. A tabela recalcula a liquidação da quantidade restante.
- Retorno/risco divide PnL líquido do plano pelo módulo da perda líquida de um encerramento integral no stop, no prazo total e sem TPs; somente aparece para retorno positivo e perda no stop.

## Liquidação e limites

As faixas são consultadas em `metaAndAssetCtxs`/`marginTables`, incluindo IDs implícitos menores que 50. Não são congeladas no código. Taxa de manutenção r=1/(2×alavancagemMáxima); dedução acumulada D aumenta em limiteInferior×(rNova−rAnterior).

Equação resolvida por faixa: C+s×Q×(P−E)=Q×P×r−D. A faixa é selecionada pelo nocional **no preço de liquidação**, incluindo cruzamento entre faixas. Taxa de entrada reduz C inicialmente; funding e taxas/parciais atualizam C. Um LONG integralmente coberto pode não ter raiz positiva; isso é diferente de parâmetros ausentes.

O resultado é **estimativa**, nunca preço garantido. O caminho entre os pontos informados é verificado conservadoramente contra o colateral antes e após funding; não existe trajetória intraperíodo nem motor de liquidação/backstop, slippage ou custos de liquidação. Resultados de cenários incompatíveis com margem inicial, limites de alavancagem ou liquidação são identificados como apenas algébricos. Hipótese de margem isolada com lucro retido pode diferir da alocação real de uma conta.

## Dados e interface

API pública REST a cada 15 segundos (timeout 12s), mid via WebSocket com reconexão e ping, candles de 1h para contexto. Mid, mark e oracle são identificados separadamente. REST acima de 45s bloqueia uso da referência atual e oculta liquidação; mid acima de 30s vira indisponível. Funding ausente usa hipótese explícita de zero; referência antiga é sinalizada. Falha de candles mantém o gráfico de níveis manuais. O histórico é contexto, não backtest.

Entrada, saída, SL, TPs e liquidação são arrastáveis. Liquidação ajusta margem e alavancagem preservando nocional somente se o ajuste resultar em 1–20x. Campos permitem controle alternativo; níveis aceitam setas no teclado. Eixo permanece fixo durante o arraste. A tela reutiliza componentes e tema existentes.

## Referências primárias

- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

## Verificação

Testes sintéticos de LONG/SHORT, sinal de funding, execução de SL, parciais de quantidade original, horas fracionárias, encerramento total antecipado, equação de manutenção em faixas distintas, limites, falta de parâmetros e erros de API. Verificação visual de desktop/celular, valores de exemplo e atualização dos níveis. A consulta pública real confirma o contrato dos três ativos, sem acessar dados privados ou operar fundos.
