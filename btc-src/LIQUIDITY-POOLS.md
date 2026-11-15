# LIQUIDITY POOLS — primeira etapa local

Data de revisão: 15/11/2026. Branch: `codex/liquidity-pools`. Rota: `#/liquidity-pools`. Nome no menu e na tela: **LIQUIDITY POOLS**, sem Intelligence.

Esta é uma implementação parcial e operacional; NÃO representa conclusão de todo o escopo do documento. Não publicada em produção. Sem novos pacotes, sem alterações no gateway, na estratégia legada, Hyperliquid ou OKX. A página de portfólio ganhou apenas um acesso ao módulo; motores e séries financeiras permanecem intactos.

## Operacional

- Interface NEXUS existente, abas de posições, Explorer, Analytics e simulação, desktop/celular.
- Reutilização das carteiras EVM/Solana ativas; cadastro de novos endereços pelo conector já existente. Não conecta carteira, não pede assinaturas, não envia transações.
- Adapter Uniswap V3 em Ethereum, Arbitrum, Base, Optimism, Polygon e BNB Chain, usando gerenciadores do SDK oficial e RPCs públicos. Enumeração ERC721 paginada em 20 posições por carteira/rede; consultas sequenciais, timeout/cancelamento, atualização manual e periódica a cada 5 minutos enquanto a tela está aberta.
- Mesmo bloco para balanceOf, enumeração NFT, positions, factory/getPool, slot0 e metadados ERC20 em cada consulta. Chamadas repetidas ao mesmo contrato são reutilizadas no bloco. Precisão de liquidez inteira com BigInt; quantidades estimadas com Decimal de 50 dígitos, considerando decimais distintos e faixa concentrada. Estas quantidades são estimativas matemáticas, não execução bit a bit de TickMath/FullMath.
- Identidade de posição: eip155:chainId:uniswap-v3:manager:tokenId. Páginas/carteiras duplicadas não acumulam a mesma posição duas vezes. Endereços de tokens são preservados; símbolos não determinam identidade econômica.
- Status IN RANGE (limite inferior inclusivo/superior exclusivo), OUT OF RANGE e CLOSED, quantidades, pool/NFT/bloco, fee tier e gráfico visual de faixa.
- USD complementar por contrato exato na DefiLlama Coins; preço positivo/finito, timestamp até 1h e confiança >=90% quando informada. Falha deixa valor indisponível; nunca inventa preço de stablecoin. Valor conhecido inclui liquidez e tokensOwed, sem feeGrowth não contabilizado. tokensOwed pode incluir principal e não é classificado como fees.
- Explorer com DexScreener e DefiLlama Yields para as redes e protocolos listados disponíveis nas fontes. Filtros de par/endereço, rede, protocolo, TVL, volume, APY e observações de risco; ranking exclusivamente por TVL decrescente; páginas de 20 resultados; cache de 5 minutos e aviso após 10 minutos. Resultados não são recomendações.
- TVL, volume 24h/7d, APY do provedor e metadados de fee tier quando fornecidos. Ausentes ficam indisponíveis. IDs UUID da DefiLlama não são tratados como contratos; referências de pools V4 podem ser hashes e não contratos ERC20. A data apresentada é a obtenção da resposta, não uma garantia de atualização do indexador.
- Simulador hipotético de LP tradicional 50/50 e concentrada, capital/faixa/preços/fees/custos editáveis, P&L líquido, IL relativa ao HODL do mesmo inventário inicial e gráfico de cenários. Token de cotação fixo a US$1, fees manuais, sem previsão de volume. Não aplica a fórmula 50/50 à liquidez concentrada.
- Analytics disponível para distribuição dos valores recentes observados por rede/protocolo. Sem histórico inventado.

## Contabilidade e limitações ainda pendentes

O escopo solicitado ainda requer implementação/infraestrutura para:

