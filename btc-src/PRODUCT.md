# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Um único investidor (o dono do repositório), que acompanha a própria estratégia de Bitcoin principalmente no iPhone, como app da Tela de Início, e às vezes no computador. O trabalho dele é saber, em segundos, se está em BTC ou em USDC, quanto o ciclo atual rendeu, qual é o risco de liquidação e se a estratégia está vencendo o "só segurar BTC".

## Product Purpose
O Bitcoin Strategy Terminal acompanha a estratégia "100% USDC ↔ 100% BTC (long em perpétuo, alavancagem baixa, margem em USDC)". Cada estratégia é medida em **ciclos** com início exato (data, hora e fuso). O resultado de um ciclo considera só o que acontece depois do início, sem misturar o histórico anterior da conta. O app funciona bem quando os números do ciclo batem com a Hyperliquid e as decisões de risco ficam evidentes.

## Positioning
É uma ferramenta pessoal, só de acompanhamento: lê dados públicos da Hyperliquid pelo endereço da carteira, sem chave, assinatura ou execução de ordens, e guarda os dados só no aparelho. Mede a estratégia por ciclos com retrato inicial, e não pelo saldo bruto da conta.

## Operating Context
- No iPhone, como PWA. O Safari e o app da Tela de Início guardam dados separados. O backup é feito em JSON por Ajustes > Backup.
- Com a Hyperliquid conectada, atualiza a cada 20 s com o app aberto. Também aceita lançamentos manuais (o modo usado no ciclo atual).
- Ciclo atual: começou em 05/11/2026 às 21:13 (America/Sao_Paulo) com a primeira transação do ciclo (abertura do long em BTC). Não havia posição aberta antes disso. O ciclo já está cadastrado no app; na captura de 07/11, essa compra aparece às 21:20, horário a conferir.
- Publicado pelo GitHub Pages em /carteira/btc/ (pasta `btc/`, a partir da branch `main`).

## Capabilities and Constraints
- Abas: Alocação, Performance, Transações e Mercado. Alternância BRL/USD. Ocultar valores.
- Operações: entrar em BTC, aumentar posição (preço médio), sair para USDC, aportes e retiradas.
- Cotações: Binance, CoinGecko, AwesomeAPI e alternative.me. Dados de conta: API pública `/info` da Hyperliquid.
- O resultado é um único arquivo `btc/index.html` (sem servidor). Os dados financeiros ficam só no `localStorage` do aparelho e nunca vão para o repositório.
- Toda migração de dados precisa de backup automático e ser reversível.
- Não pode virar ferramenta de execução de ordens.

## Brand Commitments
- Nome: Bitcoin Strategy Terminal ("BTC Terminal" na Tela de Início). Ícone: moeda laranja com o símbolo do Bitcoin.
- Tema escuro, com amarelo como cor de destaque, laranja para o BTC, verde para ganho e vermelho para perda.
- Interface em português do Brasil, com linguagem direta e sem jargão desnecessário.

## Evidence on Hand
- Capturas reais do iPhone de 07/11/2026, enviadas na conversa (não versionadas porque contêm valores reais).
- Não inventar números, retornos ou métricas: toda demonstração usa dados simulados e identificados como tal.

## Product Principles
1. O ciclo é a unidade de verdade: nada de antes do início entra no resultado.
2. Os números precisam bater com a corretora. Divergências aparecem de forma explícita (reconciliação), nunca escondidas.
3. O risco vem primeiro: exposição, alavancagem e distância da liquidação são lidos antes do lucro.
4. Os dados do usuário são sagrados: backup antes de qualquer mudança, e nada sai do aparelho.