1. Descoberta por carteira de Uniswap V2/V4, Orca Whirlpools e Raydium CLMM/CPMM. Seus mercados aparecem no Explorer quando cobertos; isso NÃO equivale a suporte à leitura das posições pessoais.
2. Indexação histórica de depósitos, retiradas, aumentos/reduções e coletas, reorgs, transferências de NFTs, posições em farms/vaults e posições queimadas. O adapter V3 cobre NFTs custodiados diretamente no endereço consultado; CLOSED cobre NFTs ainda existentes com liquidez zero.
3. Fee growth não realizado, taxas realizadas, gas e custo base auditáveis; P&L realizado/não realizado, retorno ajustado por fluxos, APR realizado, LP vs HODL histórico, séries patrimoniais e histórico de APR/APY. Na ausência dessas entradas a interface mostra Dados insuficientes.
4. Integração de LPs como classe efetivamente somada ao consolidado, exposição econômica indireta, atribuição e performance. Nesta etapa os valores LP são deliberadamente separados: descobrir posições antigas não pode virar lucro/aporte, e recibos/tokenização não podem duplicar patrimônio. Não há migração nem escrita de saldos LP ou eventos nas bases financeiras.
5. Alertas persistentes de mudanças de TVL/volume/rentabilidade, indexação em segundo plano e garantia de cobertura completa. RPC público pode limitar/bloquear requisições; falhas mantêm resultados anteriores identificados como antigos. Cache de posições é apenas da sessão e não substitui histórico.

## Fórmulas

AMM 50/50: V_LP=C*sqrt(P/P0); V_HODL=C*(1+P/P0)/2; IL=V_LP−V_HODL.

Concentrada: a=sqrt(Pmin), b=sqrt(Pmax), s=sqrt(P0). x=(b−s)/(s*b), y=s−a, L=C/(x*P0+y). Para z=clamp(sqrt(P),a,b), V_LP=L*((b−z)/(z*b)*P+z−a); V_HODL=L*(x*P+y). Resultado líquido=V_LP+fees−gas−C. IL não inclui fees/gas. Sem saltos de inventário fora da faixa, sem rebalanceamento.

A função de P&L só calcula com histórico explicitamente completo: valor atual+retiradas+fees coletadas−depósitos−gas. Ainda não é ligada às posições reais porque a completude histórica não foi implementada.

## Validação executada

- `pnpm typecheck`: aprovado, incluindo verificação final da correção responsiva.
- `pnpm test`: 437 testes aprovados (304 app, 83 domain, 29 gateway, 21 proxy), incluindo 25 novos testes LP.
- `pnpm build`: aprovado. Build local final: 4a5ce1cdb6213967.
- Testes LP: 50/50 analítico, concentrada dentro/fora da faixa, preço estável, fees/gas separados de IL, decimais diferentes, Q96, inválidos, aporte sem lucro, identidade duplicada, ABI, carteira vazia, falha RPC, ausência de campos, NFTs ativos/encerrados/fora do range.
- Leitura real Ethereum: contrato público USDC/WETH confirmou ausência de NFTs em seu endereço; enumeração pública do gerenciador identificou NFT 1405252 IN RANGE, sem avisos de leitura. Não houve cotação USD suficiente para todos os tokens desse NFT; permaneceu indisponível, conforme esperado. Não se acessaram dados privados.
- Consultas reais do Explorer em navegador: DexScreener retornou pares ETH/USDC e WETH/USDC, inclusive Orca; DefiLlama retornou 40 pools no filtro ETH USDC, com TVL/volume/APY quando disponíveis. Valores mudam com a fonte.
- UI: estado vazio, troca de fontes, simulação 50/50 com preço dobrado (LP US$1414,21 vs HODL US$1500 para US$1000), gráfico, filtros e largura móvel 390px sem transbordamento da página após correção das abas. Não foram usadas posições sintéticas na interface.

## Arquivos

- `apps/local/src/lib/liquidity/{types,math,market,state,uniswap-v3}.ts`
- `apps/local/src/lib/liquidity/{math,adapter}.test.ts`
- `apps/local/src/app/liquidity-pools/{page,tools}.tsx`
- `apps/local/src/app/portfolio/liquidity-link.tsx`
- `apps/local/src/app/portfolio/page.tsx`: acesso ao módulo.
- `apps/local/src/components/nav.tsx`: entrada na sidebar.
- `apps/local/src/entry.tsx`: rota.

Backup de origem fora do repositório: `backups/antes-liquidity-pools-2026-11-15/versao-anterior.zip`. Branch main e arquivos publicados em btc/ não foram alterados.

## Referências primárias utilizadas

- https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts
- https://developers.uniswap.org/docs/protocols/v3/guides/managing-liquidity/getting-started
- https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/libraries/LiquidityAmounts.sol
- https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/libraries/Position.sol
- https://docs.dexscreener.com/api/reference
- https://github.com/DefiLlama/yield-server
- https://yields.llama.fi/pools
- https://coins.llama.fi/prices/current/
